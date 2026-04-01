import path from 'node:path';
import { getRepoRoot, readBaseVersion, replaceVersionInJsonFile, replaceVersionInTomlProject } from './version-utils.mjs';

const repoRoot = getRepoRoot();
const version = readBaseVersion();

const jsonTargets = [
  'package.json',
  'apps/desktop/package.json',
  'apps/web/package.json',
  'packages/app-core/package.json',
  'packages/contracts/package.json',
  'packages/server-ai/package.json',
  'packages/theme/package.json',
  'packages/ui/package.json',
];

const tomlTargets = [
  'services/local-sidecar/pyproject.toml',
  'services/cloud-api/pyproject.toml',
];

for (const relativePath of jsonTargets) {
  replaceVersionInJsonFile(path.join(repoRoot, relativePath), version);
}

for (const relativePath of tomlTargets) {
  replaceVersionInTomlProject(path.join(repoRoot, relativePath), version);
}

process.stdout.write(`Synchronized repo version ${version}\n`);
