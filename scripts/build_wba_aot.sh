#!/usr/bin/env bash
# Experimental host-native WBA build. Never selects or restarts a live worker.
set -euo pipefail
if [[ $# != 2 ]]; then
  echo "Usage: bash scripts/build_wba_aot.sh /path/to/bun /visible/output-directory" >&2
  exit 2
fi
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$repo/app/apps/code_te2"
bun="$(command -v "$1")"
mkdir -p "$2/logs" "$2/artifacts" "$2/state" "$2/tmp"
out="$(cd "$2" && pwd)"
export TMPDIR="$out/tmp"
stage="$app/workbench_protocol_proxy/node_workbench_adapter/src/protocol/messagepack-codec.mjs"
owned_stage=0
cleanup() {
  if [[ $owned_stage == 1 ]]; then rm -- "$stage"; fi
}
trap cleanup EXIT
"$bun" --revision > "$out/logs/bun-revision.txt"
git -C "$repo" rev-parse HEAD > "$out/logs/source-commit.txt"
cd "$app"
echo "Building generated modules and checking owned frontend/WBA types..."
node build.mjs > "$out/logs/build.log" 2>&1
npm run typecheck > "$out/logs/typecheck.log" 2>&1
codec="$app/workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs"
if [[ -e "$stage" ]]; then
  cmp "$stage" "$codec"
else
  cp "$codec" "$stage"
  owned_stage=1
fi
entry=workbench_protocol_proxy/node_workbench_adapter/src/server/server.ts
echo "Checking experimental native AOT compatibility..."
"$bun" check --aot "$entry" > "$out/logs/aot-check.log" 2>&1
echo "Compiling native WBA with shipped assets (not installed extensions/themes)..."
MSGPACKR_NATIVE_ACCELERATION_DISABLED=1 "$bun" build --compile --aot --root "$app" \
  --asset monaco_editor/themes/vendored/github/dark-default.json \
  --asset workbench_protocol_proxy/node_workbench_adapter/src/protocol/messagepack-codec.mjs \
  --asset vendor/node_socketio/node_modules --asset vendor/picomatch \
  "$entry" --outfile "$out/artifacts/wba-aot" > "$out/logs/aot-build.log" 2>&1
sha256sum "$out/artifacts/wba-aot"
stat -c '%s bytes' "$out/artifacts/wba-aot"
echo "Not activated. Run the isolated protocol probe before selecting this binary."
