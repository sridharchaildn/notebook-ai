#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$ROOT/services/local-sidecar/.venv/bin/python}"
DIST_DIR="$ROOT/dist-sidecar"
TMP_DIR="$ROOT/.tmp/pyinstaller-local-sidecar"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python executable not found: $PYTHON_BIN" >&2
  exit 1
fi

rm -rf "$DIST_DIR" "$TMP_DIR"
mkdir -p "$DIST_DIR" "$TMP_DIR"

"$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --clean \
  --onefile \
  --distpath "$DIST_DIR" \
  --workpath "$TMP_DIR/build" \
  --specpath "$TMP_DIR/spec" \
  --name notebook-ai-local-sidecar \
  --paths "$ROOT/services/local-sidecar" \
  --add-data "$ROOT/specs:specs" \
  --add-data "$ROOT/VERSION:." \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  "$ROOT/services/local-sidecar/run_sidecar.py"

# Do not copy ffmpeg into the release. Homebrew ffmpeg is typically GPL.
# The sidecar uses an ffmpeg binary on PATH when one is installed.
