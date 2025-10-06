#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: run_framework.sh [--run-local | --broadcast] [extra python -m app.main args...]

  --run-local    Bind Flask to 127.0.0.1
  --broadcast    Bind Flask to 0.0.0.0 (default)

If the framework is already running, the script will request the existing
instance to switch to the requested mode instead of spawning another host.
EOF
}

generate_run_id() {
  python - <<'PY'
import time
import uuid

run_id = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
print(run_id)
PY
}

REQUESTED_MODE="broadcast"

EXTRA_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-local)
      REQUESTED_MODE="local"
      shift
      ;;
    --broadcast)
      REQUESTED_MODE="broadcast"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

export TE_RUN_MODE="$REQUESTED_MODE"

generate_run_id_if_needed() {
  if [ -z "${TE_RUN_ID:-}" ]; then
    export TE_RUN_ID="$(generate_run_id)"
  fi
}

generate_run_id_if_needed

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

supervisor_running() {
  local pid
  pid=$(pgrep -f "python -m app.supervisor" || true)
  [ -n "$pid" ]
}

request_mode_switch() {
  local target
  case "$REQUESTED_MODE" in
    local)
      target="127.0.0.1"
      ;;
    broadcast|*)
      target="0.0.0.0"
      ;;
  esac
  if command -v curl >/dev/null 2>&1; then
    local tmp
    tmp=$(mktemp)
    if curl -fsS -m 5 -o "$tmp" -X POST \
      -H 'Content-Type: application/json' \
      -d "{\"host\": \"$target\"}" \
      "http://127.0.0.1:8080/api/framework/runtime/bind"; then
      echo "[run_framework] Requested host switch to $target"
      rm -f "$tmp"
      return 0
    fi
    rm -f "$tmp"
  fi
  return 1
}

if supervisor_running; then
  if request_mode_switch; then
    exit 0
  fi
  echo "[run_framework] Existing supervisor detected but bind switch failed; starting fresh." >&2
fi

exec python -m app.supervisor "${EXTRA_ARGS[@]}"
