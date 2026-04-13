function notifyUser(title, message) {
  getUserSettings()
    .then((settings) => {
      if (!settings.notificationsEnabled) return;
      chrome.notifications.create(`warp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icon-128.png'),
        title,
        message,
        priority: 2,
      });
    })
    .catch((err) => {
      console.warn('Failed to resolve notification preference:', err);
    });
}

const MAX_LOG_ENTRIES = 30;
const MAX_LOG_MESSAGE_LENGTH = 180;
const MAX_LOG_DETAILS_LENGTH = 2400;
const DEFAULT_USER_SETTINGS = {
  notificationsEnabled: true,
  pageToastsEnabled: true,
};

const getUserSettings = () =>
  new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_USER_SETTINGS, resolve);
  });

function showPageToast(message, tabId, tone = 'info') {
  getUserSettings()
    .then((settings) => {
      if (!settings.pageToastsEnabled) return;

      const sendToast = (targetTabId) => {
        if (!targetTabId) return;
        chrome.tabs.sendMessage(targetTabId, { action: 'show_toast', text: message, tone }, () => {
          if (chrome.runtime.lastError) {
            console.debug('warp toast skipped:', chrome.runtime.lastError.message);
          }
        });
      };

      if (tabId) {
        sendToast(tabId);
        return;
      }

      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        sendToast(tabs?.[0]?.id);
      });
    })
    .catch((err) => {
      console.warn('Failed to resolve page toast preference:', err);
    });
}

function normalizeStoredLog(entry) {
  return {
    message: truncateLogField(entry?.message, MAX_LOG_MESSAGE_LENGTH),
    status: entry?.status || 'info',
    timestamp: Number(entry?.timestamp || Date.now()),
    details: truncateLogField(entry?.details, MAX_LOG_DETAILS_LENGTH),
  };
}

function persistLogs(logs) {
  const trimmedLogs = (logs || []).slice(-MAX_LOG_ENTRIES).map(normalizeStoredLog);

  chrome.storage.local.set({ logs: trimmedLogs }, () => {
    if (!chrome.runtime.lastError) return;

    console.warn('Failed to persist warp logs locally:', chrome.runtime.lastError.message);
    if (trimmedLogs.length <= 1) return;

    chrome.storage.local.set({ logs: trimmedLogs.slice(Math.ceil(trimmedLogs.length / 2)) });
  });
}

function migrateLegacySyncLogs() {
  chrome.storage.sync.get({ logs: null }, (syncItems) => {
    const legacyLogs = Array.isArray(syncItems.logs) ? syncItems.logs : [];

    if (!legacyLogs.length) {
      if (syncItems.logs !== null) chrome.storage.sync.remove('logs');
      return;
    }

    chrome.storage.local.get({ logs: [] }, (localItems) => {
      const mergedLogs = [...(localItems.logs || []), ...legacyLogs]
        .map(normalizeStoredLog)
        .sort((a, b) => a.timestamp - b.timestamp);

      persistLogs(mergedLogs);
      chrome.storage.sync.remove('logs');
    });
  });
}

// Helper to log activities
function logActivity(message, status = 'info', details = null, notify = false, notifyTitle = '') {
  chrome.storage.local.get({ logs: [] }, (items) => {
    const logs = items.logs || [];
    logs.push({
      message: truncateLogField(message, MAX_LOG_MESSAGE_LENGTH),
      status,
      timestamp: Date.now(),
      details: truncateLogField(details, MAX_LOG_DETAILS_LENGTH),
    });
    persistLogs(logs);
  });

  if (notify || status === 'success' || status === 'error') {
    const title =
      notifyTitle ||
      (status === 'success' ? 'warp: Success' : status === 'error' ? 'warp: Error' : 'warp');
    notifyUser(title, message);
  }
}

function truncateLogField(value, maxLength) {
  const normalized = (value || '').toString();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

async function fetchWithTimeout(
  resource,
  init = {},
  timeoutMs = 15000,
  timeoutMessage = 'Request timed out',
) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let removeAbortListener = null;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
    else {
      const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
      removeAbortListener = () => upstreamSignal.removeEventListener('abort', abortFromUpstream);
    }
  }

  const timeout = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);

  try {
    return await fetch(resource, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError' && !upstreamSignal?.aborted) {
      throw new Error(timeoutMessage);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    removeAbortListener?.();
  }
}

// Get Config helper
const getConfig = () =>
  new Promise((resolve) => {
    chrome.storage.sync.get(
      ['qbitUrl', 'qbitUser', 'qbitPass', 'qbitEnabled', 'sabUrl', 'sabKey', 'sabEnabled'],
      resolve,
    );
  });

const QBIT_HEADER_RULE_ID = 1001;
const activeDirectTests = new Map();
const recentDownloadGestures = [];
const pendingGestureDownloads = new Map();
const RECENT_DOWNLOAD_GESTURE_WINDOW_MS = 5000;
const PENDING_GESTURE_DOWNLOAD_WINDOW_MS = 15000;
const BACKEND_BADGE_ALARM = 'warp-backend-badge-refresh';
const BACKEND_BADGE_REFRESH_MINUTES = 1;
const ENABLE_BACKGROUND_BADGE_PROBES = false;
const ENABLE_SAB_STRICT_KEY_PROBE = false;
const ENABLE_DOWNLOADS_API_FALLBACK_SIPHON = true;
const BADGE_STATE_STORAGE_KEY = 'backendBadgeState';
const BADGE_COLOR_OK = '#1f6f43';
const BADGE_COLOR_WARNING = '#a06a08';
const BADGE_COLOR_ERROR = '#8f2431';
const BACKEND_RUNTIME_HEALTH_MAX_AGE_MS = 15000;
const BACKEND_BADGE_RUNTIME_DEBOUNCE_MS = 40;
const SAB_STRICT_KEY_VALIDATION_CACHE_MS = 5 * 60 * 1000;
const backendRuntimeHealth = {
  qbit: null,
  sab: null,
};
const sabStrictValidationCache = new Map();
let backendBadgeRefreshTimer = null;
let queuedBadgePreferRuntime = false;

function normalizeQbitUrl(url) {
  let cleanUrl = url.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'http://' + cleanUrl;
  return cleanUrl;
}

function pruneRecentDownloadGestures() {
  const cutoff = Date.now() - RECENT_DOWNLOAD_GESTURE_WINDOW_MS;
  for (let index = recentDownloadGestures.length - 1; index >= 0; index -= 1) {
    if ((recentDownloadGestures[index]?.timestamp || 0) < cutoff) {
      recentDownloadGestures.splice(index, 1);
    }
  }
}

function markRecentDownloadGesture(url = '', senderTabId, filename = '', mime = '') {
  pruneRecentDownloadGestures();
  recentDownloadGestures.push({
    filename,
    mime,
    senderTabId: typeof senderTabId === 'number' && senderTabId >= 0 ? senderTabId : undefined,
    timestamp: Date.now(),
    url: (url || '').trim().toLowerCase(),
  });
}

function consumeRecentDownloadGesture(url = '') {
  pruneRecentDownloadGestures();
  const normalizedUrl = (url || '').trim().toLowerCase();
  if (!recentDownloadGestures.length) return null;

  const exactMatchIndex = normalizedUrl
    ? recentDownloadGestures.findIndex((entry) => entry.url === normalizedUrl)
    : -1;
  if (exactMatchIndex >= 0) {
    return recentDownloadGestures.splice(exactMatchIndex, 1)[0];
  }

  return recentDownloadGestures.shift() || null;
}

function prunePendingGestureDownloads() {
  const cutoff = Date.now() - PENDING_GESTURE_DOWNLOAD_WINDOW_MS;
  pendingGestureDownloads.forEach((entry, downloadId) => {
    if ((entry?.timestamp || 0) < cutoff) pendingGestureDownloads.delete(downloadId);
  });
}

function rememberPendingGestureDownload(item) {
  if (typeof item?.id !== 'number' || item.id < 0) return;
  prunePendingGestureDownloads();
  pendingGestureDownloads.set(item.id, {
    filename: item.filename || '',
    senderTabId: item.senderTabId,
    timestamp: Date.now(),
    url: item.finalUrl || item.url || '',
  });
}

function getPendingGestureDownload(downloadId) {
  if (typeof downloadId !== 'number' || downloadId < 0) return null;
  prunePendingGestureDownloads();
  return pendingGestureDownloads.get(downloadId) || null;
}

function forgetPendingGestureDownload(downloadId) {
  if (typeof downloadId !== 'number' || downloadId < 0) return;
  pendingGestureDownloads.delete(downloadId);
}

function normalizeSabUrl(url) {
  let cleanUrl = url.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'http://' + cleanUrl;
  return cleanUrl;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function syncQbitHeaderRule(url, enabled = true) {
  const removeRuleIds = [QBIT_HEADER_RULE_ID];

  if (!enabled || !url) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    return;
  }

  const cleanUrl = normalizeQbitUrl(url);
  const origin = new URL(cleanUrl).origin;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules: [
      {
        id: QBIT_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: origin },
            { header: 'referer', operation: 'set', value: cleanUrl },
          ],
        },
        condition: {
          regexFilter: `^${escapeRegex(cleanUrl)}/api/v2/`,
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ],
  });
}

async function loginToQbit(cleanUrl, user, pass, signal) {
  const loginRes = await fetch(`${cleanUrl}/api/v2/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ username: user, password: pass }),
    credentials: 'include',
    signal,
  });

  const text = await loginRes.text();

  if (loginRes.status === 403) {
    return { success: false, error: 'HTTP 403: IP banned after too many failed login attempts' };
  }

  if (!loginRes.ok) {
    return { success: false, error: `HTTP ${loginRes.status}: Auth Failed` };
  }

  if (text.includes('Fails')) {
    return { success: false, error: 'Auth failed: Bad Credentials' };
  }

  if (!text.trim().startsWith('Ok')) {
    return { success: false, error: 'Auth failed: Unexpected response' };
  }

  return { success: true };
}

