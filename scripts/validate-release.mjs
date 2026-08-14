import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const distDir = path.join(repoRoot, 'dist');

function readManifest(browser) {
  return JSON.parse(fs.readFileSync(path.join(distDir, browser, 'manifest.json'), 'utf8'));
}

const chromium = readManifest('chromium');
const firefox = readManifest('firefox');

assert.equal(chromium.background.service_worker, 'src/background.js');
assert.deepEqual(firefox.background.scripts, ['src/background.js']);
assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions, {
  required: ['none'],
});

for (const [browser, manifest] of Object.entries({ chromium, firefox })) {
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.permissions.includes('scripting'), false);
  assert.equal(manifest.permissions.includes('tabs'), false);
  const archivePath = path.join(distDir, `warp-${browser}-v${packageJson.version}.zip`);
  assert.ok(fs.existsSync(archivePath), `Missing ${browser} release archive`);

  const archive = unzipSync(fs.readFileSync(archivePath));
  const releaseBackground = new TextDecoder().decode(archive['src/background.js']);
  assert.equal(
    releaseBackground.startsWith('globalThis.WARP_LOCAL_CONFIG = '),
    false,
    `${browser} release archive contains local configuration`,
  );
}

console.log('Validated Chromium and Firefox release artifacts.');
