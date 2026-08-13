import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));

test('package.json and manifest.json stay on the same version', () => {
  assert.equal(packageJson.version, manifest.version);
});

test('manifest references files that exist in the extension bundle', () => {
  const manifestFiles = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((contentScript) => contentScript.js || []),
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);

  for (const relativePath of manifestFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    assert.ok(fs.existsSync(absolutePath), `Missing manifest asset: ${relativePath}`);
  }
});

test('extension pages preserve explicitly configured HTTP backend URLs', () => {
  const extensionPagePolicy = manifest.content_security_policy?.extension_pages || '';

  assert.ok(extensionPagePolicy.includes("script-src 'self'"));
  assert.ok(extensionPagePolicy.includes("object-src 'self'"));
  assert.equal(extensionPagePolicy.includes('upgrade-insecure-requests'), false);
});

test('extension scripts are valid JavaScript', () => {
  for (const relativePath of ['src/background.js', 'src/content.js', 'src/popup/popup.js']) {
    const fileContents = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(fileContents, { filename: relativePath });
    });
  }
});

function cloneDefaults(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadContentScript() {
  const sentMessages = [];
  let clickListener = null;

  const context = vm.createContext({
    chrome: {
      runtime: {
        id: 'warp-test',
        lastError: null,
        getURL: (resource) => resource,
        sendMessage: (message, callback) => {
          sentMessages.push(message);
          callback?.({ handled: true });
        },
        onMessage: {
          addListener: () => {},
        },
      },
    },
    console,
    clearTimeout,
    document: {
      addEventListener: (eventName, listener) => {
        if (eventName === 'click') clickListener = listener;
      },
      getElementById: () => null,
      createElement: () => ({
        style: {},
        dataset: {},
        setAttribute: () => {},
        querySelector: () => ({ style: {} }),
        remove: () => {},
      }),
      body: {
        appendChild: () => {},
      },
    },
    setTimeout: () => 0,
    URL,
    window: {
      location: {
        href: 'https://indexer.example/search',
      },
    },
  });

  const source = fs.readFileSync(path.join(repoRoot, 'src/content.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'src/content.js' });

  return { clickListener, sentMessages };
}

function loadBackgroundScript(configOverrides = {}) {
  const fetchCalls = [];
  const canceledDownloads = [];
  const downloadItems = new Map();
  const dnrSessionRuleUpdates = [];
  const notificationCreates = [];
  const tabMessages = [];
  let onMessageListener = null;
  let onCreatedListener = null;
  let onChangedListener = null;
  const cookieItems = configOverrides.__cookieItems || [];
  const fetchImpl = configOverrides.__fetch;

  const config = {
    qbitUrl: '',
    qbitUser: '',
    qbitPass: '',
    qbitEnabled: false,
    sabUrl: 'http://sab.local',
    sabKey: 'sab-key',
    sabEnabled: true,
    ...configOverrides,
  };

  const context = vm.createContext({
    AbortController,
    Blob,
    FormData,
    Response,
    URL,
    URLSearchParams,
    chrome: {
      action: {
        setBadgeBackgroundColor: () => {},
        setBadgeText: () => {},
      },
      alarms: {
        clear: () => {},
        create: () => {},
        onAlarm: {
          addListener: () => {},
        },
      },
      cookies: {
        getAll: (_details, callback) => callback(cloneDefaults(cookieItems)),
      },
      declarativeNetRequest: {
        updateSessionRules: async (rules) => {
          dnrSessionRuleUpdates.push(cloneDefaults(rules));
        },
      },
      downloads: {
        cancel: (downloadId, callback) => {
          canceledDownloads.push(downloadId);
          callback?.();
        },
        erase: (_query, callback) => callback?.([]),
        search: (query, callback) => {
          callback(query?.id !== undefined ? [downloadItems.get(query.id)].filter(Boolean) : []);
        },
        onChanged: {
          addListener: (listener) => {
            onChangedListener = listener;
          },
        },
        onCreated: {
          addListener: (listener) => {
            onCreatedListener = listener;
          },
        },
      },
      notifications: {
        create: (...args) => {
          notificationCreates.push(args);
        },
      },
      runtime: {
        getURL: (resource) => resource,
        lastError: null,
        onInstalled: {
          addListener: () => {},
        },
        onMessage: {
          addListener: (listener) => {
            onMessageListener = listener;
          },
        },
        onStartup: {
          addListener: () => {},
        },
      },
      storage: {
        local: {
          get: (defaults, callback) => callback(cloneDefaults(defaults)),
          set: (_items, callback) => callback?.(),
        },
        onChanged: {
          addListener: () => {},
        },
        sync: {
          get: (keys, callback) => {
            if (Array.isArray(keys)) {
              callback(Object.fromEntries(keys.map((key) => [key, config[key]])));
              return;
            }

            const defaults = cloneDefaults(keys);
            const merged = { ...defaults };
            Object.keys(defaults).forEach((key) => {
              if (Object.prototype.hasOwnProperty.call(config, key)) {
                merged[key] = config[key];
              }
            });
            callback(merged);
          },
          remove: () => {},
        },
      },
      tabs: {
        query: (_queryInfo, callback) => callback([]),
        sendMessage: (tabId, message, callback) => {
          tabMessages.push({ tabId, message });
          callback?.();
        },
      },
    },
    clearTimeout,
    console,
    fetch: async (resource, init = {}) => {
      fetchCalls.push({ resource, init });

      if (fetchImpl) return fetchImpl(resource, init);

      if (resource === 'http://sab.local/api') {
        return new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('<?xml version="1.0"?><nzb></nzb>', {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="movie.nzb"',
          'content-type': 'application/x-nzb+xml',
        },
      });
    },
    setTimeout: () => 0,
  });

  const source = fs.readFileSync(path.join(repoRoot, 'src/background.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'src/background.js' });

  return {
    canceledDownloads,
    context,
    dnrSessionRuleUpdates,
    downloadItems,
    fetchCalls,
    notificationCreates,
    onChangedListener,
    onCreatedListener,
    onMessageListener,
    tabMessages,
  };
}

test('content script forwards NZB MIME hints for ambiguous download endpoints', () => {
  const { clickListener, sentMessages } = loadContentScript();
  let prevented = false;
  let stopped = false;

  const anchor = {
    href: 'https://indexer.example/api?t=get&id=42',
    dataset: {},
    getAttribute: (name) => (name === 'type' ? 'application/x-nzb+xml' : ''),
  };

  clickListener({
    altKey: false,
    button: 0,
    ctrlKey: false,
    isTrusted: true,
    metaKey: false,
    preventDefault: () => {
      prevented = true;
    },
    shiftKey: false,
    stopPropagation: () => {
      stopped = true;
    },
    target: {
      closest: () => anchor,
    },
  });

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(
    sentMessages.map((message) => message.action),
    ['register_download_gesture', 'siphon_download'],
  );
  assert.equal(sentMessages[0].url, 'https://indexer.example/api?t=get&id=42');
  assert.equal(sentMessages[0].mime, 'application/x-nzb+xml');
  assert.equal(sentMessages[1].kind, 'nzb');
  assert.equal(sentMessages[1].mime, 'application/x-nzb+xml');
});

test('background keeps notifications disabled by default', async () => {
  const { context, notificationCreates } = loadBackgroundScript();

  context.logActivity('Saved to client', 'success');

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(notificationCreates, []);
});

test('background appends qBittorrent session cookies to scoped API requests', async () => {
  const qbitTestUrl = 'http://qbittorrent.example.test:18080';

  const { context, dnrSessionRuleUpdates } = loadBackgroundScript({
    __cookieItems: [
      { name: 'QBT_SID_8080', value: 'wrong-port-session' },
      { name: 'SID', value: 'legacy-session' },
      { name: 'QBT_SID_18080', value: 'session-token' },
    ],
  });

  await context.syncQbitHeaderRule(qbitTestUrl, true);

  const latestUpdate = dnrSessionRuleUpdates.at(-1);
  assert.deepEqual(latestUpdate.removeRuleIds, [1001, 1002]);
  assert.equal(latestUpdate.addRules.length, 2);

  const cookieRule = latestUpdate.addRules.find((rule) => rule.id === 1002);
  assert.ok(cookieRule);
  assert.equal(cookieRule.condition.regexFilter, '^http://qbittorrent\\.example\\.test:18080/api/v2/');
  assert.deepEqual(cookieRule.condition.resourceTypes, ['xmlhttprequest', 'other']);
  assert.deepEqual(cookieRule.action.requestHeaders, [
    {
      header: 'cookie',
      operation: 'append',
      value: 'QBT_SID_18080=session-token',
    },
  ]);
});

test('background supports legacy qBittorrent SID session cookies', async () => {
  const { context, dnrSessionRuleUpdates } = loadBackgroundScript({
    __cookieItems: [{ name: 'SID', value: 'legacy-session-token' }],
  });

  await context.syncQbitHeaderRule('http://qbittorrent.example.test:8080', true);

  const latestUpdate = dnrSessionRuleUpdates.at(-1);
  const cookieRule = latestUpdate.addRules.find((rule) => rule.id === 1002);

  assert.equal(cookieRule.action.requestHeaders[0].value, 'SID=legacy-session-token');
});

test('background accepts qBittorrent 204 login responses', async () => {
  const { context } = loadBackgroundScript({
    __fetch: async () => new Response(null, { status: 204 }),
  });

  const result = await context.loginToQbit('http://qbittorrent.example.test:18080', 'admin', 'pass');

  assert.equal(result.success, true);
});

test('background sends notifications only when configured', async () => {
  const { context, notificationCreates } = loadBackgroundScript({
    notificationsEnabled: true,
  });

  context.logActivity('Saved to client', 'success');

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(notificationCreates.length, 1);
  assert.equal(notificationCreates[0][1].title, 'warp: Success');
});

test('background page toasts are independently toggleable', async () => {
  const enabled = loadBackgroundScript();
  enabled.context.showPageToast('Siphoning download...', 7);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(enabled.tabMessages.length, 1);
  assert.equal(enabled.tabMessages[0].tabId, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(enabled.tabMessages[0].message)), {
    action: 'show_toast',
    text: 'Siphoning download...',
    tone: 'info',
  });

  const disabled = loadBackgroundScript({ pageToastsEnabled: false });
  disabled.context.showPageToast('Siphoning download...', 7);

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(disabled.tabMessages, []);
});

test('background honors an explicit NZB kind when the URL itself is ambiguous', async () => {
  const { fetchCalls, onMessageListener } = loadBackgroundScript();

  const response = await new Promise((resolve) => {
    onMessageListener(
      {
        action: 'siphon_download',
        filename: 'download',
        kind: 'nzb',
        mime: '',
        url: 'https://indexer.example/api?t=get&id=42',
      },
      { tab: { id: 7 } },
      resolve,
    );
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.handled, true);
  assert.ok(fetchCalls.some((call) => call.resource === 'https://indexer.example/api?t=get&id=42'));
});

test('downloads fallback siphons a recent native NZB download after a user gesture', async () => {
  const { canceledDownloads, fetchCalls, onCreatedListener, onMessageListener } =
    loadBackgroundScript();

  const gestureResponse = await new Promise((resolve) => {
    onMessageListener(
      {
        action: 'register_download_gesture',
        url: 'https://indexer.example/api?t=get&id=77',
      },
      { tab: { id: 12 } },
      resolve,
    );
  });

  assert.equal(gestureResponse.received, true);

  onCreatedListener({
    filename: '/Users/skulltrail/Downloads/movie.nzb',
    id: 99,
    mime: 'application/octet-stream',
    url: 'https://indexer.example/api?t=get&id=77',
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(canceledDownloads, [99]);
  assert.ok(fetchCalls.some((call) => call.resource === 'https://indexer.example/api?t=get&id=77'));
});

test('downloads fallback re-checks pending browser downloads once the NZB filename appears', async () => {
  const {
    canceledDownloads,
    downloadItems,
    fetchCalls,
    onChangedListener,
    onCreatedListener,
    onMessageListener,
  } = loadBackgroundScript();

  const gestureResponse = await new Promise((resolve) => {
    onMessageListener(
      {
        action: 'register_download_gesture',
        url: 'https://indexer.example/api?t=get&id=321',
      },
      { tab: { id: 21 } },
      resolve,
    );
  });

  assert.equal(gestureResponse.received, true);

  const createdItem = {
    filename: '',
    id: 321,
    mime: 'application/octet-stream',
    state: 'in_progress',
    url: 'https://indexer.example/api?t=get&id=321',
  };

  downloadItems.set(createdItem.id, createdItem);
  onCreatedListener(createdItem);

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(canceledDownloads, []);

  downloadItems.set(createdItem.id, {
    ...createdItem,
    filename: '/Users/skulltrail/Downloads/final-release.nzb',
  });

  onChangedListener({
    filename: { current: '/Users/skulltrail/Downloads/final-release.nzb' },
    id: 321,
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(canceledDownloads, [321]);
  assert.ok(
    fetchCalls.some((call) => call.resource === 'https://indexer.example/api?t=get&id=321'),
  );
});

test('downloads fallback matches exact clicked URL when multiple gestures exist', async () => {
  const { canceledDownloads, fetchCalls, onCreatedListener, onMessageListener } =
    loadBackgroundScript();

  await new Promise((resolve) => {
    onMessageListener(
      {
        action: 'register_download_gesture',
        url: 'https://indexer.example/api?t=get&id=old',
      },
      { tab: { id: 1 } },
      resolve,
    );
  });

  await new Promise((resolve) => {
    onMessageListener(
      {
        action: 'register_download_gesture',
        url: 'https://indexer.example/api?t=get&id=match',
      },
      { tab: { id: 2 } },
      resolve,
    );
  });

  onCreatedListener({
    filename: '/Users/skulltrail/Downloads/match.nzb',
    id: 777,
    mime: 'application/octet-stream',
    url: 'https://indexer.example/api?t=get&id=match',
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(canceledDownloads, [777]);
  assert.ok(
    fetchCalls.some((call) => call.resource === 'https://indexer.example/api?t=get&id=match'),
  );
});

test('downloads fallback intercepts repeated clicks on same NZB URL every time', async () => {
  const { canceledDownloads, fetchCalls, onCreatedListener, onMessageListener } =
    loadBackgroundScript();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => {
      onMessageListener(
        {
          action: 'register_download_gesture',
          url: 'https://indexer.example/api?t=get&id=repeat',
        },
        { tab: { id: 50 + attempt } },
        resolve,
      );
    });

    onCreatedListener({
      filename: '/Users/skulltrail/Downloads/repeat.nzb',
      id: 900 + attempt,
      mime: 'application/octet-stream',
      url: 'https://indexer.example/api?t=get&id=repeat',
    });

    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(canceledDownloads, [900, 901, 902, 903, 904]);
  assert.equal(
    fetchCalls.filter((call) => call.resource === 'https://indexer.example/api?t=get&id=repeat')
      .length,
    5,
  );
});
