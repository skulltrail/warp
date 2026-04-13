document.addEventListener('DOMContentLoaded', () => {
  const appContainer = document.querySelector('.app-container');
  const panelTitle = document.getElementById('panel-title');
  const manifest = chrome.runtime.getManifest();
  const ABOUT_AUTHOR = 'skulltrail';
  const ABOUT_GITHUB_URL = 'https://github.com/skulltrail/warp';

  const views = {
    main: document.getElementById('view-main'),
    logs: document.getElementById('view-logs'),
    settings: document.getElementById('view-settings'),
    about: document.getElementById('view-about'),
  };
  const dashboardStack = document.querySelector('.dashboard-stack');
  const navButtons = {
    main: document.getElementById('nav-main'),
    logs: document.getElementById('nav-logs'),
    settings: document.getElementById('nav-settings'),
  };
  const navMainBadge = document.getElementById('nav-main-badge');
  const aboutNavButton = document.getElementById('nav-about');
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const panelMeta = {
    main: {
      title: 'warp DASHBOARD',
    },
    logs: {
      title: 'ACTIVITY LOGS',
    },
    settings: {
      title: 'SETTINGS',
    },
    about: {
      title: 'ABOUT warp',
    },
  };

  const qbitUrl = document.getElementById('qbit-url');
  const qbitUser = document.getElementById('qbit-user');
  const qbitPass = document.getElementById('qbit-pass');
  const qbitEnabled = document.getElementById('qbit-enabled');
  const qbitCard = document.getElementById('qbit-card');
  const qbitLogoToggle = qbitCard.querySelector('.backend-logo-toggle');
  const qbitEditor = document.getElementById('qbit-editor');
  const qbitUrlGroup = document.getElementById('qbit-url-group');
  const qbitErrorMsg = document.getElementById('qbit-error-msg');
  const qbitDashboardStatus = document.getElementById('qbit-dashboard-status');
  const qbitStatusLabel = document.getElementById('qbit-status-label');
  const qbitEndpointUrl = document.getElementById('qbit-endpoint-url');
  const editQbitBtn = document.getElementById('edit-qbit');
  const testQbitBtn = document.getElementById('test-qbit');
  const saveQbitBtn = document.getElementById('save-qbit');

  const sabUrl = document.getElementById('sab-url');
  const sabKey = document.getElementById('sab-key');
  const sabEnabled = document.getElementById('sab-enabled');
  const sabCard = document.getElementById('sab-card');
  const sabLogoToggle = sabCard.querySelector('.backend-logo-toggle');
  const sabEditor = document.getElementById('sab-editor');
  const sabUrlGroup = document.getElementById('sab-url-group');
  const sabErrorMsg = document.getElementById('sab-error-msg');
  const sabDashboardStatus = document.getElementById('sab-dashboard-status');
  const sabStatusLabel = document.getElementById('sab-status-label');
  const sabEndpointUrl = document.getElementById('sab-endpoint-url');
  const editSabBtn = document.getElementById('edit-sab');
  const testSabBtn = document.getElementById('test-sab');
  const saveSabBtn = document.getElementById('save-sab');

  const clearLogsBtn = document.getElementById('clear-logs');
  const resetSettingsBtn = document.getElementById('reset-settings');
  const confirmOverlay = document.getElementById('confirm-overlay');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmAcceptBtn = document.getElementById('confirm-accept');
  const confirmCancelBtn = document.getElementById('confirm-cancel');

  const logsListScreen = document.getElementById('logs-list-screen');
  const logsDetailScreen = document.getElementById('logs-detail-screen');
  const logsListContent = document.getElementById('logs-list-content');
  const activityLogInteractive = document.getElementById('full-activity-log');
  const logDetailBackBtn = document.getElementById('logs-detail-back');
  const logDetailStatus = document.getElementById('log-detail-status');
  const logDetailTime = document.getElementById('log-detail-time');
  const logDetailMessage = document.getElementById('log-detail-message');
  const logDetailTrace = document.getElementById('log-detail-trace');
  const aboutName = document.getElementById('about-name');
  const aboutVersion = document.getElementById('about-version');
  const aboutUpdated = document.getElementById('about-updated');
  const aboutAuthor = document.getElementById('about-author');
  const aboutGithub = document.getElementById('about-github');
  const aboutGithubFallback = document.getElementById('about-github-fallback');
  const settingThemeMode = document.getElementById('setting-theme-mode');
  const settingNotifications = document.getElementById('setting-notifications');
  const settingPageToasts = document.getElementById('setting-page-toasts');
  const settingConfirmActions = document.getElementById('setting-confirm-actions');

  let pollingInterval = null;
  let pollInFlight = false;
  let renderedLogs = [];
  let selectedLogKey = null;
  let logsListScrollTop = 0;
  let confirmResolver = null;
  let themeMode = 'system';
  let notificationsEnabled = true;
  let pageToastsEnabled = true;
  let confirmDangerActions = true;
  const editorState = {
    qbit: false,
    sab: false,
  };
  const manualTests = {
    qbit: { requestId: null, promise: null, resolve: null },
    sab: { requestId: null, promise: null, resolve: null },
  };
  const backendVerification = {
    qbit: { signature: null, status: 'untested', errorText: '' },
    sab: { signature: null, status: 'untested', errorText: '' },
  };
  const backendHealth = {
    qbit: { consecutiveFailures: 0, hasSucceeded: false, status: 'idle', errorText: '' },
    sab: { consecutiveFailures: 0, hasSucceeded: false, status: 'idle', errorText: '' },
  };
  const persistedBackendConfig = {
    qbitUrl: '',
    qbitUser: '',
    qbitPass: '',
    qbitEnabled: true,
    sabUrl: '',
    sabKey: '',
    sabEnabled: true,
  };
  const statusRenderTimers = {
    qbit: null,
    sab: null,
  };
  const draftHealthTimers = {
    qbit: null,
    sab: null,
  };
  const statusRenderKeys = {
    qbit: '',
    sab: '',
  };
  const badgeSyncStatusKeys = {
    qbit: '',
    sab: '',
  };
  const STATUS_SETTLE_DELAY_MS = 180;
  const testButtonDefaults = new Map([
    [testQbitBtn, 'TEST'],
    [testSabBtn, 'TEST'],
  ]);
  const saveButtonDefaults = new Map([
    [saveQbitBtn, 'SAVE'],
    [saveSabBtn, 'SAVE'],
  ]);

  const inputs = [qbitUrl, qbitUser, qbitPass, qbitEnabled, sabUrl, sabKey, sabEnabled];

  function normalizeThemeMode(value) {
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  }

  function resolveTheme() {
    return themeMode === 'system' ? (systemThemeQuery.matches ? 'dark' : 'light') : themeMode;
  }

  function applyTheme(theme) {
    appContainer.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  function applyResolvedTheme() {
    applyTheme(resolveTheme());
  }

  function persistUserSettings() {
    chrome.storage.sync.set({
      themeMode,
      notificationsEnabled,
      pageToastsEnabled,
      confirmDangerActions,
    });
  }

  function applyUserSettingsControls() {
    settingThemeMode.value = themeMode;
    settingNotifications.checked = notificationsEnabled;
    settingPageToasts.checked = pageToastsEnabled;
    settingConfirmActions.checked = confirmDangerActions;
  }

  async function requestDangerConfirmation(options) {
    if (!confirmDangerActions) return true;
    return openConfirmDialog(options);
  }

  function syncBackendToggleAffordance(client) {
    const toggle = client === 'qbit' ? qbitLogoToggle : sabLogoToggle;
    const label = client === 'qbit' ? 'qBittorrent' : 'SABnzbd';
    const enabled = client === 'qbit' ? qbitEnabled.checked : sabEnabled.checked;
    const action = enabled ? 'Disable' : 'Enable';

    toggle.setAttribute('aria-label', `${action} ${label}`);
  }

  function syncBackendToggleAffordances() {
    syncBackendToggleAffordance('qbit');
    syncBackendToggleAffordance('sab');
  }

  Object.entries(navButtons).forEach(([viewName, button]) => {
    button.addEventListener('click', () => switchView(viewName));
  });
  aboutNavButton.addEventListener('click', () => switchView('about'));
  settingThemeMode.addEventListener('change', () => {
    themeMode = normalizeThemeMode(settingThemeMode.value);
    applyResolvedTheme();
    persistUserSettings();
  });
  settingNotifications.addEventListener('change', () => {
    notificationsEnabled = Boolean(settingNotifications.checked);
    persistUserSettings();
    requestBackendBadgeRefresh();
  });
  settingPageToasts.addEventListener('change', () => {
    pageToastsEnabled = Boolean(settingPageToasts.checked);
    persistUserSettings();
  });
  settingConfirmActions.addEventListener('change', () => {
    confirmDangerActions = Boolean(settingConfirmActions.checked);
    persistUserSettings();
  });

  const onSystemThemeChange = () => {
    if (themeMode !== 'system') return;
    applyResolvedTheme();
  };

  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', onSystemThemeChange);
  } else if (typeof systemThemeQuery.addListener === 'function') {
    systemThemeQuery.addListener(onSystemThemeChange);
  }

  function applyNavBadgeState(state) {
    const text = (state?.text || '').toString().trim();
    const severity = state?.severity || 'none';

    navMainBadge.classList.remove('status-warning', 'status-error');

    if (!text) {
      navMainBadge.hidden = true;
      navMainBadge.textContent = '';
      return;
    }

    navMainBadge.hidden = false;
    navMainBadge.textContent = text;

    if (severity === 'warning') navMainBadge.classList.add('status-warning');
    if (severity === 'error') navMainBadge.classList.add('status-error');
  }

  function requestBackendBadgeRefresh() {
    chrome.runtime.sendMessage({ action: 'refresh_backend_badge' }, () => {
      if (chrome.runtime.lastError) {
        console.debug('Badge refresh request skipped:', chrome.runtime.lastError.message);
      }
    });
  }

  function sendRuntimeBackendHealth(
    client,
    { successful, errorText = '', clear = false, sticky = false } = {},
  ) {
    chrome.runtime.sendMessage(
      {
        action: 'runtime_backend_health',
        payload: {
          client,
          successful,
          errorText,
          clear,
          sticky,
        },
      },
      () => {
        if (chrome.runtime.lastError) {
          console.debug('Runtime health update skipped:', chrome.runtime.lastError.message);
        }
      },
    );
  }

  function syncBadgeFromBackendStatus(client, status, errorText = '') {
    const normalizedError = String(errorText || '').trim();
    const syncKey = `${status}|${normalizedError}`;
    if (badgeSyncStatusKeys[client] === syncKey) return;

    badgeSyncStatusKeys[client] = syncKey;

    if (status === 'disabled') {
      sendRuntimeBackendHealth(client, { clear: true });
      requestBackendBadgeRefresh();
      return;
    }

    if (status === 'online') {
      sendRuntimeBackendHealth(client, { successful: true });
      requestBackendBadgeRefresh();
      return;
    }

    if (status === 'warning' || status === 'error') {
      sendRuntimeBackendHealth(client, {
        successful: false,
        errorText: normalizedError || 'CONNECTIVITY ISSUE',
        sticky: normalizedError === 'UNSAVED CHANGES',
      });
      requestBackendBadgeRefresh();
    }
  }

  function getBackendClientFromInput(input) {
    const id = input?.id || '';
    if (id.startsWith('qbit-')) return 'qbit';
    if (id.startsWith('sab-')) return 'sab';
    return null;
  }

  function syncPersistedBackendConfig(nextState = {}) {
    Object.keys(persistedBackendConfig).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(nextState, key)) {
        persistedBackendConfig[key] = nextState[key];
      }
    });
  }

  function getBackendDraftSignature(client) {
    if (client === 'qbit') {
      return JSON.stringify({
        url: normalizeDisplayUrl(qbitUrl.value),
        user: qbitUser.value.trim(),
        pass: qbitPass.value,
        enabled: Boolean(qbitEnabled.checked),
      });
    }

    return JSON.stringify({
      url: normalizeDisplayUrl(sabUrl.value),
      key: sabKey.value.trim(),
      enabled: Boolean(sabEnabled.checked),
    });
  }

  function getBackendPersistedSignature(client) {
    if (client === 'qbit') {
      return JSON.stringify({
        url: normalizeDisplayUrl(persistedBackendConfig.qbitUrl),
        user: (persistedBackendConfig.qbitUser || '').trim(),
        pass: persistedBackendConfig.qbitPass || '',
        enabled: Boolean(persistedBackendConfig.qbitEnabled),
      });
    }

    return JSON.stringify({
      url: normalizeDisplayUrl(persistedBackendConfig.sabUrl),
      key: (persistedBackendConfig.sabKey || '').trim(),
      enabled: Boolean(persistedBackendConfig.sabEnabled),
    });
  }

  function hasUnsavedBackendChanges(client) {
    return getBackendDraftSignature(client) !== getBackendPersistedSignature(client);
  }

  function scheduleDraftHealthSync(client) {
    if (draftHealthTimers[client]) {
      clearTimeout(draftHealthTimers[client]);
    }

    draftHealthTimers[client] = window.setTimeout(() => {
      draftHealthTimers[client] = null;
      if (!isBackendEnabled(client)) {
        sendRuntimeBackendHealth(client, { clear: true });
      } else if (hasUnsavedBackendChanges(client)) {
        sendRuntimeBackendHealth(client, {
          successful: false,
          errorText: 'UNSAVED CHANGES',
          sticky: true,
        });
      }
      requestBackendBadgeRefresh();
    }, 180);
  }

  function persistBackendEnabledStates() {
    chrome.storage.sync.set(
      {
        qbitEnabled: qbitEnabled.checked,
        sabEnabled: sabEnabled.checked,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.debug('Enabled-state sync skipped:', chrome.runtime.lastError.message);
          return;
        }
        syncPersistedBackendConfig({
          qbitEnabled: qbitEnabled.checked,
          sabEnabled: sabEnabled.checked,
        });
        requestBackendBadgeRefresh();
        triggerImmediateStatusRefresh();
      },
    );
  }

  inputs.forEach((input) => {
    input.addEventListener('input', () => {
      saveDraft();
      const client = getBackendClientFromInput(input);
      if (!client) return;
      if (input.type !== 'checkbox') {
        resetBackendVerification(client);
        if (hasUnsavedBackendChanges(client)) {
          setBackendHealthState(client, 'warning', { errorText: 'UNSAVED CHANGES' });
        } else if (isBackendEnabled(client)) {
          // When edits return to saved config, immediately transition out of stale warning/error.
          setBackendHealthState(client, 'checking');
          renderBackendStatus(client, { immediate: true });
          pollLiveStats();
        }
        scheduleDraftHealthSync(client);
      }
    });
    if (input.type === 'checkbox') {
      input.addEventListener('change', () => {
        saveDraft();
        const client = getBackendClientFromInput(input);
        if (client) {
          resetBackendVerification(client);
          scheduleDraftHealthSync(client);
        }
        persistBackendEnabledStates();
        window.setTimeout(() => input.blur(), 0);
      });
    }
  });

  editQbitBtn.addEventListener('click', () => handleEditorToggle('qbit'));
  editSabBtn.addEventListener('click', () => handleEditorToggle('sab'));

  testQbitBtn.addEventListener('click', () => {
    if (isManualTestActive('qbit')) {
      cancelManualTest('qbit');
      return;
    }
    performTest('qbit', qbitUrl.value.trim(), qbitUser.value.trim(), qbitPass.value);
  });

  testSabBtn.addEventListener('click', () => {
    if (isManualTestActive('sab')) {
      cancelManualTest('sab');
      return;
    }
    performTest('sab', sabUrl.value.trim(), sabKey.value.trim());
  });

  saveQbitBtn.addEventListener('click', () => saveBackend('qbit'));
  saveSabBtn.addEventListener('click', () => saveBackend('sab'));

  clearLogsBtn.addEventListener('click', async () => {
    const confirmed = await requestDangerConfirmation({
      title: 'Clear Logs',
      message: 'Do you really want to erase all activity records? This cannot be undone.',
      acceptLabel: 'Erase Logs',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!confirmed) return;
    selectedLogKey = null;
    showLogsList({ restoreScroll: false });
    chrome.storage.local.set({ logs: [] });
  });

  resetSettingsBtn.addEventListener('click', async () => {
    const confirmed = await requestDangerConfirmation({
      title: 'Reset Settings',
      message:
        'Do you really want to clear saved backend settings, drafts, hidden cards, and logs?',
      acceptLabel: 'Reset Everything',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!confirmed) return;

    const resetState = {
      qbitUrl: '',
      qbitUser: '',
      qbitPass: '',
      qbitEnabled: true,
      sabUrl: '',
      sabKey: '',
      sabEnabled: true,
      themeMode: 'system',
      notificationsEnabled: true,
      pageToastsEnabled: true,
      confirmDangerActions: true,
    };

    chrome.storage.sync.set(resetState, () => {
      chrome.storage.local.set(
        {
          activeView: 'main',
          logs: [],
          draft: {
            qbitUrl: '',
            qbitUser: '',
            qbitPass: '',
            qbitEnabled: true,
            sabUrl: '',
            sabKey: '',
            sabEnabled: true,
          },
        },
        () => {
          qbitUrl.value = '';
          qbitUser.value = '';
          qbitPass.value = '';
          qbitEnabled.checked = true;
          sabUrl.value = '';
          sabKey.value = '';
          sabEnabled.checked = true;
          themeMode = 'system';
          confirmDangerActions = true;
          settingThemeMode.value = themeMode;
          notificationsEnabled = true;
          pageToastsEnabled = true;
          settingNotifications.checked = true;
          settingPageToasts.checked = true;
          settingConfirmActions.checked = true;
          applyResolvedTheme();
          editorState.qbit = false;
          editorState.sab = false;
          if (manualTests.qbit.requestId) {
            finalizeManualTest('qbit', manualTests.qbit.requestId, {
              success: false,
              canceled: true,
              errorText: 'CANCELED',
            });
          }
          if (manualTests.sab.requestId) {
            finalizeManualTest('sab', manualTests.sab.requestId, {
              success: false,
              canceled: true,
              errorText: 'CANCELED',
            });
          }
          resetBackendVerification('qbit');
          resetBackendVerification('sab');
          selectedLogKey = null;
          setBackendHealthState('qbit', 'idle');
          setBackendHealthState('sab', 'idle');
          renderLogs([]);
          initializeDashboardPanels();
          updateStatus('qbit', 'disabled');
          updateStatus('sab', 'disabled');
          switchView('main');
        },
      );
    });
  });

  confirmAcceptBtn.addEventListener('click', () => resolveConfirmDialog(true));
  confirmCancelBtn.addEventListener('click', () => resolveConfirmDialog(false));
  confirmOverlay.addEventListener('click', (event) => {
    if (event.target === confirmOverlay) resolveConfirmDialog(false);
  });
  document.addEventListener('keydown', (event) => {
    if (confirmOverlay.hidden) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    resolveConfirmDialog(false);
  });

  logDetailBackBtn.addEventListener('click', () => {
    showLogsList();
  });

  chrome.storage.local.get(
    ['draft', 'activeView', 'logs', 'themePreference', 'backendBadgeState'],
    (localObj) => {
      chrome.storage.sync.get(
        {
          qbitUrl: '',
          qbitUser: '',
          qbitPass: '',
          qbitEnabled: true,
          sabUrl: '',
          sabKey: '',
          sabEnabled: true,
          themeMode: 'system',
          notificationsEnabled: true,
          pageToastsEnabled: true,
          confirmDangerActions: true,
        },
        (syncObj) => {
          syncPersistedBackendConfig(syncObj);
          const data = localObj.draft ? { ...syncObj, ...localObj.draft } : syncObj;
          const legacyThemePreference = localObj.themePreference;
          themeMode = normalizeThemeMode(syncObj.themeMode);
          if (
            themeMode === 'system' &&
            (legacyThemePreference === 'light' || legacyThemePreference === 'dark')
          ) {
            themeMode = legacyThemePreference;
          }
          notificationsEnabled = Boolean(syncObj.notificationsEnabled);
          pageToastsEnabled = Boolean(syncObj.pageToastsEnabled);
          confirmDangerActions = syncObj.confirmDangerActions !== false;
          applyUserSettingsControls();
          applyResolvedTheme();
          applyNavBadgeState(localObj.backendBadgeState);

          qbitUrl.value = data.qbitUrl;
          qbitUser.value = data.qbitUser;
          qbitPass.value = data.qbitPass;
          qbitEnabled.checked = data.qbitEnabled;
          sabUrl.value = data.sabUrl;
          sabKey.value = data.sabKey;
          sabEnabled.checked = data.sabEnabled;

          if (hasUnsavedBackendChanges('qbit')) {
            if (qbitEnabled.checked) {
              sendRuntimeBackendHealth('qbit', {
                successful: false,
                errorText: 'UNSAVED CHANGES',
                sticky: true,
              });
            } else {
              sendRuntimeBackendHealth('qbit', { clear: true });
            }
          }

          if (hasUnsavedBackendChanges('sab')) {
            if (sabEnabled.checked) {
              sendRuntimeBackendHealth('sab', {
                successful: false,
                errorText: 'UNSAVED CHANGES',
                sticky: true,
              });
            } else {
              sendRuntimeBackendHealth('sab', { clear: true });
            }
          }

          syncCardPresentation();
          hydrateAboutView();
          renderLogs(localObj.logs || []);
          initializeDashboardPanels();
          refreshMainView();

          const startView = views[localObj.activeView] ? localObj.activeView : 'main';
          switchView(startView, { persist: false });
          requestBackendBadgeRefresh();
          appContainer.classList.add('ready');
        },
      );
    },
  );

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      const nextBackendSyncState = {};
      ['qbitUrl', 'qbitUser', 'qbitPass', 'qbitEnabled', 'sabUrl', 'sabKey', 'sabEnabled'].forEach(
        (key) => {
          if (!changes[key]) return;
          nextBackendSyncState[key] = changes[key].newValue;
        },
      );
      if (Object.keys(nextBackendSyncState).length) {
        syncPersistedBackendConfig(nextBackendSyncState);
      }
    }

    if (namespace === 'sync' && changes.themeMode) {
      themeMode = normalizeThemeMode(changes.themeMode.newValue);
      settingThemeMode.value = themeMode;
      applyResolvedTheme();
    }

    if (namespace === 'sync' && changes.notificationsEnabled) {
      notificationsEnabled = Boolean(changes.notificationsEnabled.newValue);
      settingNotifications.checked = notificationsEnabled;
    }

    if (namespace === 'sync' && changes.pageToastsEnabled) {
      pageToastsEnabled = Boolean(changes.pageToastsEnabled.newValue);
      settingPageToasts.checked = pageToastsEnabled;
    }

    if (namespace === 'sync' && changes.confirmDangerActions) {
      confirmDangerActions = changes.confirmDangerActions.newValue !== false;
      settingConfirmActions.checked = confirmDangerActions;
    }

    if (namespace === 'local' && changes.backendBadgeState) {
      applyNavBadgeState(changes.backendBadgeState.newValue);
    }

    if (namespace === 'local' && changes.logs) {
      renderLogs(changes.logs.newValue);
    }
  });

  function switchView(target, { persist = true } = {}) {
    const nextView = views[target] ? target : 'main';

    Object.values(views).forEach((el) => el.classList.remove('active'));
    views[nextView].classList.add('active');

    Object.entries(navButtons).forEach(([viewName, button]) => {
      button.classList.toggle('active', viewName === nextView);
    });
    aboutNavButton.classList.toggle('active', nextView === 'about');

    if (panelTitle) panelTitle.textContent = panelMeta[nextView].title;
    document.title =
      nextView === 'logs'
        ? 'warp Activity Logs'
        : nextView === 'settings'
          ? 'warp Settings'
          : nextView === 'about'
            ? 'About warp'
            : 'warp Console';

    if (persist) chrome.storage.local.set({ activeView: nextView });

    syncCardPresentation();
    refreshMainView();
    startPolling();
  }

  function formatUpdatedLabel(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Local working copy';

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed);
  }

  function hydrateAboutView() {
    aboutName.textContent = manifest.name || 'warp';
    aboutVersion.textContent = manifest.version || '--';
    aboutUpdated.textContent = formatUpdatedLabel(document.lastModified);
    aboutAuthor.textContent = ABOUT_AUTHOR;

    if (ABOUT_GITHUB_URL) {
      aboutGithub.href = ABOUT_GITHUB_URL;
      aboutGithub.hidden = false;
      aboutGithubFallback.hidden = true;
    } else {
      aboutGithub.hidden = true;
      aboutGithubFallback.hidden = false;
      aboutGithubFallback.textContent = 'Not linked yet';
    }
  }

  function getClientLabel(client) {
    return client === 'qbit' ? 'qBittorrent' : 'SABnzbd';
  }

  function getClientCard(client) {
    return client === 'qbit' ? qbitCard : sabCard;
  }

  function getClientEditor(client) {
    return client === 'qbit' ? qbitEditor : sabEditor;
  }

  function getClientEditButton(client) {
    return client === 'qbit' ? editQbitBtn : editSabBtn;
  }

  function getClientUrlValue(client) {
    return client === 'qbit' ? qbitUrl.value.trim() : sabUrl.value.trim();
  }

  function getClientTestValues(client) {
    if (client === 'qbit') {
      return {
        url: qbitUrl.value.trim(),
        param1: qbitUser.value.trim(),
        param2: qbitPass.value,
      };
    }

    return {
      url: sabUrl.value.trim(),
      param1: sabKey.value.trim(),
      param2: '',
    };
  }

  function normalizeDisplayUrl(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
    return `http://${trimmed.replace(/\/+$/, '')}`;
  }

  function getBackendTestSignature(client, values = getClientTestValues(client)) {
    return JSON.stringify({
      url: normalizeDisplayUrl(values.url),
      param1: values.param1 || '',
      param2: values.param2 || '',
    });
  }

  function getCurrentVerification(client) {
    const signature = getBackendTestSignature(client);
    const verification = backendVerification[client];

    if (verification.signature !== signature) {
      return {
        signature,
        status: 'untested',
        errorText: '',
      };
    }

    return {
      signature,
      status: verification.status,
      errorText: verification.errorText,
    };
  }

  function setBackendVerification(
    client,
    status,
    { signature = getBackendTestSignature(client), errorText = '' } = {},
  ) {
    backendVerification[client].signature = signature;
    backendVerification[client].status = status;
    backendVerification[client].errorText = errorText;
  }

  function resetBackendVerification(client) {
    backendVerification[client].signature = null;
    backendVerification[client].status = 'untested';
    backendVerification[client].errorText = '';
  }

  function finalizeManualTest(client, requestId, result) {
    if (manualTests[client].requestId !== requestId) return;

    const resolve = manualTests[client].resolve;
    manualTests[client].requestId = null;
    manualTests[client].promise = null;
    manualTests[client].resolve = null;

    requestBackendBadgeRefresh();
    if (resolve) resolve(result);
  }

  function setBackendHealthState(client, status, { errorText = '' } = {}) {
    backendHealth[client].status = status;
    backendHealth[client].errorText = errorText;
    backendHealth[client].hasSucceeded = status === 'online';
    backendHealth[client].consecutiveFailures =
      status === 'online' ? 0 : status === 'error' || status === 'warning' ? 2 : 0;
  }

  function isBackendEnabled(client) {
    return client === 'qbit' ? qbitEnabled.checked : sabEnabled.checked;
  }

  function isBackendConfigured(client) {
    return Boolean(normalizeDisplayUrl(getClientUrlValue(client)));
  }

  function isBackendCollapsed(client) {
    return !isBackendEnabled(client);
  }

  function getBackendStatusDescriptor(client) {
    if (isBackendCollapsed(client)) {
      return { status: 'disabled', errorText: '' };
    }

    const verification = getCurrentVerification(client);
    if (verification.status === 'failure' && verification.errorText) {
      const failureState = classifyFailureState(verification.errorText);
      return {
        status: failureState === 'idle' ? 'warning' : failureState,
        errorText: verification.errorText,
      };
    }

    if (hasUnsavedBackendChanges(client)) {
      return {
        status: 'warning',
        errorText: 'UNSAVED CHANGES',
      };
    }

    const { status, errorText } = backendHealth[client];

    return { status, errorText };
  }

  function applyBackendStatusDescriptor(client, descriptor) {
    const { status, errorText } = descriptor;
    statusRenderKeys[client] = `${status}|${errorText}`;

    if (status === 'disabled') {
      updateStatus(client, 'disabled');
      if (client === 'qbit') setQbitPanelEmpty();
      else setSabPanelEmpty();
      return;
    }

    if (status === 'online') {
      updateStatus(client, 'online');
      applyDashboardConnectionState(client, 'connected');
      return;
    }

    if (status === 'error' || status === 'warning') {
      updateStatus(client, status, errorText);
      applyDashboardConnectionState(client, status === 'error' ? 'error' : 'warning');
      return;
    }

    if (status === 'checking') {
      updateStatus(client, 'checking', errorText);
      applyDashboardConnectionState(client, 'connecting');
      return;
    }

    updateStatus(client, 'idle');
    if (client === 'qbit') setQbitPanelEmpty();
    else setSabPanelEmpty();
  }

  function renderBackendStatus(client, { immediate = false } = {}) {
    const descriptor = getBackendStatusDescriptor(client);
    const renderKey = `${descriptor.status}|${descriptor.errorText}`;

    if (statusRenderTimers[client]) {
      clearTimeout(statusRenderTimers[client]);
      statusRenderTimers[client] = null;
    }

    if (statusRenderKeys[client] === renderKey) return;

    const shouldDelay =
      !immediate &&
      (descriptor.status === 'idle' ||
        descriptor.status === 'disabled' ||
        descriptor.status === 'warning' ||
        descriptor.status === 'error');

    if (!shouldDelay) {
      applyBackendStatusDescriptor(client, descriptor);
      return;
    }

    statusRenderTimers[client] = window.setTimeout(() => {
      statusRenderTimers[client] = null;
      applyBackendStatusDescriptor(client, descriptor);
    }, STATUS_SETTLE_DELAY_MS);
  }

  function getEditButtonIcon(state) {
    if (state === 'close') {
      return '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"></path></svg>';
  }

  function renderEditButtons() {
    ['qbit', 'sab'].forEach((client) => {
      const button = getClientEditButton(client);
      const icon = button.querySelector('.backend-edit-btn-icon');
      const isEditing = editorState[client];
      const variant = isEditing ? 'close' : 'edit';
      const label = isEditing
        ? `Collapse ${getClientLabel(client)} editor`
        : `Expand ${getClientLabel(client)} editor`;

      button.dataset.variant = variant;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      icon.innerHTML = getEditButtonIcon(variant);
    });
  }

  function syncDashboardOrder() {
    ['qbit', 'sab']
      .filter((client) => !isBackendCollapsed(client))
      .forEach((client) => dashboardStack.appendChild(getClientCard(client)));

    ['qbit', 'sab']
      .filter((client) => isBackendCollapsed(client))
      .forEach((client) => dashboardStack.appendChild(getClientCard(client)));
  }

  function syncCollapsedCards() {
    ['qbit', 'sab'].forEach((client) => {
      const card = getClientCard(client);
      const collapsed = isBackendCollapsed(client);
      card.classList.toggle('is-collapsed', collapsed);
      if (collapsed) editorState[client] = false;
    });
  }

  function renderDashboardEndpoint(client, endpointEl) {
    const normalized = normalizeDisplayUrl(getClientUrlValue(client));
    const endpointWrap = endpointEl.parentElement;
    if (!normalized) {
      endpointEl.textContent = '';
      endpointWrap.hidden = true;
      return;
    }

    endpointEl.textContent = normalized;
    endpointWrap.hidden = false;
  }

  function renderDashboardEndpoints() {
    renderDashboardEndpoint('qbit', qbitEndpointUrl);
    renderDashboardEndpoint('sab', sabEndpointUrl);
  }

  function toggleCardState() {
    qbitCard.classList.toggle('is-disabled', isBackendCollapsed('qbit'));
    sabCard.classList.toggle('is-disabled', isBackendCollapsed('sab'));
  }

  function syncEditorState() {
    ['qbit', 'sab'].forEach((client) => {
      const card = getClientCard(client);
      const editor = getClientEditor(client);
      const isEditing = editorState[client] && !isBackendCollapsed(client);
      card.classList.toggle('is-editing', isEditing);
      editor.setAttribute('aria-hidden', String(!isEditing));
    });
  }

  function syncCardPresentation() {
    syncBackendToggleAffordances();
    toggleCardState();
    renderDashboardEndpoints();
    syncCollapsedCards();
    syncDashboardOrder();
    syncEditorState();
    renderEditButtons();
  }

  function toggleEditor(client, forceState = !editorState[client]) {
    editorState.qbit = false;
    editorState.sab = false;
    editorState[client] = forceState;
    syncCardPresentation();

    if (forceState) {
      const input = client === 'qbit' ? qbitUrl : sabUrl;
      window.setTimeout(() => input.focus(), 0);
    }
  }

  function handleEditorToggle(client) {
    const previouslyOpen = editorState.qbit ? 'qbit' : editorState.sab ? 'sab' : null;
    const nextState = !editorState[client];
    toggleEditor(client, nextState);

    if (!nextState || (previouslyOpen && previouslyOpen !== client)) {
      triggerImmediateStatusRefresh();
    }
  }

  function preserveActiveInput(work) {
    const active = document.activeElement;
    const canRestore =
      active &&
      typeof active.focus === 'function' &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    const selectionStart =
      canRestore && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const selectionEnd =
      canRestore && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

    work();

    if (!canRestore || !document.contains(active)) return;
    active.focus({ preventScroll: true });
    if (
      selectionStart !== null &&
      selectionEnd !== null &&
      typeof active.setSelectionRange === 'function'
    ) {
      active.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  function saveDraft() {
    preserveActiveInput(() => {
      syncCardPresentation();
      if (!isManualTestActive('qbit')) renderBackendStatus('qbit', { immediate: true });
      if (!isManualTestActive('sab')) renderBackendStatus('sab', { immediate: true });
    });
    chrome.storage.local.set({
      draft: {
        qbitUrl: qbitUrl.value,
        qbitUser: qbitUser.value,
        qbitPass: qbitPass.value,
        qbitEnabled: qbitEnabled.checked,
        sabUrl: sabUrl.value,
        sabKey: sabKey.value,
        sabEnabled: sabEnabled.checked,
      },
    });
  }

  function startPolling() {
    if (pollingInterval) return;
    pollLiveStats();
    pollingInterval = setInterval(pollLiveStats, 1000);
  }

  function classifyFailureState(errorText = '') {
    const normalized = (errorText || '').toUpperCase();
    if (!normalized || normalized === 'DISABLED') return 'idle';
    if (
      normalized.includes('AUTH') ||
      normalized.includes('BAD CREDENTIALS') ||
      normalized.includes('INVALID API KEY') ||
      normalized.includes('API KEY VALIDATION IS NOT ENFORCED') ||
      normalized.includes('NO QUEUE DATA') ||
      normalized.includes('INVALID ENDPOINT') ||
      normalized.includes('UNEXPECTED SAB RESPONSE') ||
      normalized.includes('HTTP 401') ||
      normalized.includes('HTTP 403') ||
      normalized.includes('HTTP 404')
    ) {
      return 'error';
    }
    if (
      normalized.includes('NO URL PROVIDED') ||
      normalized.includes('NO RESPONSE') ||
      normalized.includes('CANCELED') ||
      normalized.includes('ENDPOINT UNREACHABLE') ||
      normalized.includes('TIMEOUT') ||
      normalized.includes('FAILED TO FETCH') ||
      normalized.includes('NETWORKERROR') ||
      normalized.includes('CONNECTION REFUSED') ||
      normalized.includes('HTTP 502') ||
      normalized.includes('HTTP 503') ||
      normalized.includes('HTTP 504')
    ) {
      return 'warning';
    }
    return 'warning';
  }

  function pollLiveStats() {
    if (pollInFlight) return;
    pollInFlight = true;

    chrome.storage.sync.get(['qbitEnabled', 'sabEnabled'], (syncObj) => {
      let pending = 0;
      const completePoll = () => {
        pending -= 1;
        if (pending <= 0) pollInFlight = false;
      };

      if (syncObj.qbitEnabled && !hasUnsavedBackendChanges('qbit')) {
        pending += 1;
        chrome.runtime.sendMessage({ action: 'fetch_stats_qbit' }, (res) => {
          const shouldSuppress = isManualTestActive('qbit');
          const staleResult =
            hasUnsavedBackendChanges('qbit') || getCurrentVerification('qbit').status === 'failure';
          if (shouldSuppress || staleResult) {
            completePoll();
            return;
          }
          if (!chrome.runtime.lastError && res && res.success) {
            setBackendHealthState('qbit', 'online');
            syncBadgeFromBackendStatus('qbit', 'online');
            playVerdictAnimation('qbit', true);
            renderBackendStatus('qbit');
          } else {
            const errorText =
              chrome.runtime.lastError?.message || (res ? res.error : 'NO RESPONSE');
            const failureState = classifyFailureState(errorText);
            setBackendHealthState('qbit', failureState, { errorText });
            syncBadgeFromBackendStatus('qbit', failureState, errorText);
            if (failureState === 'error') playVerdictAnimation('qbit', false);
            renderBackendStatus('qbit');
          }
          completePoll();
        });
      } else {
        if (syncObj.qbitEnabled && hasUnsavedBackendChanges('qbit')) {
          setBackendHealthState('qbit', 'warning', { errorText: 'UNSAVED CHANGES' });
          syncBadgeFromBackendStatus('qbit', 'warning', 'UNSAVED CHANGES');
        } else {
          setBackendHealthState('qbit', 'disabled');
          syncBadgeFromBackendStatus('qbit', 'disabled');
        }
        if (!isManualTestActive('qbit')) {
          renderBackendStatus('qbit');
        }
      }

      if (syncObj.sabEnabled && !hasUnsavedBackendChanges('sab')) {
        pending += 1;
        chrome.runtime.sendMessage({ action: 'fetch_stats_sab' }, (res) => {
          const shouldSuppress = isManualTestActive('sab');
          const staleResult =
            hasUnsavedBackendChanges('sab') || getCurrentVerification('sab').status === 'failure';
          if (shouldSuppress || staleResult) {
            completePoll();
            return;
          }
          if (!chrome.runtime.lastError && res && res.success) {
            setBackendHealthState('sab', 'online');
            syncBadgeFromBackendStatus('sab', 'online');
            playVerdictAnimation('sab', true);
            renderBackendStatus('sab');
          } else {
            const errorText =
              chrome.runtime.lastError?.message || (res ? res.error : 'NO RESPONSE');
            const failureState = classifyFailureState(errorText);
            setBackendHealthState('sab', failureState, { errorText });
            syncBadgeFromBackendStatus('sab', failureState, errorText);
            if (failureState === 'error') playVerdictAnimation('sab', false);
            renderBackendStatus('sab');
          }
          completePoll();
        });
      } else {
        if (syncObj.sabEnabled && hasUnsavedBackendChanges('sab')) {
          setBackendHealthState('sab', 'warning', { errorText: 'UNSAVED CHANGES' });
          syncBadgeFromBackendStatus('sab', 'warning', 'UNSAVED CHANGES');
        } else {
          setBackendHealthState('sab', 'disabled');
          syncBadgeFromBackendStatus('sab', 'disabled');
        }
        if (!isManualTestActive('sab')) {
          renderBackendStatus('sab');
        }
      }

      if (!pending) pollInFlight = false;
    });
  }

  function refreshMainView() {
    chrome.storage.sync.get(['qbitEnabled', 'sabEnabled'], (syncObj) => {
      if (syncObj.qbitEnabled) {
        if (!isManualTestActive('qbit')) {
          renderBackendStatus('qbit');
        }
      } else {
        setBackendHealthState('qbit', 'disabled');
        if (!isManualTestActive('qbit')) {
          renderBackendStatus('qbit');
        }
      }

      if (syncObj.sabEnabled) {
        if (!isManualTestActive('sab')) {
          renderBackendStatus('sab');
        }
      } else {
        setBackendHealthState('sab', 'disabled');
        if (!isManualTestActive('sab')) {
          renderBackendStatus('sab');
        }
      }

      syncCardPresentation();
    });
  }

  function triggerImmediateStatusRefresh() {
    syncCardPresentation();
    refreshMainView();
    pollLiveStats();
  }

  function setTestButtonState(button, label, { disabled = false, state = 'idle' } = {}) {
    button.textContent = label;
    button.disabled = disabled;
    button.dataset.state = state;
  }

  function resetTestButtonState(button, delay = 1400) {
    window.setTimeout(() => {
      setTestButtonState(button, testButtonDefaults.get(button) || 'TEST', { state: 'idle' });
    }, delay);
  }

  function setSaveButtonState(button, label, { disabled = false, state = 'idle' } = {}) {
    button.textContent = label;
    button.disabled = disabled;
    button.dataset.state = state;
  }

  function resetSaveButtonState(button, delay = 1200) {
    window.setTimeout(() => {
      setSaveButtonState(button, saveButtonDefaults.get(button) || 'SAVE', { state: 'idle' });
    }, delay);
  }

  function persistBackendConfig(client, callback = () => {}) {
    const syncPayload =
      client === 'qbit'
        ? {
            qbitUrl: qbitUrl.value.trim(),
            qbitUser: qbitUser.value.trim(),
            qbitPass: qbitPass.value,
            qbitEnabled: qbitEnabled.checked,
          }
        : {
            sabUrl: sabUrl.value.trim(),
            sabKey: sabKey.value.trim(),
            sabEnabled: sabEnabled.checked,
          };

    chrome.storage.sync.set(syncPayload, () => {
      syncPersistedBackendConfig(syncPayload);
      chrome.storage.local.get('draft', (draftObj) => {
        const currentDraft = draftObj.draft || {};
        chrome.storage.local.set({ draft: { ...currentDraft, ...syncPayload } }, callback);
      });
    });
  }

  function completeBackendSave(client, button) {
    setSaveButtonState(button, 'SAVING...', { disabled: true, state: 'checking' });

    persistBackendConfig(client, () => {
      sendRuntimeBackendHealth(client, { clear: true });
      requestBackendBadgeRefresh();
      editorState[client] = false;
      syncCardPresentation();
      triggerImmediateStatusRefresh();
      setSaveButtonState(button, 'SAVED ✓', { disabled: true, state: 'success' });
      resetSaveButtonState(button);
    });
  }

  function blockSave(button, label, { state = 'error', delay = 1400 } = {}) {
    setSaveButtonState(button, label, { disabled: true, state });
    resetSaveButtonState(button, delay);
  }

  async function saveBackend(client) {
    const button = client === 'qbit' ? saveQbitBtn : saveSabBtn;

    if (!isBackendEnabled(client)) {
      completeBackendSave(client, button);
      return;
    }

    if (isManualTestActive(client) && manualTests[client].promise) {
      setSaveButtonState(button, 'TESTING...', { disabled: true, state: 'checking' });
      const result = await manualTests[client].promise;
      if (!result?.success) {
        blockSave(button, result?.canceled ? 'CANCELED' : 'TEST FAILED', {
          state: result?.canceled ? 'idle' : 'error',
          delay: result?.canceled ? 900 : 1400,
        });
        return;
      }
    }

    let verification = getCurrentVerification(client);

    if (verification.status === 'untested') {
      const testValues = getClientTestValues(client);
      setSaveButtonState(button, 'TESTING...', { disabled: true, state: 'checking' });
      const result = await performTest(
        client,
        testValues.url,
        testValues.param1,
        testValues.param2,
      );

      if (!result?.success) {
        blockSave(button, result?.canceled ? 'CANCELED' : 'TEST FAILED', {
          state: result?.canceled ? 'idle' : 'error',
          delay: result?.canceled ? 900 : 1400,
        });
        return;
      }

      verification = getCurrentVerification(client);
    }

    if (verification.status !== 'success') {
      if (verification.errorText) {
        updateStatus(client, classifyFailureState(verification.errorText), verification.errorText);
      }
      blockSave(button, 'TEST FAILED');
      return;
    }

    completeBackendSave(client, button);
  }

  function playVerdictAnimation(client, success) {
    void client;
    void success;
  }

  function openConfirmDialog({
    title,
    message,
    acceptLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger',
  }) {
    if (confirmResolver) {
      confirmResolver(false);
      confirmResolver = null;
    }

    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmAcceptBtn.textContent = acceptLabel;
    confirmCancelBtn.textContent = cancelLabel;
    confirmAcceptBtn.dataset.tone = tone;
    confirmOverlay.hidden = false;

    return new Promise((resolve) => {
      confirmResolver = resolve;
      window.setTimeout(() => confirmAcceptBtn.focus(), 0);
    });
  }

  function resolveConfirmDialog(result) {
    if (!confirmResolver) return;
    const resolver = confirmResolver;
    confirmResolver = null;
    confirmOverlay.hidden = true;
    confirmAcceptBtn.dataset.tone = '';
    resolver(result);
  }

  function updateStatus(client, status, errorText = '') {
    const group = client === 'qbit' ? qbitUrlGroup : sabUrlGroup;
    const msg =
      client === 'qbit' ? qbitErrorMsg.querySelector('span') : sabErrorMsg.querySelector('span');
    group.classList.remove('has-error', 'has-warning');

    if (status === 'error') {
      group.classList.add('has-error');
      msg.textContent = errorText.toUpperCase();
    } else if ((status === 'warning' || status === 'checking') && errorText) {
      group.classList.add('has-warning');
      msg.textContent = errorText.toUpperCase();
    } else {
      msg.textContent = '';
    }
  }

  function performTest(client, url, param1, param2) {
    if (manualTests[client].promise) return manualTests[client].promise;

    const configButton = client === 'qbit' ? testQbitBtn : testSabBtn;
    const requestId = `${client}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signature = getBackendTestSignature(client, { url, param1, param2 });

    if (!url) {
      setBackendHealthState(client, 'warning', { errorText: 'NO URL PROVIDED' });
      setBackendVerification(client, 'failure', { signature, errorText: 'NO URL PROVIDED' });
      updateStatus(client, 'warning', 'NO URL PROVIDED');
      reflectConnectivityCheck(client, false, 'NO URL PROVIDED');
      playVerdictAnimation(client, false);
      setTestButtonState(configButton, 'FAILED', { disabled: true, state: 'error' });
      resetTestButtonState(configButton);
      applyDashboardConnectionState(client, 'warning', 'Needs Setup');
      return Promise.resolve({ success: false, errorText: 'NO URL PROVIDED' });
    }

    manualTests[client].requestId = requestId;
    setTestButtonState(configButton, 'CANCEL', { disabled: false, state: 'checking' });
    updateStatus(client, 'checking');
    applyDashboardConnectionState(client, 'connecting');

    manualTests[client].promise = new Promise((resolve) => {
      manualTests[client].resolve = resolve;

      chrome.runtime.sendMessage(
        {
          action: `test_${client}_direct`,
          payload: { url, param1, param2, requestId },
        },
        (response) => {
          const stillActive = manualTests[client].requestId === requestId;
          if (!stillActive) return;

          if (chrome.runtime.lastError) {
            const errorText = chrome.runtime.lastError.message || 'EXTENSION ERROR';
            setBackendVerification(client, 'failure', { signature, errorText });
            updateStatus(client, classifyFailureState(errorText), errorText);
            reflectConnectivityCheck(client, false, errorText);
            playVerdictAnimation(client, false);
            setTestButtonState(configButton, 'FAILED', { disabled: true, state: 'error' });
            resetTestButtonState(configButton);
            finalizeManualTest(client, requestId, { success: false, errorText });
            return;
          }

          if (response?.canceled) {
            setTestButtonState(configButton, testButtonDefaults.get(configButton) || 'TEST', {
              state: 'idle',
            });
            renderBackendStatus(client);
            finalizeManualTest(client, requestId, {
              success: false,
              canceled: true,
              errorText: 'CANCELED',
            });
            return;
          }

          if (response && response.success) {
            setBackendVerification(client, 'success', { signature });
            updateStatus(client, 'online');
            reflectConnectivityCheck(client, true);
            playVerdictAnimation(client, true);
            setTestButtonState(configButton, 'VERIFIED ✓', { disabled: true, state: 'success' });
            resetTestButtonState(configButton);
            finalizeManualTest(client, requestId, { success: true });
            return;
          }

          const errorText = response ? response.error : 'NO RESPONSE';
          setBackendVerification(client, 'failure', { signature, errorText });
          updateStatus(client, classifyFailureState(errorText), errorText);
          reflectConnectivityCheck(client, false, errorText);
          playVerdictAnimation(client, false);
          setTestButtonState(configButton, 'FAILED', { disabled: true, state: 'error' });
          resetTestButtonState(configButton);
          finalizeManualTest(client, requestId, { success: false, errorText });
        },
      );
    });

    return manualTests[client].promise;
  }

  function initializeDashboardPanels() {
    syncCardPresentation();
    setQbitPanelEmpty();
    setSabPanelEmpty();
  }

  function getEmptyStateLabel(client) {
    if (!isBackendConfigured(client)) return 'No backend configured';
    const enabled = client === 'qbit' ? qbitEnabled.checked : sabEnabled.checked;
    if (!enabled) return 'Disabled';
    return 'Not Connected';
  }

  function setQbitPanelEmpty() {
    applyDashboardConnectionState('qbit', 'warning', getEmptyStateLabel('qbit'));
  }

  function setSabPanelEmpty() {
    applyDashboardConnectionState('sab', 'warning', getEmptyStateLabel('sab'));
  }

  function isManualTestActive(client) {
    return Boolean(manualTests[client]?.requestId);
  }

  function cancelManualTest(client) {
    const requestId = manualTests[client]?.requestId;
    if (!requestId) return;
    chrome.runtime.sendMessage({ action: 'cancel_direct_test', payload: { requestId } });
    setTestButtonState(
      client === 'qbit' ? testQbitBtn : testSabBtn,
      testButtonDefaults.get(client === 'qbit' ? testQbitBtn : testSabBtn) || 'TEST',
      {
        state: 'idle',
      },
    );
    renderBackendStatus(client);
    finalizeManualTest(client, requestId, {
      success: false,
      canceled: true,
      errorText: 'CANCELED',
    });
  }

  function applyDashboardConnectionState(client, state, labelOverride = '') {
    const statusEl = client === 'qbit' ? qbitDashboardStatus : sabDashboardStatus;
    const labelEl = client === 'qbit' ? qbitStatusLabel : sabStatusLabel;

    statusEl.dataset.state = state;
    if (labelOverride) {
      labelEl.textContent = labelOverride;
      return;
    }
    if (state === 'connected') {
      labelEl.textContent = 'Connected';
      return;
    }
    if (state === 'connecting') {
      labelEl.textContent = 'Connecting...';
      return;
    }
    if (state === 'error') {
      labelEl.textContent = 'Error';
      return;
    }
    labelEl.textContent = 'Connectivity Issue';
  }

  function reflectConnectivityCheck(client, success, errorText = '') {
    const failureState = classifyFailureState(errorText);
    const dashboardState = failureState === 'error' ? 'error' : 'warning';

    if (success) {
      sendRuntimeBackendHealth(client, { successful: true });
    } else {
      const normalizedError = String(errorText || '').toUpperCase();
      if (normalizedError !== 'CANCELED') {
        sendRuntimeBackendHealth(client, {
          successful: false,
          errorText: errorText || 'NO RESPONSE',
          sticky: hasUnsavedBackendChanges(client),
        });
      }
    }
    requestBackendBadgeRefresh();

    setBackendHealthState(client, success ? 'online' : failureState, { errorText });
    applyDashboardConnectionState(client, success ? 'connected' : dashboardState);
    if (!success && errorText) updateStatus(client, failureState, errorText);
  }

  function renderLogs(logs) {
    renderedLogs = (logs || [])
      .slice()
      .reverse()
      .map((log, index) => ({
        ...log,
        logKey: `${log.timestamp}-${index}`,
      }));
    activityLogInteractive.innerHTML = '';
    if (!renderedLogs.length) {
      activityLogInteractive.innerHTML =
        '<li class="log-placeholder">NO ACTIVITY RECORDED YET.</li>';
      selectedLogKey = null;
      return;
    }

    renderedLogs.forEach((log) => {
      const li = document.createElement('li');
      li.className = normalizeLogStatus(log.status);

      const timeStr = new Date(log.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const fullTime = new Date(log.timestamp).toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const statusLabel = getStatusLabel(log.status);
      const detailText = log.details || 'No detailed trace generated.';
      const expanded = selectedLogKey === log.logKey;

      li.innerHTML = `
        <span class="log-time">${timeStr}</span>
        <span class="log-status-text">${statusLabel}</span>
        <div class="log-entry-body">
          <p class="log-entry-message" title="${escapeHtml(log.message)}">${escapeHtml(log.message)}</p>
        </div>
        <button class="log-open-btn" type="button" aria-label="Toggle log details">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
        </button>
        <div class="log-row-details" ${expanded ? '' : 'hidden'}>
          <p class="log-row-detail-message">${escapeHtml(log.message)}</p>
          <pre class="log-row-detail-trace">[${escapeHtml(fullTime)}]\n\n${escapeHtml(detailText)}</pre>
        </div>
      `;

      if (expanded) li.classList.add('expanded');

      const detailEl = li.querySelector('.log-row-details');
      const toggle = () => openLogDetail(log, li, detailEl);
      li.querySelector('.log-open-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        toggle();
      });
      li.addEventListener('click', toggle);
      activityLogInteractive.appendChild(li);
    });

    if (selectedLogKey && !renderedLogs.some((log) => log.logKey === selectedLogKey)) {
      selectedLogKey = null;
    }
  }

  function escapeHtml(unsafe) {
    return (unsafe || '')
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeLogStatus(status) {
    if (status === 'success' || status === 'error' || status === 'info' || status === 'debug') {
      return status;
    }
    return 'info';
  }

  function getStatusLabel(status) {
    if (status === 'success') return 'SUCCESS';
    if (status === 'error') return 'FAIL';
    if (status === 'debug') return 'DEBUG';
    return 'INFO';
  }

  function showLogsList({ restoreScroll = true } = {}) {
    logsListScreen.classList.add('active');
    logsDetailScreen.classList.remove('active');
    if (restoreScroll) logsListContent.scrollTop = logsListScrollTop;
  }

  function openLogDetail(log, rowEl, detailsEl) {
    const expanding = selectedLogKey !== log.logKey;

    activityLogInteractive.querySelectorAll('li.expanded').forEach((entry) => {
      entry.classList.remove('expanded');
      const details = entry.querySelector('.log-row-details');
      if (details) details.hidden = true;
    });

    if (!expanding) {
      selectedLogKey = null;
      return;
    }

    selectedLogKey = log.logKey;
    rowEl.classList.add('expanded');
    detailsEl.hidden = false;
    populateLogDetail(log);
  }

  function populateLogDetail(log) {
    const normalizedStatus = normalizeLogStatus(log.status);
    const detailText = log.details || 'No detailed trace generated.';
    const fullTime = new Date(log.timestamp).toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    logDetailStatus.textContent = getStatusLabel(log.status);
    logDetailStatus.className = `log-status-pill ${normalizedStatus}`;
    logDetailTime.textContent = fullTime;
    logDetailMessage.textContent = log.message || 'No message recorded.';
    logDetailTrace.textContent = detailText;
  }
});
