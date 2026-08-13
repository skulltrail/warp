import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const manifestPath = path.join(repoRoot, 'manifest.json');
const distDir = path.join(repoRoot, 'dist');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (packageJson.version !== manifest.version) {
  throw new Error(
    `package.json version (${packageJson.version}) must match manifest.json version (${manifest.version}).`,
  );
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const artifactName = `warp-extension-v${packageJson.version}.zip`;
const artifactPath = path.join('dist', artifactName);
const bundleEntries = ['manifest.json', 'src', 'assets'];

// Unpacked bundle for loading as a temporary add-on in Gecko browsers
// (Firefox: about:debugging#/runtime/this-firefox -> Load Temporary Add-on ->
// point at unpacked/manifest.json).
const unpackedDir = path.join(distDir, 'unpacked');
fs.mkdirSync(unpackedDir, { recursive: true });
for (const entry of bundleEntries) {
  fs.cpSync(path.join(repoRoot, entry), path.join(unpackedDir, entry), {
    recursive: true,
  });
}

// Gecko disables background.service_worker, so rewrite the copied manifest to
// use background.scripts (an event page). The root manifest / zip keep
// service_worker for Chromium.
const geckoManifest = { ...manifest };
const workerPath = manifest.background?.service_worker ?? 'src/background.js';
geckoManifest.background = { scripts: [workerPath] };
geckoManifest.browser_specific_settings = {
  ...manifest.browser_specific_settings,
  gecko: {
    id: 'warp@local',
    ...manifest.browser_specific_settings?.gecko,
  },
};
fs.writeFileSync(
  path.join(unpackedDir, 'manifest.json'),
  `${JSON.stringify(geckoManifest, null, 2)}\n`,
);

console.log(`Created ${path.relative(repoRoot, unpackedDir)}/ (unpacked)`);

const zipResult = spawnSync('zip', ['-qr', artifactPath, ...bundleEntries], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (zipResult.status !== 0) {
  throw new Error(`zip exited with status ${zipResult.status ?? 'unknown'}.`);
}

console.log(`Created ${artifactPath}`);