function shouldValidateQbitCredentials(credentials = {}) {
  return Boolean((credentials.user || '').trim() || credentials.pass);
}

async function clearQbitSession(cleanUrl, signal) {
  try {
    await fetch(`${cleanUrl}/api/v2/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      signal,
    });
  } catch {
    // Ignore logout failures; a missing session should not block validation flow.
  }
}

async function ensureQbitSessionForConfig(cleanUrl, credentials, signal) {
  await clearQbitSession(cleanUrl, signal);

  if (!shouldValidateQbitCredentials(credentials)) return;

  const loginResult = await loginToQbit(cleanUrl, credentials.user, credentials.pass, signal);
  if (!loginResult.success) throw new Error(loginResult.error);
}

async function fetchQbitAuthenticated(
  cleanUrl,
  path,
  init,
  credentials,
  signal,
  { requireCredentialValidation = false } = {},
) {
  if (requireCredentialValidation) {
    await ensureQbitSessionForConfig(cleanUrl, credentials, signal);
  }

  const requestInit = { ...init, credentials: 'include', signal };

  let res = await fetch(`${cleanUrl}${path}`, requestInit);

  if (res.status === 401 || res.status === 403) {
    await ensureQbitSessionForConfig(cleanUrl, credentials, signal);

    res = await fetch(`${cleanUrl}${path}`, requestInit);
  }

  return res;
}

function formatQbitRecentItem(item) {
  return {
    name: item.name,
    size: item.total_size,
    state: item.state,
    progress: item.progress,
    dlSpeed: item.dlspeed,
    upSpeed: item.upspeed,
    eta: item.eta,
  };
}

function formatSabRecentItem(item, source) {
  return {
    name: item.filename || item.nzb_name || item.name || 'Unknown item',
    size: item.size || item.mb || '--',
    status: item.status || source.toUpperCase(),
    source,
    timeAdded: Number(item.time_added || item.completed || item.completed_time || 0),
  };
}

function mapSabFetchError(err) {
  const message = String(err?.message || err || '').trim();
  const upper = message.toUpperCase();

  if (err?.name === 'AbortError' || upper === 'TIMEOUT') return 'TIMEOUT';
  if (
    upper.includes('FAILED TO FETCH') ||
    upper.includes('NETWORKERROR') ||
    upper.includes('LOAD FAILED') ||
    upper.includes('ERR_CONNECTION_REFUSED') ||
    upper.includes('ERR_CONNECTION_TIMED_OUT') ||
    upper.includes('CONNECTION REFUSED')
  ) {
    return 'ENDPOINT UNREACHABLE';
  }

  return message || 'UNKNOWN ERROR';
}

function getSabStrictValidationCacheKey(cleanUrl, key) {
  return `${cleanUrl}::${key}`;
}

function hasRecentSabStrictValidation(cleanUrl, key) {
  const cacheKey = getSabStrictValidationCacheKey(cleanUrl, key);
  const expiresAt = sabStrictValidationCache.get(cacheKey) || 0;

  if (expiresAt > Date.now()) return true;

  sabStrictValidationCache.delete(cacheKey);
  return false;
}

function rememberSabStrictValidation(cleanUrl, key) {
  const cacheKey = getSabStrictValidationCacheKey(cleanUrl, key);
  sabStrictValidationCache.set(cacheKey, Date.now() + SAB_STRICT_KEY_VALIDATION_CACHE_MS);
}

function getSabApiResponseError(data) {
  if (!data || typeof data !== 'object') return '';

  const directError = typeof data.error === 'string' ? data.error.trim() : '';
  const queueError = typeof data?.queue?.error === 'string' ? data.queue.error.trim() : '';

  if (data.status === false) return directError || queueError || 'Invalid API Key';
  if (data?.queue?.status === false) return queueError || directError || 'Invalid API Key';

  return '';
}

async function fetchSabQueueWithKey(cleanUrl, key, signal) {
  const queueData = await fetchSabJson(
    `${cleanUrl}/api?mode=queue&output=json&apikey=${key}`,
    signal,
  );

  const responseError = getSabApiResponseError(queueData);
  if (responseError) throw new Error(responseError);
  if (!queueData?.queue) throw new Error('No Queue data');

  return queueData;
}

async function ensureSabApiKeyValidity(cleanUrl, key, signal, { requireStrictProbe = false } = {}) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) throw new Error('Invalid API Key');

  const queueData = await fetchSabQueueWithKey(cleanUrl, normalizedKey, signal);

  if (!requireStrictProbe || !ENABLE_SAB_STRICT_KEY_PROBE) return queueData;
  if (hasRecentSabStrictValidation(cleanUrl, normalizedKey)) return queueData;

  const probeKey = `${normalizedKey}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const probeQueueData = await fetchSabQueueWithKey(cleanUrl, probeKey, signal);
    if (probeQueueData?.queue) {
      throw new Error('API key validation is not enforced by SABnzbd');
    }
  } catch (err) {
    const mapped = mapSabFetchError(err).toUpperCase();
    const raw = String(err?.message || err || '').toUpperCase();
    const authRejected =
      mapped.includes('INVALID API KEY') ||
      mapped.includes('HTTP 401') ||
      mapped.includes('HTTP 403') ||
      raw.includes('API KEY INCORRECT') ||
      raw.includes('INVALID API KEY');

    if (!authRejected) throw err;
  }

  rememberSabStrictValidation(cleanUrl, normalizedKey);
  return queueData;
}

function classifyBackendIssue(errorText = '') {
  const normalized = String(errorText || '').toUpperCase();

  if (!normalized) return 'ok';

  if (
    normalized.includes('AUTH') ||
    normalized.includes('BAD CREDENTIALS') ||
    normalized.includes('INVALID API KEY') ||
    normalized.includes('API KEY VALIDATION IS NOT ENFORCED') ||
    normalized.includes('INVALID ENDPOINT') ||
    normalized.includes('HTTP 401') ||
    normalized.includes('HTTP 403') ||
    normalized.includes('HTTP 404')
  ) {
    return 'error';
  }

  if (
    normalized.includes('TIMEOUT') ||
    normalized.includes('ENDPOINT UNREACHABLE') ||
    normalized.includes('FAILED TO FETCH') ||
    normalized.includes('NETWORKERROR') ||
    normalized.includes('LOAD FAILED') ||
    normalized.includes('CONNECTION REFUSED') ||
    normalized.includes('HTTP 502') ||
    normalized.includes('HTTP 503') ||
    normalized.includes('HTTP 504')
  ) {
    return 'warning';
  }

  return 'warning';
}

function getSeverityRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'ok') return 1;
  return 0;
}

