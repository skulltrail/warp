import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localConfigPath = path.join(repoRoot, 'config', 'local.json');
const injectedConfigPrefix = 'globalThis.WARP_LOCAL_CONFIG = ';
const archiveExtensions = new Set(['.zip', '.xpi']);
const findings = [];

function runGit(args, { encoding = null } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.toString().trim() || `git ${args.join(' ')} failed`);
  }

  return result.stdout;
}

function readCredentialValues() {
  if (!fs.existsSync(localConfigPath)) return [];

  const config = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  return ['qbitPass', 'sabKey']
    .map((key) => [key, String(config[key] || '').trim()])
    .filter(([, value]) => value.length >= 4);
}

const credentialValues = readCredentialValues();

function record(file, reason) {
  const finding = `${file}: ${reason}`;
  if (!findings.includes(finding)) findings.push(finding);
}

function scanBuffer(file, buffer) {
  const text = buffer.toString('utf8');

  if (text.startsWith(injectedConfigPrefix)) {
    record(file, 'contains an injected local configuration');
  }

  for (const [key, value] of credentialValues) {
    if (buffer.includes(Buffer.from(value))) {
      record(file, `contains the local ${key} value`);
    }
  }

  if (!archiveExtensions.has(path.extname(file).toLowerCase())) return;

  let archive;
  try {
    archive = unzipSync(buffer);
  } catch {
    record(file, 'could not be inspected as an archive');
    return;
  }

  for (const [entry, contents] of Object.entries(archive)) {
    scanBuffer(`${file}:${entry}`, Buffer.from(contents));
  }
}

function splitNull(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function scanStaged() {
  const files = splitNull(
    runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']),
  );

  for (const file of files) {
    if (file === 'config/local.json') {
      record(file, 'local configuration must never be committed');
      continue;
    }
    scanBuffer(file, runGit(['show', `:${file}`]));
  }
}

function scanCommit(revision) {
  const files = splitNull(runGit(['ls-tree', '-r', '--name-only', '-z', revision]));

  for (const file of files) {
    if (file === 'config/local.json') {
      record(`${revision}:${file}`, 'local configuration must never be pushed');
      continue;
    }
    scanBuffer(`${revision}:${file}`, runGit(['show', `${revision}:${file}`]));
  }
}

function scanTracked() {
  const files = splitNull(runGit(['ls-files', '-z']));

  for (const file of files) {
    if (file === 'config/local.json') {
      record(file, 'local configuration must never be tracked');
      continue;
    }

    const absolutePath = path.join(repoRoot, file);
    if (fs.existsSync(absolutePath)) scanBuffer(file, fs.readFileSync(absolutePath));
  }
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function scanDist() {
  const distDir = path.join(repoRoot, 'dist');
  for (const file of walk(distDir)) {
    scanBuffer(path.relative(repoRoot, file), fs.readFileSync(file));
  }
}

const args = process.argv.slice(2);
if (args[0] === '--staged') scanStaged();
else if (args[0] === '--tracked') scanTracked();
else if (args[0] === '--commit' && args[1]) scanCommit(args[1]);
else if (args[0] === '--dist') scanDist();
else throw new Error('Usage: check-secrets.mjs --staged | --tracked | --commit SHA | --dist');

if (findings.length) {
  console.error('Secret-safety check failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exitCode = 1;
} else {
  console.log('Secret-safety check passed.');
}
