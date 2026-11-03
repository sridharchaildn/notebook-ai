/**
 * Oryx's post-build `npm install --production` runs inside `.oryx_prod_node_modules`
 * and resolves `file:./_swa_workspace_packages/*` from that directory, where the
 * vendored packages are not present. The Next build has already bundled those
 * packages, so drop the file: deps and write a registry-only lockfile for that
 * production install. Registry deps of the vendored packages (for example `ai`)
 * are hoisted so a server require of them still installs.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'apps', 'web');

function readPackage(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

function isFileDependency(value) {
  return typeof value === 'string' && value.startsWith('file:');
}

function resolveFileDependency(fromDir, spec) {
  return path.resolve(fromDir, spec.slice('file:'.length));
}

function collectRegistryDependencies(dir, seen, into) {
  const realDir = path.resolve(dir);
  if (seen.has(realDir)) return;
  seen.add(realDir);

  const manifest = readPackage(realDir);
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (isFileDependency(spec)) {
      collectRegistryDependencies(resolveFileDependency(realDir, spec), seen, into);
      continue;
    }
    if (!into[name]) into[name] = spec;
  }
}

function main() {
  const pkgPath = path.join(webRoot, 'package.json');
  const pkg = readPackage(webRoot);
  const registryDependencies = {};
  const seen = new Set();

  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (isFileDependency(spec)) {
      collectRegistryDependencies(resolveFileDependency(webRoot, spec), seen, registryDependencies);
      continue;
    }
    registryDependencies[name] = spec;
  }

  pkg.dependencies = registryDependencies;
  const productionManifest = `${JSON.stringify(pkg, null, 2)}\n`;
  writeFileSync(pkgPath, productionManifest);

  const staging = mkdtempSync(path.join(tmpdir(), 'swa-prod-lock-'));
  try {
    writeFileSync(path.join(staging, 'package.json'), productionManifest);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawnSync(
      npm,
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: staging, stdio: 'inherit', env: process.env },
    );
    if (install.status !== 0) {
      throw new Error(`npm install --package-lock-only exited with ${install.status}`);
    }

    const lockText = readFileSync(path.join(staging, 'package-lock.json'), 'utf8');
    if (lockText.includes('file:')) {
      throw new Error('Production lockfile still contains a file: dependency');
    }
    writeFileSync(path.join(webRoot, 'package-lock.json'), lockText);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main();
