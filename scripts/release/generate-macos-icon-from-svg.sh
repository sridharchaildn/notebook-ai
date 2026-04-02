#!/usr/bin/env bash
# Regenerate apps/desktop/assets/icon.icns from apps/desktop/assets/icon.svg (macOS only).
# Requires: sips, iconutil (ships with Xcode CLT).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SVG="$ROOT/apps/desktop/assets/icon.svg"
OUT="$ROOT/apps/desktop/assets/icon.icns"
TMP="$(mktemp -d)"
MASTER="$TMP/master.png"
ICONSET="$TMP/NotebookAI.iconset"
trap 'rm -rf "$TMP"' EXIT
mkdir "$ICONSET"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only runs on macOS (sips + iconutil)." >&2
  exit 1
fi

if [[ ! -f "$SVG" ]]; then
  echo "Missing $SVG" >&2
  exit 1
fi

sips -s format png "$SVG" --out "$MASTER"
sips -z 16 16     "$MASTER" --out "$ICONSET/icon_16x16.png"
sips -z 32 32     "$MASTER" --out "$ICONSET/icon_16x16@2x.png"
sips -z 32 32     "$MASTER" --out "$ICONSET/icon_32x32.png"
sips -z 64 64     "$MASTER" --out "$ICONSET/icon_32x32@2x.png"
sips -z 128 128   "$MASTER" --out "$ICONSET/icon_128x128.png"
sips -z 256 256   "$MASTER" --out "$ICONSET/icon_128x128@2x.png"
sips -z 256 256   "$MASTER" --out "$ICONSET/icon_256x256.png"
sips -z 512 512   "$MASTER" --out "$ICONSET/icon_256x256@2x.png"
sips -z 512 512   "$MASTER" --out "$ICONSET/icon_512x512.png"
sips -z 1024 1024 "$MASTER" --out "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$OUT"
echo "Wrote $OUT"
