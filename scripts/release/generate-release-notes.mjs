import fs from 'node:fs';
import path from 'node:path';
import { getRepoRoot, readBaseVersion } from './version-utils.mjs';

const repoRoot = getRepoRoot();
const fragmentsDir = path.join(repoRoot, '.changes');
const outputDir = path.join(repoRoot, 'docs/releases');
const versionArgIndex = process.argv.indexOf('--version');
const version =
  versionArgIndex >= 0 && process.argv[versionArgIndex + 1]
    ? process.argv[versionArgIndex + 1].trim()
    : readBaseVersion();

const CATEGORY_ORDER = ['Security', 'Added', 'Changed', 'Fixed'];
const sections = new Map(CATEGORY_ORDER.map((category) => [category, []]));

for (const name of fs.readdirSync(fragmentsDir).sort()) {
  if (!name.endsWith('.md') || name === 'README.md') continue;
  const raw = fs.readFileSync(path.join(fragmentsDir, name), 'utf8').trim();
  const match = /^---\s*[\r\n]+category:\s*(.+?)\s*[\r\n]+area:\s*(.+?)\s*[\r\n]+(?:pr:\s*(.+?)\s*[\r\n]+)?---\s*[\r\n]+([\s\S]+)$/m.exec(raw);
  if (!match) {
    throw new Error(`Invalid release note fragment: ${name}`);
  }

  const [, category, area, pr, body] = match;
  const normalizedCategory = CATEGORY_ORDER.includes(category.trim()) ? category.trim() : 'Changed';
  const prSuffix = pr?.trim() ? ` (#${pr.trim()})` : '';
  const line = `- ${body.trim()} [${area.trim()}]${prSuffix}`;
  sections.get(normalizedCategory)?.push(line);
}

const lines = [`# Release ${version}`, ''];
for (const category of CATEGORY_ORDER) {
  const items = sections.get(category) ?? [];
  if (items.length === 0) continue;
  lines.push(`## ${category}`, '');
  lines.push(...items, '');
}

const outputPath = path.join(outputDir, `${version}.md`);
fs.writeFileSync(outputPath, `${lines.join('\n').trim()}\n`);
process.stdout.write(`${outputPath}\n`);
