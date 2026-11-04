#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_VERSION="${NOTEBOOK_BUILD_VERSION:-$(cat "$ROOT/VERSION")}"
SIDECAR_BIN="$ROOT/dist-sidecar/notebook-ai-local-sidecar"

if [[ ! -x "$SIDECAR_BIN" ]]; then
  echo "Packaged sidecar binary not found at $SIDECAR_BIN" >&2
  exit 1
fi

cd "$ROOT"
npm run version:sync
NOTEBOOK_BUILD_VERSION="$BUILD_VERSION" npm run build:desktop

if [[ -d "$ROOT/node_modules/electron" ]]; then
  ELECTRON_PKG="$ROOT/node_modules/electron"
elif [[ -d "$ROOT/apps/desktop/node_modules/electron" ]]; then
  ELECTRON_PKG="$ROOT/apps/desktop/node_modules/electron"
else
  echo "electron package is not installed" >&2
  exit 1
fi
ELECTRON_DIST="$ELECTRON_PKG/dist"
if [[ ! -d "$ELECTRON_DIST/Electron.app" && ! -f "$ELECTRON_DIST/electron.exe" ]]; then
  echo "Installing the Electron runtime before packaging"
  node "$ELECTRON_PKG/install.js"
fi
if [[ ! -d "$ELECTRON_DIST/Electron.app" && ! -f "$ELECTRON_DIST/electron.exe" ]]; then
  echo "Electron runtime was not installed at $ELECTRON_DIST" >&2
  exit 1
fi
export NOTEBOOK_ELECTRON_DIST="$ELECTRON_DIST"

PUBLISH_MODE="${NOTEBOOK_DESKTOP_PUBLISH:-never}"
NOTEBOOK_BUILD_VERSION="$BUILD_VERSION" npm run package:mac --workspace @notebook-ai/desktop -- --publish "$PUBLISH_MODE"
