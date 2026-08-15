# Contributing

Issues and focused pull requests are welcome.

1. Install Node.js 20+ and run `npm ci`.
2. Optionally copy `config/local.example.json` to `config/local.json`.
3. Launch with `npm run dev:chromium` or `npm run dev:firefox`.
4. Run `npm run ci` before opening a pull request.

Keep changes small, include tests for behavior changes, and verify both browsers when touching manifests or extension APIs. Never commit credentials or `config/local.json`.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
