/**
 * Azure Static Web Apps repackages `apps/web` without the monorepo root, so
 * `file:../../packages/*` deps break on Oryx's `npm install --production`.
 * Copy workspace packages under apps/web and rewrite those deps to local paths.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const vendorDir = path.join(webRoot, '_swa_workspace_packages');
const workspaceNames = ['app-core', 'contracts', 'server-ai', 'theme', 'ui'];
/** server-ai imports `../../../specs/...` from `src/`, which resolves to repo root; under apps/web that is `apps/web/specs`. */
const webSpecsDir = path.join(webRoot, 'specs');

function main() {
  if (!existsSync(webRoot)) {
    throw new Error(`Expected apps/web at ${webRoot}`);
  }

  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });

  for (const name of workspaceNames) {
    const src = path.join(repoRoot, 'packages', name);
    if (!existsSync(path.join(src, 'package.json'))) {
      throw new Error(`Missing package at ${src}`);
    }
    cpSync(src, path.join(vendorDir, name), { recursive: true });
  }

  const specsSrc = path.join(repoRoot, 'specs');
  if (!existsSync(specsSrc)) {
    throw new Error(`Missing specs at ${specsSrc}`);
  }
  rmSync(webSpecsDir, { recursive: true, force: true });
  cpSync(specsSrc, webSpecsDir, { recursive: true });

  const pkgPath = path.join(webRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const re = /^file:\.\.\/\.\.\/packages\/([^/]+)$/;

  for (const section of ['dependencies', 'devDependencies']) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [key, value] of Object.entries(deps)) {
      if (typeof value !== 'string') continue;
      const m = value.match(re);
      if (!m) continue;
      const folder = m[1];
      if (!workspaceNames.includes(folder)) {
        throw new Error(`Unexpected workspace dep ${key}: ${value}`);
      }
      deps[key] = `file:./_swa_workspace_packages/${folder}`;
    }
  }

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(
    npm,
    ['install', '--workspaces=false', '--install-links=true'],
    { cwd: webRoot, stdio: 'inherit', env: process.env },
  );
  if (r.status !== 0) {
    throw new Error(`npm install in apps/web exited with ${r.status}`);
  }
}

main();
