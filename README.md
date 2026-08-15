# warp

![warp](assets/warp.png)

Seamlessly siphons magnet links, `.torrent` files, and `.nzb` downloads to remote clients.

## Install

Download the Chromium or Firefox package from [Releases](https://github.com/skulltrail/warp/releases). Configure qBittorrent and SABnzbd from the extension popup.

- **Chromium:** extract the archive, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
- **Firefox:** install the signed `.xpi`, or load `manifest.json` temporarily from `about:debugging`.

## Local development

Requires Node.js 24+ and a local Chromium or Firefox installation.

```bash
npm ci
cp config/local.example.json config/local.json # optional local endpoints
npm run dev:chromium                       # or: npm run dev:firefox
```

`config/local.json` stays untracked and is injected only into local unpacked development bundles. Local and release archives remain credential-free. Backend credentials are stored in browser-local storage and are never synced.

## Build

```bash
npm run ci
```

Browser bundles and archives are written to `dist/`.

`make build` creates credential-free ZIPs, then injects local config only into `dist/chromium/` and `dist/firefox/` for manual loading. `npm run build:release` produces entirely credential-free bundles and archives for signing and publishing. Never publish or share an unpacked local bundle.

## Support

warp targets current Chromium and Firefox releases. See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute and [SECURITY.md](SECURITY.md) to report vulnerabilities.
