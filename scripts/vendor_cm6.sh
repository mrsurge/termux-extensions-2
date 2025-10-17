#!/usr/bin/env bash
set -euo pipefail

# Where you want the browser-loadable ESM files to live (matches your imports)
BASE="$(cd "$(dirname "$0")"/.. && pwd)/app/static/vendor/codemirror/@codemirror"
mkdir -p "$BASE"

# Packages to fetch from npm
PKGS=(
  state view commands search language
  lang-javascript lang-json lang-python lang-html lang-css lang-markdown lang-xml
  legacy-modes
)

# Make a temp project to download from npm
WORKDIR="$(mktemp -d)"
pushd "$WORKDIR" >/dev/null

npm init -y >/dev/null 2>&1
# A few robustness knobs (optional)
npm config set fetch-retries 5 >/dev/null
npm config set fetch-retry-maxtimeout 600000 >/dev/null
npm config set registry https://registry.npmjs.org/ >/dev/null

# Install CM6 packages (no lang-shell — it doesn’t exist)
npm i $(printf '@codemirror/%s ' "${PKGS[@]}") --no-audit --no-fund

# Copy dist bundles (and styles if present) into your static tree
for p in "${PKGS[@]}"; do
  SRC="node_modules/@codemirror/$p"
  if [ -d "$SRC/dist" ]; then
    mkdir -p "$BASE/$p/dist"
    cp -r "$SRC/dist/"* "$BASE/$p/dist/"
  fi
  if [ -d "$SRC/style" ]; then
    mkdir -p "$BASE/$p/style"
    cp -r "$SRC/style/"* "$BASE/$p/style/" || true
  fi
done

# --- Create a shim for `@codemirror/lang-shell` to keep your imports unchanged ---
# Your main.js imports `/@codemirror/lang-shell/dist/index.js`. This shim re-exports shell via legacy-modes.
mkdir -p "$BASE/lang-shell/dist"
cat > "$BASE/lang-shell/dist/index.js" <<'EOF'
/* Shim for @codemirror/lang-shell: provides `shell()` via legacy-modes */
import {StreamLanguage} from '../language/dist/index.js';
import {shell as shellLegacy} from '../legacy-modes/mode/shell.js';
export function shell() { return StreamLanguage.define(shellLegacy); }
export default shell;
EOF

popd >/dev/null
rm -rf "$WORKDIR"

echo "CodeMirror 6 vendored into:"
echo "  $BASE/*/dist/index.js"
echo "Shim created at:"
echo "  $BASE/lang-shell/dist/index.js"

