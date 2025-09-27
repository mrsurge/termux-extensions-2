#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

generate_run_id() {
  python - <<'PY'
import time
import uuid

run_id = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
print(run_id)
PY
}

if [ -z "${TE_RUN_ID:-}" ]; then
  export TE_RUN_ID="$(generate_run_id)"
fi

resolve_path() {
  local src="$1"
  if command -v readlink >/dev/null 2>&1; then
    readlink -f "$src" 2>/dev/null && return 0
  fi
  python - <<'PY' "$src"
import os, sys
print(os.path.realpath(sys.argv[1]))
PY
}

REAL_SCRIPT="$(resolve_path "${BASH_SOURCE[0]}")"
if [ -z "$REAL_SCRIPT" ]; then
  echo "Failed to resolve script path" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$REAL_SCRIPT")/.." && pwd)"
if [ -z "$REPO_ROOT" ]; then
  echo "Failed to determine repository root" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec python -m app.supervisor "$@"
