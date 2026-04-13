<div align="center">
  <img src="assets/warp.png" alt="Warp" width="200" />
  <h1>warp</h1>
</div>

Seamlessly siphons magnet links, `.torrent` files, and `.nzb` downloads to remote clients.

## Development

Install dependencies and configure the shared Git hook path:

```bash
npm install
npm run install-hooks
```

Run the same checks used by CI:

```bash
npm run ci
```

Build the release archive locally:

```bash
npm run build
```