function maxSeverity(left, right) {
  return getSeverityRank(right) > getSeverityRank(left) ? right : left;
}

function setBackendRuntimeHealth(client, { successful, errorText = '', sticky = false }) {
  const normalizedError = String(errorText || '').trim();

  backendRuntimeHealth[client] = {
    successful: Boolean(successful),
    severity: successful ? 'ok' : classifyBackendIssue(normalizedError),
    errorText: successful ? '' : normalizedError,
    sticky: Boolean(sticky),
    updatedAt: Date.now(),
  };
}

function clearBackendRuntimeHealth(client) {
  backendRuntimeHealth[client] = null;
}

function getRuntimeBadgeHealth(client, enabled) {
  if (!enabled) {
    return { enabled: false, successful: false, severity: 'none', errorText: '' };
  }

  const runtimeHealth = backendRuntimeHealth[client];
  if (!runtimeHealth) return null;

  if (
    !runtimeHealth.sticky &&
    Date.now() - runtimeHealth.updatedAt > BACKEND_RUNTIME_HEALTH_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    enabled: true,
    successful: Boolean(runtimeHealth.successful),
    severity: runtimeHealth.severity || 'warning',
    errorText: runtimeHealth.errorText || '',
    sticky: Boolean(runtimeHealth.sticky),
  };
}

