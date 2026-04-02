import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const distSidecar = path.join(repoRoot, 'dist-sidecar');
const extraResources = [];

const sidecarBinary = path.join(distSidecar, 'notebook-ai-local-sidecar');
if (fs.existsSync(sidecarBinary)) {
  extraResources.push({
    from: sidecarBinary,
    to: 'local-sidecar/notebook-ai-local-sidecar',
  });
}

const ffmpegBinary = path.join(distSidecar, 'ffmpeg');
if (fs.existsSync(ffmpegBinary)) {
  extraResources.push({
    from: ffmpegBinary,
    to: 'ffmpeg/ffmpeg',
  });
}

export default {
  appId: 'ai.notebook.desktop',
  productName: 'Notebook AI',
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
      releaseType: 'draft',
    },
  ],
};
