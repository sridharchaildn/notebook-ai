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

PUBLISH_MODE="${NOTEBOOK_DESKTOP_PUBLISH:-never}"
NOTEBOOK_BUILD_VERSION="$BUILD_VERSION" npm run package:mac --workspace @notebook-ai/desktop -- --publish "$PUBLISH_MODE"
