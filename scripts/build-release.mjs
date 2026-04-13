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
const bundleEntries = [
  'manifest.json',
  'src',
  'assets',
];

const zipResult = spawnSync('zip', ['-qr', artifactPath, ...bundleEntries], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (zipResult.status !== 0) {
  throw new Error(`zip exited with status ${zipResult.status ?? 'unknown'}.`);
}

console.log(`Created ${artifactPath}`);
