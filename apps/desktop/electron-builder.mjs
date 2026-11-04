import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const distSidecar = path.join(repoRoot, 'dist-sidecar');
const extraResources = [];

const releaseType = process.env.NOTEBOOK_DESKTOP_RELEASE_TYPE === 'release' ? 'release' : 'draft';

// electron-builder's native unpacker hangs on GitHub macOS runners after it
// downloads the Electron zip. The electron package has already extracted the
// same runtime, so point the packager at that directory and skip the unpacker.
function resolveElectronDist() {
  const candidates = [
    process.env.NOTEBOOK_ELECTRON_DIST?.trim(),
    path.join(repoRoot, 'node_modules', 'electron', 'dist'),
    path.join(__dirname, 'node_modules', 'electron', 'dist'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'Electron.app')) ||
      fs.existsSync(path.join(candidate, 'electron.exe'))
    ) {
      return candidate;
    }
  }

  return undefined;
}

const electronDist = resolveElectronDist();

const sidecarBinary = path.join(distSidecar, 'notebook-ai-local-sidecar');
if (fs.existsSync(sidecarBinary)) {
  extraResources.push({
    from: sidecarBinary,
    to: 'local-sidecar/notebook-ai-local-sidecar',
  });
}

export default {
  appId: 'ai.notebook.desktop',
  productName: 'Notebook AI',
  ...(electronDist ? { electronDist } : {}),
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  files: ['dist/**', 'dist-electron/**', 'package.json'],
  asar: true,
  extraResources,
  artifactName: 'Notebook-AI-${version}-${arch}.${ext}',
  mac: {
    icon: 'assets/icon.icns',
    category: 'public.app-category.productivity',
    target: ['dmg'],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'electron/entitlements.mac.plist',
    entitlementsInherit: 'electron/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Notebook AI needs microphone access to capture local notes and interviews.',
      NSScreenCaptureDescription: 'Notebook AI needs screen and system audio capture to transcribe meetings.',
    },
  },
  dmg: {
    sign: true,
  },
  publish: [
    {
      provider: 'github',
      owner: 'sridharchaildn',
      repo: 'notebook-ai',
      releaseType,
    },
  ],
};
