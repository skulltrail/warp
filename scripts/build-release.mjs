import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const manifestPath = path.join(repoRoot, 'manifest.json');
const distDir = path.join(repoRoot, 'dist');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const isDevBuild = process.argv.includes('--dev');
const isReleaseBuild = process.argv.includes('--release');

if (packageJson.version !== manifest.version) {
  throw new Error(
    `package.json version (${packageJson.version}) must match manifest.json version (${manifest.version}).`,
  );
}

const bundleEntries = ['manifest.json', 'src', 'assets'];
const outputRoot = isDevBuild ? path.join(distDir, 'dev') : distDir;

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const chromiumManifest = structuredClone(manifest);
const firefoxManifest = structuredClone(manifest);
const workerPath = manifest.background?.service_worker ?? 'src/background.js';
firefoxManifest.background = { scripts: [workerPath] };
firefoxManifest.browser_specific_settings = {
  ...manifest.browser_specific_settings,
  gecko: {
    id: 'warp@skulltrail.dev',
    ...manifest.browser_specific_settings?.gecko,
    data_collection_permissions: {
      required: ['none'],
    },
  },
};

function createBundle(browser, browserManifest) {
  const bundleDir = path.join(outputRoot, browser);
  fs.mkdirSync(bundleDir, { recursive: true });

  for (const entry of bundleEntries.slice(1)) {
    fs.cpSync(path.join(repoRoot, entry), path.join(bundleDir, entry), { recursive: true });
  }

  fs.writeFileSync(
    path.join(bundleDir, 'manifest.json'),
    `${JSON.stringify(browserManifest, null, 2)}\n`,
  );

  console.log(`Created ${path.relative(repoRoot, bundleDir)}/`);
  return bundleDir;
}

function injectLocalConfig(bundleDir) {
  const localConfigPath = path.join(repoRoot, 'config', 'local.json');
  if (!fs.existsSync(localConfigPath)) return;

  const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  const backgroundPath = path.join(bundleDir, workerPath);
  const backgroundSource = fs.readFileSync(backgroundPath, 'utf8');
  fs.writeFileSync(
    backgroundPath,
    `globalThis.WARP_LOCAL_CONFIG = ${JSON.stringify(localConfig)};\n${backgroundSource}`,
  );
  console.log(`Injected local config into ${path.relative(repoRoot, bundleDir)}/`);
}

function collectArchiveEntries(directory, relativePath = '') {
  const entries = {};

  for (const item of fs.readdirSync(path.join(directory, relativePath), { withFileTypes: true })) {
    const itemPath = path.join(relativePath, item.name);
    if (item.isDirectory()) {
      Object.assign(entries, collectArchiveEntries(directory, itemPath));
    } else {
      entries[itemPath.split(path.sep).join('/')] = fs.readFileSync(path.join(directory, itemPath));
    }
  }

  return entries;
}

const bundles = {
  chromium: createBundle('chromium', chromiumManifest),
  firefox: createBundle('firefox', firefoxManifest),
};

if (!isDevBuild) {
  for (const [browser, bundleDir] of Object.entries(bundles)) {
    const artifactName = `warp-${browser}-v${packageJson.version}.zip`;
    const artifactPath = path.join(distDir, artifactName);
    fs.writeFileSync(artifactPath, zipSync(collectArchiveEntries(bundleDir), { level: 9 }));

    console.log(`Created ${path.relative(repoRoot, artifactPath)}`);
  }
}

if (!isReleaseBuild) {
  Object.values(bundles).forEach(injectLocalConfig);
}