async function evaluateQbitBadgeHealth(config) {
  if (!config.qbitEnabled) {
    return { enabled: false, successful: false, severity: 'none', errorText: '' };
  }

  if (!config.qbitUrl) {
    return {
      enabled: true,
      successful: false,
      severity: 'warning',
      errorText: 'Not configured',
    };
  }

  const cleanUrl = normalizeQbitUrl(config.qbitUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetchQbitAuthenticated(
      cleanUrl,
      '/api/v2/transfer/info',
      {},
      { user: config.qbitUser, pass: config.qbitPass },
      controller.signal,
      { requireCredentialValidation: true },
    );

    if (!response.ok) {
      const errorText = `HTTP ${response.status}`;
      return {
        enabled: true,
        successful: false,
        severity: classifyBackendIssue(errorText),
        errorText,
      };
    }

    return { enabled: true, successful: true, severity: 'ok', errorText: '' };
  } catch (err) {
    const errorText =
      err?.name === 'AbortError' ? 'TIMEOUT' : String(err?.message || err || 'UNKNOWN ERROR');
    return {
      enabled: true,
      successful: false,
      severity: classifyBackendIssue(errorText),
      errorText,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateSabBadgeHealth(config) {
  if (!config.sabEnabled) {
    return { enabled: false, successful: false, severity: 'none', errorText: '' };
  }

  if (!config.sabUrl || !config.sabKey) {
    return {
      enabled: true,
      successful: false,
      severity: 'warning',
      errorText: 'Not configured',
    };
  }

  const cleanUrl = normalizeSabUrl(config.sabUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    await ensureSabApiKeyValidity(cleanUrl, config.sabKey, controller.signal, {
      requireStrictProbe: true,
    });

    return { enabled: true, successful: true, severity: 'ok', errorText: '' };
  } catch (err) {
    const errorText = err?.name === 'AbortError' ? 'TIMEOUT' : mapSabFetchError(err);
    return {
      enabled: true,
      successful: false,
      severity: classifyBackendIssue(errorText),
      errorText,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshBackendBadgeState({ preferRuntime = false } = {}) {
  const config = await getConfig();
  const enabledCount = Number(Boolean(config.qbitEnabled)) + Number(Boolean(config.sabEnabled));

  if (!enabledCount) {
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.local.set({
      [BADGE_STATE_STORAGE_KEY]: {
        text: '',
        severity: 'none',
        enabledCount: 0,
        successCount: 0,
        issues: {},
        updatedAt: Date.now(),
      },
    });
    return;
  }

  let qbitHealth = preferRuntime
    ? getRuntimeBadgeHealth('qbit', Boolean(config.qbitEnabled))
    : null;
  let sabHealth = preferRuntime ? getRuntimeBadgeHealth('sab', Boolean(config.sabEnabled)) : null;

  const evaluationTasks = [];

  if (!qbitHealth) {
    evaluationTasks.push(
      evaluateQbitBadgeHealth(config).then((health) => {
        qbitHealth = health;
      }),
    );
  }

  if (!sabHealth) {
    evaluationTasks.push(
      evaluateSabBadgeHealth(config).then((health) => {
        sabHealth = health;
      }),
    );
  }

  if (evaluationTasks.length) {
    await Promise.all(evaluationTasks);
  }

  if (qbitHealth.enabled) {
    setBackendRuntimeHealth('qbit', {
      successful: qbitHealth.successful,
      errorText: qbitHealth.errorText,
      sticky: Boolean(qbitHealth.sticky),
    });
  } else {
    clearBackendRuntimeHealth('qbit');
  }

  if (sabHealth.enabled) {
    setBackendRuntimeHealth('sab', {
      successful: sabHealth.successful,
      errorText: sabHealth.errorText,
      sticky: Boolean(sabHealth.sticky),
    });
  } else {
    clearBackendRuntimeHealth('sab');
  }

  const successCount =
    Number(Boolean(qbitHealth.enabled && qbitHealth.successful)) +
    Number(Boolean(sabHealth.enabled && sabHealth.successful));

  let severity = successCount === enabledCount ? 'ok' : 'warning';
  if (qbitHealth.enabled && !qbitHealth.successful)
    severity = maxSeverity(severity, qbitHealth.severity);
  if (sabHealth.enabled && !sabHealth.successful)
    severity = maxSeverity(severity, sabHealth.severity);

  const badgeColor =
    severity === 'error'
      ? BADGE_COLOR_ERROR
      : severity === 'warning'
        ? BADGE_COLOR_WARNING
        : BADGE_COLOR_OK;

  const badgeText = `${successCount}/${enabledCount}`;

  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: badgeColor });

  chrome.storage.local.set({
    [BADGE_STATE_STORAGE_KEY]: {
      text: badgeText,
      severity,
      enabledCount,
      successCount,
      issues: {
        qbit: qbitHealth.errorText || '',
        sab: sabHealth.errorText || '',
      },
      updatedAt: Date.now(),
    },
  });
}

function scheduleBackendBadgeRefresh() {
  if (!ENABLE_BACKGROUND_BADGE_PROBES) {
    chrome.alarms.clear(BACKEND_BADGE_ALARM);
    return;
  }

  chrome.alarms.create(BACKEND_BADGE_ALARM, { periodInMinutes: BACKEND_BADGE_REFRESH_MINUTES });
}

function queueBackgroundBadgeProbe() {
  if (!ENABLE_BACKGROUND_BADGE_PROBES) return;
  queueBackendBadgeRefresh();
}

function queueBackendBadgeRefresh({ preferRuntime = false, debounceMs = 0 } = {}) {
  const runRefresh = (runtimeFirst) => {
    refreshBackendBadgeState({ preferRuntime: runtimeFirst }).catch((err) => {
      console.warn('Failed to refresh backend badge state:', err);
    });
  };

  if (debounceMs > 0) {
    queuedBadgePreferRuntime = queuedBadgePreferRuntime || preferRuntime;
    if (backendBadgeRefreshTimer) {
      clearTimeout(backendBadgeRefreshTimer);
    }
    backendBadgeRefreshTimer = setTimeout(() => {
      const runtimeFirst = queuedBadgePreferRuntime;
      backendBadgeRefreshTimer = null;
      queuedBadgePreferRuntime = false;
      runRefresh(runtimeFirst);
    }, debounceMs);
    return;
  }

  if (backendBadgeRefreshTimer) {
    clearTimeout(backendBadgeRefreshTimer);
    backendBadgeRefreshTimer = null;
    queuedBadgePreferRuntime = false;
  }

  runRefresh(preferRuntime);
}

function queueRuntimeDrivenBadgeRefresh() {
  queueBackendBadgeRefresh({
    preferRuntime: true,
    debounceMs: BACKEND_BADGE_RUNTIME_DEBOUNCE_MS,
  });
}

function clearRuntimeHealthForChangedConfig(changes) {
  if (changes.qbitUrl || changes.qbitUser || changes.qbitPass || changes.qbitEnabled) {
    clearBackendRuntimeHealth('qbit');
  }

  if (changes.sabUrl || changes.sabKey || changes.sabEnabled) {
    clearBackendRuntimeHealth('sab');
  }
}

function mapQbitFetchError(err) {
  const message = String(err?.message || err || '').trim();
  if (err?.name === 'AbortError' || message.toUpperCase() === 'TIMEOUT') return 'TIMEOUT';
  return message || 'UNKNOWN ERROR';
}

function mapQbitStatsErrorForPopup(errorText) {
  return errorText === 'Not configured' ? 'NO URL PROVIDED' : errorText;
}

function mapSabStatsErrorForPopup(errorText) {
  return errorText === 'Not configured' ? 'NO URL PROVIDED' : errorText;
}

function recordLiveBackendHealth(client, success, errorText = '') {
  setBackendRuntimeHealth(client, { successful: success, errorText, sticky: false });
  queueRuntimeDrivenBadgeRefresh();
}

function recordDisabledBackendHealth(client) {
  clearBackendRuntimeHealth(client);
  queueRuntimeDrivenBadgeRefresh();
}

function recordUnconfiguredBackendHealth(client) {
  setBackendRuntimeHealth(client, {
    successful: false,
    errorText: 'Not configured',
    sticky: false,
  });
  queueRuntimeDrivenBadgeRefresh();
}

async function fetchSabJson(url, signal, { allowEmpty = false } = {}) {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    if ([401, 403].includes(response.status)) {
      throw new Error(`HTTP ${response.status}: Invalid API Key`);
    }
    if ([404].includes(response.status)) {
      throw new Error(`HTTP ${response.status}: Invalid Endpoint`);
    }
    if ([502, 503, 504].includes(response.status)) {
      throw new Error(`HTTP ${response.status}: Endpoint Unreachable`);
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!text.trim()) {
    if (allowEmpty) return {};
    throw new Error('Empty SABnzbd response');
  }

  if (!contentType.includes('json')) {
    const normalizedText = text.trim().toUpperCase();
    if (normalizedText.startsWith('<!DOCTYPE') || normalizedText.startsWith('<HTML')) {
      throw new Error('Invalid Endpoint');
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    const normalizedText = text.trim().toUpperCase();
    if (normalizedText.startsWith('<!DOCTYPE') || normalizedText.startsWith('<HTML')) {
      throw new Error('Invalid Endpoint');
    }
    throw new Error('Unexpected SAB response');
  }
}

getConfig()
  .then((config) => syncQbitHeaderRule(config.qbitUrl, config.qbitEnabled))
  .catch((err) => console.warn('Failed to initialize qBittorrent header rules:', err));

migrateLegacySyncLogs();
queueBackendBadgeRefresh();
scheduleBackendBadgeRefresh();
queueBackgroundBadgeProbe();

chrome.runtime.onInstalled.addListener(() => {
  queueBackendBadgeRefresh();
  scheduleBackendBadgeRefresh();
  queueBackgroundBadgeProbe();
});

chrome.runtime.onStartup.addListener(() => {
  queueBackendBadgeRefresh();
  scheduleBackendBadgeRefresh();
  queueBackgroundBadgeProbe();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BACKEND_BADGE_ALARM) return;
  if (!ENABLE_BACKGROUND_BADGE_PROBES) return;
  queueBackendBadgeRefresh();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;

  const qbitRuleChanged = Boolean(changes.qbitUrl || changes.qbitEnabled);
  const badgeRelevantChange = Boolean(
    changes.qbitUrl ||
    changes.qbitUser ||
    changes.qbitPass ||
    changes.qbitEnabled ||
    changes.sabUrl ||
    changes.sabKey ||
    changes.sabEnabled,
  );

  if (qbitRuleChanged) {
    const nextUrl = changes.qbitUrl ? changes.qbitUrl.newValue : undefined;
    const nextEnabled = changes.qbitEnabled ? changes.qbitEnabled.newValue : undefined;

    getConfig()
      .then((config) =>
        syncQbitHeaderRule(
          nextUrl !== undefined ? nextUrl : config.qbitUrl,
          nextEnabled !== undefined ? nextEnabled : config.qbitEnabled,
        ),
      )
      .catch((err) => console.warn('Failed to update qBittorrent header rules:', err));
  }

  if (badgeRelevantChange) {
    clearRuntimeHealthForChangedConfig(changes);
    queueBackendBadgeRefresh();
  }
});

// API integrations
async function testQbit(url, user, pass, controller = new AbortController()) {
  let timeout;
  let cleanUrl = '';
  let timeoutTriggered = false;

  try {
    cleanUrl = normalizeQbitUrl(url);
    logActivity(
      'Testing qBittorrent connection...',
      'info',
      `[Endpoint] ${cleanUrl}/api/v2/auth/login\n[Username] ${user || '(blank)'}`,
      true,
      'warp: Testing',
    );

    timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, 5000);

    try {
      await ensureQbitSessionForConfig(cleanUrl, { user, pass }, controller.signal);
    } catch (authErr) {
      const authError = authErr?.message || 'Auth failed: Unknown Error';
      const debugPayload = `[Endpoint] ${cleanUrl}/api/v2/auth/login\n[Payload] username=${user}&password=${pass.replace(/./g, '*')}\n[Result] ${authError}`;
      logActivity(
        'qBittorrent Verification Failed',
        'error',
        debugPayload,
        true,
        'warp: Test Failed',
      );
      return { success: false, error: authError };
    }

    const verifyRes = await fetch(`${cleanUrl}/api/v2/app/version`, {
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!verifyRes.ok) {
      const debugPayload = `[Endpoint] ${cleanUrl}/api/v2/app/version\n[Response] HTTP ${verifyRes.status}`;
      logActivity('qBittorrent Verification Failed', 'error', debugPayload);
      return { success: false, error: `HTTP ${verifyRes.status}: Session Verification Failed` };
    }

    logActivity(
      'qBittorrent Verification Succeeded',
      'success',
      `[Endpoint] ${cleanUrl}/api/v2/app/version\n[Result] Connection verified successfully`,
      true,
      'warp: Verified',
    );
    return { success: true };
  } catch (err) {
    const errorMessage =
      err.name === 'AbortError' ? (timeoutTriggered ? 'TIMEOUT' : 'CANCELED') : err.message;
    if (errorMessage === 'CANCELED') {
      return { success: false, canceled: true, error: errorMessage };
    }
    logActivity(
      'qBittorrent Verification Failed',
      'error',
      `[Endpoint] ${cleanUrl || url}\n[Result] ${errorMessage}`,
      true,
      'warp: Test Failed',
    );
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeout);
  }
}

async function testSab(url, key, controller = new AbortController()) {
  let cleanUrl = '';
  let timeout;
  let timeoutTriggered = false;

  try {
    cleanUrl = normalizeSabUrl(url);
    logActivity(
      'Testing SABnzbd connection...',
      'info',
      `[Endpoint] ${cleanUrl}/api?mode=queue\n[API Key] ${key ? `${key.slice(0, 4)}...` : '(blank)'}`,
      true,
      'warp: Testing',
    );

    timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, 5000);

    const data = await ensureSabApiKeyValidity(cleanUrl, key, controller.signal, {
      requireStrictProbe: true,
    });

    clearTimeout(timeout);
    logActivity(
      'SABnzbd Verification Succeeded',
      'success',
      `[Endpoint] ${cleanUrl}/api?mode=queue\n[Result] Connection verified successfully\n[Queue Items] ${Array.isArray(data?.queue?.slots) ? data.queue.slots.length : 0}`,
      true,
      'warp: Verified',
    );
    return { success: true };
  } catch (err) {
    const errorMessage =
      err.name === 'AbortError'
        ? timeoutTriggered
          ? 'TIMEOUT'
          : 'CANCELED'
        : mapSabFetchError(err);
    if (errorMessage === 'CANCELED') {
      return { success: false, canceled: true, error: errorMessage };
    }
    logActivity(
      'SABnzbd Verification Failed',
      'error',
      `[Endpoint] ${cleanUrl || url}\n[Result] ${errorMessage}`,
      true,
      'warp: Test Failed',
    );
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeout);
  }
}

// Send to remote clients
async function sendToQbit(magnetOrUrl) {
  const config = await getConfig();
  if (!config.qbitUrl) throw new Error('qBittorrent not configured');

  const cleanUrl = normalizeQbitUrl(config.qbitUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    await ensureQbitSessionForConfig(
      cleanUrl,
      { user: config.qbitUser, pass: config.qbitPass },
      controller.signal,
    );

    // Add Torrent
    const formData = new FormData();
    formData.append('urls', magnetOrUrl);

    const addRes = await fetch(`${cleanUrl}/api/v2/torrents/add`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      signal: controller.signal,
    });

    if (!addRes.ok) throw new Error('Failed to add to qBittorrent');
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendToSab(targetUrl) {
  const config = await getConfig();
  if (!config.sabUrl || !config.sabKey) throw new Error('SABnzbd not configured');

  const cleanUrl = normalizeSabUrl(config.sabUrl);
  const { blob, filename } = await fetchNzbPayload(targetUrl);
  const formData = new FormData();
  formData.append('mode', 'addfile');
  formData.append('apikey', config.sabKey);
  formData.append('output', 'json');
  formData.append('nzbname', filename);
  formData.append('name', blob, filename);

  const addRes = await fetchWithTimeout(
    `${cleanUrl}/api`,
    {
      method: 'POST',
      body: formData,
    },
    30000,
    'Timed out uploading NZB to SABnzbd',
  );
  if (!addRes.ok) throw new Error(`SABnzbd returned HTTP ${addRes.status}`);
  const data = await addRes.json();

  if (data && data.status === false) throw new Error(data.error || 'Failed to add to SABnzbd');
  return { filename };
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'register_download_gesture') {
    markRecentDownloadGesture(request.url, sender.tab?.id, request.filename, request.mime);
    sendResponse({ received: true });
    return false;
  }

  if (request.action === 'refresh_backend_badge') {
    refreshBackendBadgeState({ preferRuntime: true })
      .then(() => sendResponse({ success: true }))
      .catch((err) =>
        sendResponse({ success: false, error: err?.message || 'BADGE_REFRESH_FAILED' }),
      );
    return true;
  }

  if (request.action === 'runtime_backend_health') {
    const payload = request.payload || {};
    const client = payload.client;

    if (client !== 'qbit' && client !== 'sab') {
      sendResponse({ success: false, error: 'INVALID_CLIENT' });
      return false;
    }

    if (payload.clear) {
      clearBackendRuntimeHealth(client);
      queueRuntimeDrivenBadgeRefresh();
      sendResponse({ success: true });
      return false;
    }

    if (typeof payload.successful !== 'boolean') {
      sendResponse({ success: false, error: 'MISSING_SUCCESS_FLAG' });
      return false;
    }

    setBackendRuntimeHealth(client, {
      successful: payload.successful,
      errorText: payload.errorText || '',
      sticky: payload.sticky === true,
    });
    queueRuntimeDrivenBadgeRefresh();
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'test_qbit_direct') {
    const { url, param1, param2, requestId } = request.payload;
    const controller = new AbortController();
    if (requestId) activeDirectTests.set(requestId, controller);
    (async () => {
      try {
        await syncQbitHeaderRule(url, true);
        const result = await testQbit(url, param1, param2, controller);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err?.message || 'EXTENSION ERROR' });
      } finally {
        if (requestId) activeDirectTests.delete(requestId);
        try {
          const config = await getConfig();
          await syncQbitHeaderRule(config.qbitUrl, config.qbitEnabled);
        } catch (restoreErr) {
          console.warn('Failed to restore qBittorrent header rules after direct test:', restoreErr);
        }
      }
    })();
    return true; // async
  }

  if (request.action === 'test_sab_direct') {
    const { url, param1, requestId } = request.payload;
    const controller = new AbortController();
    if (requestId) activeDirectTests.set(requestId, controller);
    testSab(url, param1, controller)
      .then(sendResponse)
      .finally(() => {
        if (requestId) activeDirectTests.delete(requestId);
      });
    return true; // async
  }

  if (request.action === 'cancel_direct_test') {
    const requestId = request.payload?.requestId;
    if (requestId && activeDirectTests.has(requestId)) {
      activeDirectTests.get(requestId).abort();
      activeDirectTests.delete(requestId);
    }
    sendResponse({ success: false, canceled: true });
    return false;
  }

  if (request.action === 'fetch_stats_qbit') {
    getConfig().then(async (config) => {
      let timeout;

      try {
        if (!config.qbitEnabled) {
          recordDisabledBackendHealth('qbit');
          sendResponse({ success: false, error: 'Disabled' });
          return;
        }
        if (!config.qbitUrl) {
          recordUnconfiguredBackendHealth('qbit');
          sendResponse({ success: false, error: mapQbitStatsErrorForPopup('Not configured') });
          return;
        }
        const cleanUrl = normalizeQbitUrl(config.qbitUrl);

        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 2000);

        const res = await fetchQbitAuthenticated(
          cleanUrl,
          '/api/v2/transfer/info',
          {},
          { user: config.qbitUser, pass: config.qbitPass },
          controller.signal,
          { requireCredentialValidation: true },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const recentRes = await fetchQbitAuthenticated(
          cleanUrl,
          '/api/v2/torrents/info?sort=added_on&reverse=true',
          {},
          { user: config.qbitUser, pass: config.qbitPass },
          controller.signal,
        );
        if (!recentRes.ok) throw new Error(`HTTP ${recentRes.status}`);

        const transfer = await res.json();
        const recent = await recentRes.json();
        recordLiveBackendHealth('qbit', true);
        sendResponse({
          success: true,
          data: {
            transfer,
            recent: Array.isArray(recent) ? recent.slice(0, 5).map(formatQbitRecentItem) : [],
          },
        });
      } catch (err) {
        const errorText = mapQbitFetchError(err);
        recordLiveBackendHealth('qbit', false, errorText);
        sendResponse({ success: false, error: mapQbitStatsErrorForPopup(errorText) });
      } finally {
        clearTimeout(timeout);
      }
    });
    return true;
  }

  if (request.action === 'fetch_stats_sab') {
    getConfig().then(async (config) => {
      let timeout;
      try {
        if (!config.sabEnabled) {
          recordDisabledBackendHealth('sab');
          sendResponse({ success: false, error: 'Disabled' });
          return;
        }
        if (!config.sabUrl || !config.sabKey) {
          recordUnconfiguredBackendHealth('sab');
          sendResponse({ success: false, error: mapSabStatsErrorForPopup('Not configured') });
          return;
        }
        let cleanUrl = config.sabUrl.replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'http://' + cleanUrl;

        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 2000);

        const data = await ensureSabApiKeyValidity(cleanUrl, config.sabKey, controller.signal, {
          requireStrictProbe: true,
        });
        const historyData = await fetchSabJson(
          `${cleanUrl}/api?mode=history&limit=5&output=json&apikey=${config.sabKey}`,
          controller.signal,
          { allowEmpty: true },
        );
        const historyError = getSabApiResponseError(historyData);
        if (historyError) throw new Error(historyError);
        const queueItems = Array.isArray(data.queue.slots)
          ? data.queue.slots.map((item) => formatSabRecentItem(item, 'queue'))
          : [];
        const historyItems = Array.isArray(historyData?.history?.slots)
          ? historyData.history.slots.map((item) => formatSabRecentItem(item, 'history'))
          : [];
        const recent = [...queueItems, ...historyItems]
          .sort((a, b) => (b.timeAdded || 0) - (a.timeAdded || 0))
          .slice(0, 5);
        recordLiveBackendHealth('sab', true);
        sendResponse({
          success: true,
          data: {
            queue: data.queue,
            recent,
          },
        });
      } catch (err) {
        const errorText = mapSabFetchError(err);
        recordLiveBackendHealth('sab', false, errorText);
        sendResponse({ success: false, error: mapSabStatsErrorForPopup(errorText) });
      } finally {
        clearTimeout(timeout);
      }
    });
    return true;
  }

  if (request.action === 'siphon_magnet') {
    const magnetMeta = parseMagnetMetadata(request.url);
    showPageToast('Siphoning magnet link...', sender.tab?.id);
    logActivity(
      'Intercepting magnet link...',
      'info',
      `[Route] qBittorrent\n[Name] ${magnetMeta.name}\n[Hash] ${magnetMeta.hash || 'Unknown'}\n[URL] ${request.url}`,
      true,
      'warp: Siphoning',
    );

    // Check enabled states before routing
    getConfig().then((config) => {
      if (config.qbitEnabled) {
        sendToQbit(request.url)
          .then(() => {
            showPageToast('Magnet siphoned to qBittorrent.', sender.tab?.id, 'success');
            logActivity(
              'Successfully sent magnet to qBittorrent',
              'success',
              `[Route] qBittorrent\n[Name] ${magnetMeta.name}\n[Hash] ${magnetMeta.hash || 'Unknown'}\n[URL] ${request.url}`,
              true,
              'warp: Siphoned',
            );
          })
          .catch((err) => {
            showPageToast('Magnet siphon failed.', sender.tab?.id, 'error');
            logActivity(
              'Failed to send magnet to qBittorrent',
              'error',
              `[Route] qBittorrent\n[Name] ${magnetMeta.name}\n[Hash] ${magnetMeta.hash || 'Unknown'}\n[Error] ${err.message}\n[URL] ${request.url}`,
              true,
              'warp: Siphon Failed',
            );
          });
      } else if (config.sabEnabled) {
        // Fallback or ignore? SABnzbd doesn't do magnets but maybe something else does
        showPageToast('Magnet siphon failed.', sender.tab?.id, 'error');
        logActivity(
          'qBittorrent is disabled. Magnet dropped.',
          'error',
          `[Name] ${magnetMeta.name}\n[Hash] ${magnetMeta.hash || 'Unknown'}\n[URL] ${request.url}\n[Result] Enable qBittorrent to catch magnet intents.`,
          true,
          'warp: Siphon Failed',
        );
      }
    });

    sendResponse({ received: true });
    return false;
  }

  if (request.action === 'siphon_download') {
    getConfig().then((config) => {
      const kind =
        request.kind === 'torrent' || request.kind === 'nzb'
          ? request.kind
          : inferSiphonKind(request.url, request.filename, request.mime);
      if (!kind) {
        sendResponse({ handled: false });
        return;
      }

      if ((kind === 'torrent' && !config.qbitEnabled) || (kind === 'nzb' && !config.sabEnabled)) {
        sendResponse({ handled: false });
        return;
      }

      beginDownloadSiphon(kind, request.url, sender.tab?.id, request.filename);
      sendResponse({ handled: true });
    });

    return true;
  }
});

