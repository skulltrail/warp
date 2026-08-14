document.addEventListener(
  'click',
  (event) => {
    const isPrimaryPlainLeftClick =
      event.isTrusted &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey;
    if (!isPrimaryPlainLeftClick) return;

    // Find the closest anchor tag in the click path
    const clickTarget = event.target;
    const anchor =
      clickTarget && typeof clickTarget.closest === 'function' ? clickTarget.closest('a') : null;
    if (!anchor || anchor.dataset.warpPassthrough === 'true' || !anchor.href) return;

    // Let background worker correlate browser-native downloads with clicked target.
    safeSendMessage({
      action: 'register_download_gesture',
      filename: anchor.getAttribute('download') || '',
      mime: anchor.getAttribute('type') || '',
      url: anchor.href,
    });

    const isMagnet = anchor.href.startsWith('magnet:');
    const siphonKind = isMagnet
      ? null
      : inferSiphonKind(anchor.href, anchor.getAttribute('download'), anchor.getAttribute('type'));
    if (!isMagnet && !siphonKind) return;

    if (isMagnet) {
      // Intercept!
      event.preventDefault();
      event.stopPropagation();

      // Send to background script
      const sent = safeSendMessage({
        action: 'siphon_magnet',
        url: anchor.href,
      });
      if (!sent) replayNativeDownload(anchor);

      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const sent = safeSendMessage(
      {
        action: 'siphon_download',
        url: anchor.href,
        kind: siphonKind,
        mime: anchor.getAttribute('type') || '',
        filename: inferDownloadFilename(anchor, siphonKind),
      },
      (response, runtimeError) => {
        if (runtimeError || !response?.handled) {
          replayNativeDownload(anchor);
        }
      },
    );
    if (!sent) replayNativeDownload(anchor);
  },
  true,
); // use capture phase to intercept early

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'show_toast') return;
  showToast(message.text, message.tone);
});

function canTalkToBackground() {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function safeSendMessage(message, callback) {
  try {
    if (!canTalkToBackground()) return false;

    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        callback?.(undefined, chrome.runtime.lastError);
        return;
      }

      callback?.(response, null);
    });
    return true;
  } catch (err) {
    console.debug('warp message send skipped:', err);
    return false;
  }
}

function showToast(text = 'Siphoning...', tone = 'info') {
  const existingToast = document.getElementById('warp-toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.id = 'warp-toast';
  const mark = document.createElement('span');
  mark.className = 'warp-toast-mark';
  mark.setAttribute('aria-hidden', 'true');
  const markImage = document.createElement('img');
  markImage.src = chrome.runtime.getURL('assets/warp.png');
  markImage.alt = '';
  markImage.width = 20;
  markImage.height = 20;
  mark.appendChild(markImage);
  const label = document.createElement('span');
  label.className = 'warp-toast-label';
  label.textContent = text;
  toast.append(mark, label);

  const toastPalette = {
    info: {
      border: '1px solid rgba(0, 229, 255, 0.45)',
      boxShadow: '0 8px 24px rgba(0, 229, 255, 0.12)',
      background: 'linear-gradient(180deg, rgba(8, 14, 24, 0.95), rgba(6, 11, 19, 0.95))',
    },
    success: {
      border: '1px solid rgba(150, 255, 82, 0.42)',
      boxShadow: '0 8px 24px rgba(150, 255, 82, 0.12)',
      background: 'linear-gradient(180deg, rgba(8, 18, 14, 0.95), rgba(6, 14, 11, 0.95))',
    },
    error: {
      border: '1px solid rgba(255, 75, 117, 0.42)',
      boxShadow: '0 8px 24px rgba(255, 75, 117, 0.14)',
      background: 'linear-gradient(180deg, rgba(24, 8, 14, 0.95), rgba(19, 6, 11, 0.95))',
    },
  };
  const palette = toastPalette[tone] || toastPalette.info;

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: palette.background,
    color: '#f8fafc',
    padding: '12px 16px',
    borderRadius: '8px',
    border: palette.border,
    boxShadow: palette.boxShadow,
    fontFamily:
      '"JetBrains Mono", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    zIndex: '999999',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    transform: 'translateY(20px)',
    opacity: '0',
  });

  Object.assign(mark.style, {
    width: '20px',
    height: '20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    filter: 'drop-shadow(0 0 10px rgba(0, 229, 255, 0.18))',
  });

  Object.assign(markImage.style, {
    width: '20px',
    height: '20px',
    display: 'block',
    objectFit: 'contain',
  });

  Object.assign(label.style, {
    lineHeight: '1.3',
  });

  document.body.appendChild(toast);

  // Trigger animations
  setTimeout(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  }, 10);

  setTimeout(() => {
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function inferSiphonKind(targetUrl, hintedFilename = '', hintedMime = '') {
  const candidates = [targetUrl, hintedFilename].filter(Boolean);
  const normalizedMime = (hintedMime || '').toLowerCase();

  if (
    candidates.some((value) => matchesDownloadExtension(value, 'torrent')) ||
    normalizedMime.includes('bittorrent')
  ) {
    return 'torrent';
  }

  if (
    candidates.some((value) => matchesDownloadExtension(value, 'nzb')) ||
    candidates.some(matchesNzbRoute) ||
    matchesNzbMime(normalizedMime)
  ) {
    return 'nzb';
  }

  return null;
}

function matchesNzbMime(mime) {
  return mime.includes('x-nzb') || mime.includes('nzb+xml') || mime.endsWith('/nzb');
}

function matchesNzbRoute(value) {
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.pathname
      .split('/')
      .filter(Boolean)
      .some((segment) => /^(?:get|download)[_-]?nzbs?$/i.test(decodeURIComponent(segment)));
  } catch {
    return false;
  }
}

function matchesDownloadExtension(value, extension) {
  const extensionPattern = new RegExp(`\\.${extension}(?:$|[/?#&])`, 'i');
  const normalized = (value || '').toString();

  if (!normalized) return false;

  try {
    const parsed = new URL(value, window.location.href);
    if (extensionPattern.test(parsed.pathname)) return true;
    if (extensionPattern.test(decodeURIComponent(parsed.pathname))) return true;
    return [...parsed.searchParams.values()].some((paramValue) => {
      const decodedValue = decodeURIComponent(paramValue);
      return extensionPattern.test(paramValue) || extensionPattern.test(decodedValue);
    });
  } catch {
    try {
      return extensionPattern.test(decodeURIComponent(normalized));
    } catch {
      return extensionPattern.test(normalized);
    }
  }
}

function inferDownloadFilename(anchor, kind) {
  const explicitName = (anchor.getAttribute('download') || '').trim();
  if (explicitName) return explicitName;

  try {
    const parsed = new URL(anchor.href, window.location.href);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) return decodeURIComponent(lastSegment);
  } catch (err) {
    console.debug('Unable to infer download filename from anchor:', err);
  }

  return kind === 'torrent' ? 'download.torrent' : 'download.nzb';
}

function replayNativeDownload(anchor) {
  const passthroughAnchor = document.createElement('a');
  passthroughAnchor.href = anchor.href;
  passthroughAnchor.dataset.warpPassthrough = 'true';

  if (anchor.target) passthroughAnchor.target = anchor.target;
  if (anchor.rel) passthroughAnchor.rel = anchor.rel;
  if (anchor.hasAttribute('download')) {
    passthroughAnchor.setAttribute('download', anchor.getAttribute('download') || '');
  }

  passthroughAnchor.style.display = 'none';
  document.body.appendChild(passthroughAnchor);
  passthroughAnchor.click();
  passthroughAnchor.remove();
}
