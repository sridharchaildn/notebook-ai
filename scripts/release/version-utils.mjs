import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

export function getRepoRoot() {
  return repoRoot;
}

export function readBaseVersion() {
  return fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
}

export function readBuildVersion() {
  return process.env.NOTEBOOK_BUILD_VERSION?.trim() || readBaseVersion();
}

export function replaceVersionInJsonFile(filePath, version, dependencyPrefix = '@notebook-ai/') {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  parsed.version = version;

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = parsed[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, currentValue] of Object.entries(deps)) {
      if (!name.startsWith(dependencyPrefix) || typeof currentValue !== 'string') continue;
      // Keep workspace/file links intact for local monorepo installs.
      if (currentValue.startsWith('file:') || currentValue.startsWith('workspace:')) continue;
      deps[name] = version;
    }
  }

  fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

export function replaceVersionInTomlProject(filePath, version) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const next = raw.replace(/^version = ".*"$/m, `version = "${version}"`);
  fs.writeFileSync(filePath, next);
}
