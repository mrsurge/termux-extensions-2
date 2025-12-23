#!/usr/bin/env bash
set -euo pipefail

# Vendoring helper for JetBrains Kotlin LSP distribution.
# Downloads + extracts into:
#   app/static/vendor/lsp_servers/kotlin-lsp/
#
# Usage:
#   scripts/vendor_kotlin_lsp.sh                               # auto-detect platform
#   scripts/vendor_kotlin_lsp.sh https://.../kotlin-lsp-....zip # explicit URL override

VERSION="261.13587.0"

# Auto-detect platform
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)
    PLATFORM="linux-x64"
    ;;
  aarch64|arm64)
    PLATFORM="linux-aarch64"
    ;;
  *)
    echo "[kotlin-lsp vendor] ERROR: Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ARG="${1:-}"
if [[ "$ARG" == http*://* ]]; then
  URL="$ARG"
else
  URL="https://download-cdn.jetbrains.com/kotlin-lsp/${VERSION}/kotlin-lsp-${VERSION}-${PLATFORM}.zip"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/app/static/vendor/lsp_servers/kotlin-lsp"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ZIP="${TMP}/kotlin-lsp.zip"
UNPACKED="${TMP}/unpacked"

echo "[kotlin-lsp vendor] Platform: $PLATFORM ($ARCH)"
echo "[kotlin-lsp vendor] Downloading ${URL}"
curl -L --fail --retry 5 --retry-delay 2 -o "$ZIP" "$URL"

mkdir -p "$UNPACKED"
echo "[kotlin-lsp vendor] Extracting"
unzip -q "$ZIP" -d "$UNPACKED"

# Some Kotlin LSP zips unpack into a top-level directory (e.g. kotlin-lsp-<ver>/).
# Others have kotlin-lsp.sh at the archive root. Locate the script and treat its
# parent directory as the distro root.
SOURCE_DIR="$UNPACKED"
if [ ! -f "${UNPACKED}/kotlin-lsp.sh" ]; then
  FOUND="$(find "$UNPACKED" -maxdepth 4 -type f -name kotlin-lsp.sh 2>/dev/null | head -n 1 || true)"
  if [ -z "$FOUND" ]; then
    echo "[kotlin-lsp vendor] ERROR: kotlin-lsp.sh not found in archive" >&2
    exit 1
  fi
  SOURCE_DIR="$(cd "$(dirname "$FOUND")" && pwd)"
fi

echo "[kotlin-lsp vendor] Installing into ${DEST}"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "${SOURCE_DIR}/." "$DEST/"

# Don't rely on the executable bit (we run via bash), but set it if possible.
chmod +x "${DEST}/kotlin-lsp.sh" 2>/dev/null || true

echo "[kotlin-lsp vendor] Done"
echo "  ${DEST}/kotlin-lsp.sh"