async function fetchNzbPayload(targetUrl, signal) {
  const response = await fetchWithTimeout(
    targetUrl,
    {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal,
    },
    15000,
    'Timed out downloading NZB from source',
  );

  if (!response.ok) {
    throw new Error(`Failed to download NZB: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error('Downloaded NZB payload was empty');
  }

  const sniff = await blob
    .slice(0, 512)
    .text()
    .catch(() => '');
  if (
    response.headers.get('content-type')?.includes('text/html') ||
    /<(!doctype html|html\b)/i.test(sniff)
  ) {
    throw new Error('NZB download returned HTML instead of an NZB file');
  }

  return {
    blob,
    filename: inferNzbFilename(targetUrl, response.headers),
  };
}

function parseMagnetMetadata(magnetUrl) {
  const queryString = magnetUrl.split('?')[1] || '';
  const params = new URLSearchParams(queryString);

  return {
    name: params.get('dn') || 'Unnamed magnet',
    hash: params.get('xt') || '',
  };
}

function inferNzbFilename(targetUrl, headers) {
  const disposition = headers.get('content-disposition') || '';
  const encodedMatch = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (encodedMatch) {
    return ensureNzbExtension(decodeURIComponent(encodedMatch[1]));
  }

  const plainMatch = disposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  const rawFilename = plainMatch ? (plainMatch[1] || plainMatch[2] || '').trim() : '';
  if (rawFilename) {
    return ensureNzbExtension(rawFilename.replace(/^["']|["']$/g, ''));
  }

  try {
    const parsed = new URL(targetUrl);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) {
      return ensureNzbExtension(decodeURIComponent(lastSegment));
    }
  } catch (err) {
    console.warn('Unable to parse NZB filename from URL:', err);
  }

  return 'download.nzb';
}

function ensureNzbExtension(filename) {
  const safeName = filename || 'download.nzb';
  return /\.nzb$/i.test(safeName) ? safeName : `${safeName}.nzb`;
}

function inferFilenameFromUrl(targetUrl, fallback = 'download') {
  try {
    const parsed = new URL(targetUrl);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }
  } catch (err) {
    console.warn('Unable to infer filename from URL:', err);
  }

  return fallback;
}

function inferSiphonKind(targetUrl, hintedFilename = '', mime = '') {
  const candidates = [targetUrl, hintedFilename].filter(Boolean);
  const normalizedMime = (mime || '').toLowerCase();

  if (
    candidates.some((value) => matchesDownloadExtension(value, 'torrent')) ||
    normalizedMime.includes('bittorrent')
  ) {
    return 'torrent';
  }

  if (
    candidates.some((value) => matchesDownloadExtension(value, 'nzb')) ||
    matchesNzbMime(normalizedMime)
  ) {
    return 'nzb';
  }

  return null;
}

function matchesNzbMime(mime) {
  return mime.includes('x-nzb') || mime.includes('nzb+xml') || mime.endsWith('/nzb');
}

function matchesDownloadExtension(value, extension) {
  const needle = `.${extension}`.toLowerCase();
  const normalized = (value || '').toString().toLowerCase();

  if (!normalized) return false;
  if (normalized.includes(needle)) return true;

  try {
    const parsed = new URL(value);
    if (parsed.pathname.toLowerCase().includes(needle)) return true;
    return [...parsed.searchParams.values()].some((paramValue) =>
      decodeURIComponent(paramValue).toLowerCase().includes(needle),
    );
  } catch {
    return false;
  }
}

function beginDownloadSiphon(kind, url, tabId, filename) {
  const inferredName =
    filename || inferFilenameFromUrl(url, kind === 'torrent' ? 'download.torrent' : 'download.nzb');
  const route = kind === 'torrent' ? 'qBittorrent' : 'SABnzbd';

  showPageToast(`Siphoning ${kind === 'torrent' ? '.torrent' : '.nzb'} download...`, tabId, 'info');
  logActivity(
    `Intercepted explicit ${kind === 'torrent' ? '.torrent' : '.nzb'} download...`,
    'info',
    `[Route] ${route}\n[File] ${inferredName}\n[URL] ${url}`,
    true,
    'warp: Siphoning',
  );

  const siphonPromise = kind === 'torrent' ? sendToQbit(url) : sendToSab(url);
  siphonPromise
    .then((result) => {
      showPageToast(
        `${kind === 'torrent' ? '.torrent' : '.nzb'} siphoned to ${route}.`,
        tabId,
        'success',
      );
      logActivity(
        `Successfully siphoned ${kind === 'torrent' ? '.torrent' : '.nzb'} to ${route}`,
        'success',
        `[Route] ${route}\n[File] ${result?.filename || inferredName}\n[URL] ${url}`,
        true,
        'warp: Siphoned',
      );
    })
    .catch((err) => {
      showPageToast(`${kind === 'torrent' ? '.torrent' : '.nzb'} siphon failed.`, tabId, 'error');
      logActivity(
        `Failed to siphon ${kind === 'torrent' ? '.torrent' : '.nzb'}: ${err.message}`,
        'error',
        `[Route] ${route}\n[File] ${inferredName}\n[Error] ${err.message}\n[URL] ${url}`,
        true,
        'warp: Siphon Failed',
      );
    });
}

function eraseInterceptedDownload(downloadId, attempt = 0) {
  if (typeof downloadId !== 'number' || downloadId < 0 || !chrome.downloads?.erase) return;

  chrome.downloads.erase({ id: downloadId }, (erasedIds) => {
    if (chrome.runtime.lastError) {
      if (attempt < 2) {
        setTimeout(() => eraseInterceptedDownload(downloadId, attempt + 1), 200 * (attempt + 1));
      }
      return;
    }

    if (!Array.isArray(erasedIds) || !erasedIds.includes(downloadId)) {
      if (attempt < 2) {
        setTimeout(() => eraseInterceptedDownload(downloadId, attempt + 1), 200 * (attempt + 1));
      }
    }
  });
}

chrome.downloads?.onCreated.addListener((item) => {
  if (!ENABLE_DOWNLOADS_API_FALLBACK_SIPHON) return;

  const url = item.finalUrl || item.url || '';
  const filename = item.filename || '';
  const kind = inferSiphonKind(url, filename, item.mime);

  if (item.state && item.state !== 'in_progress') return;

  getConfig().then((config) => {
    if (!config.qbitEnabled && !config.sabEnabled) {
      return;
    }

    const gesture = consumeRecentDownloadGesture(url);
    if (!gesture) {
      return;
    }

    if (!kind) {
      rememberPendingGestureDownload({
        ...item,
        senderTabId: gesture.senderTabId,
      });
      return;
    }

    if ((kind === 'torrent' && !config.qbitEnabled) || (kind === 'nzb' && !config.sabEnabled)) {
      return;
    }

    chrome.downloads.cancel(item.id, () => {
      if (chrome.runtime.lastError) {
        console.warn('Could not cancel siphoned download:', chrome.runtime.lastError.message);
        return;
      }

      eraseInterceptedDownload(item.id);
    });

    beginDownloadSiphon(kind, url, gesture.senderTabId, filename);
  });
});

chrome.downloads?.onChanged.addListener((delta) => {
  if (!ENABLE_DOWNLOADS_API_FALLBACK_SIPHON) return;

  const pending = getPendingGestureDownload(delta.id);
  if (!pending) return;

  if (delta.state?.current && delta.state.current !== 'in_progress') {
    forgetPendingGestureDownload(delta.id);
    return;
  }

  chrome.downloads.search({ id: delta.id }, (items) => {
    if (chrome.runtime.lastError) {
      console.warn('Could not inspect pending download:', chrome.runtime.lastError.message);
      return;
    }

    const item = items?.[0];
    if (!item) {
      forgetPendingGestureDownload(delta.id);
      return;
    }

    const url = item.finalUrl || item.url || pending.url || '';
    const filename = item.filename || pending.filename || '';
    const kind = inferSiphonKind(url, filename, item.mime);

    if (!kind) {
      if (item.state && item.state !== 'in_progress') forgetPendingGestureDownload(delta.id);
      return;
    }

    getConfig().then((config) => {
      if ((kind === 'torrent' && !config.qbitEnabled) || (kind === 'nzb' && !config.sabEnabled)) {
        forgetPendingGestureDownload(delta.id);
        return;
      }

      forgetPendingGestureDownload(delta.id);

      chrome.downloads.cancel(item.id, () => {
        if (chrome.runtime.lastError) {
          console.warn('Could not cancel siphoned download:', chrome.runtime.lastError.message);
          return;
        }

        eraseInterceptedDownload(item.id);
      });

      beginDownloadSiphon(kind, url, pending.senderTabId, filename);
    });
  });
});
