#!/bin/env bash

set -euo pipefail

ORIG_ARGS=("$@")

usage() {
  cat <<'EOF'
Usage: run_framework.sh [OPTIONS]

Options:
  --broadcast <FILTER...>   Enable network access. REQUIRED: Provide 'all' or specific filters.
  --list-interfaces        Show available network interfaces and exit
  -h, --help              Show this help message

Filters can be:
  - IP address:        192.168.1.5
  - CIDR subnet:       192.168.1.0/24
  - Interface name:    wlan0 (calculates subnet from ifconfig)
  - all:               Allow all connections (no filtering)

Examples:
  run_framework.sh                              # Localhost only (secure default)
  run_framework.sh --broadcast all              # Open to all (WARNING: insecure)
  run_framework.sh --broadcast 192.168.1.0/24   # Allow home network subnet
  run_framework.sh --broadcast wlan0            # Allow wlan0 subnet
  run_framework.sh --broadcast 100.108.128.8 100.115.200.5  # Allow specific IPs
  run_framework.sh --list-interfaces            # Show interfaces
  
Note: Localhost (127.0.0.1) is always allowed.
      Interfaces with /32 netmask are skipped (Tailscale, etc).
EOF
}

_maybe_autoupdate_framework_shells() {
  # Auto-update the external framework_shells package from GitHub main.
  #
  # WARNING: This trades reproducibility for convenience. It is intended for
  # rapid iteration on-device. Set TE2_DISABLE_FWS_AUTOUPDATE=1 to disable.
  if [ "${TE2_DISABLE_FWS_AUTOUPDATE:-}" = "1" ]; then
    return 0
  fi

  # Prevent infinite restart loops.
  if [ "${TE2_FWS_AUTOUPDATED_ONCE:-}" = "1" ]; then
    return 0
  fi

  local python_bin="${PYTHON_BIN:-python}"
  if ! command -v "$python_bin" >/dev/null 2>&1; then
    echo "[run_framework] WARNING: python not found; skipping framework-shells auto-update" >&2
    return 0
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "[run_framework] WARNING: git not found; skipping framework-shells auto-update" >&2
    return 0
  fi

  # Resolve remote HEAD commit for the main branch.
  local remote_commit=""
  remote_commit="$(git ls-remote https://github.com/mrsurge/framework-shells main 2>/dev/null | awk 'NR==1 {print $1}')"
  if [ -z "$remote_commit" ]; then
    echo "[run_framework] WARNING: failed to resolve framework-shells remote commit; skipping auto-update" >&2
    return 0
  fi

  # Resolve installed commit (for VCS installs) from dist-info direct_url.json.
  local installed_commit=""
  installed_commit="$(
    "$python_bin" - <<'PY' 2>/dev/null || true
import json
from importlib import metadata

try:
    dist = metadata.distribution("framework-shells")
except Exception:
    print("")
    raise SystemExit(0)

direct = None
try:
    direct = dist.read_text("direct_url.json")
except Exception:
    direct = None

if not direct:
    print("")
    raise SystemExit(0)

try:
    data = json.loads(direct)
except Exception:
    print("")
    raise SystemExit(0)

commit = ((data.get("vcs_info") or {}).get("commit_id") or "").strip()
print(commit)
PY
  )"

  if [ -n "$installed_commit" ] && [ "$installed_commit" = "$remote_commit" ]; then
    return 0
  fi

  echo "[run_framework] Updating framework-shells (installed=${installed_commit:-none} remote=${remote_commit})"
  # Use pip from the same interpreter.
  "$python_bin" -m pip install -U "framework-shells @ git+https://github.com/mrsurge/framework-shells@main"

  # Restart this script once so newly installed package is used by IPC/framework processes.
  export TE2_FWS_AUTOUPDATED_ONCE=1
  exec "$0" "${ORIG_ARGS[@]}"
}

generate_run_id() {
  python - <<'PY'
import time
import uuid

run_id = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
print(run_id)
PY
}

FRAMEWORK_PORT="${TE_PORT:-8089}"
IPC_PORT_OVERRIDE=""
SLEEP_MODE=0

EXTRA_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port)
      shift
      FRAMEWORK_PORT="$1"
      shift
      ;;
    --ipc-port)
      shift
      IPC_PORT_OVERRIDE="$1"
      shift
      ;;
    --sleep)
      SLEEP_MODE=1
      shift
      ;;
    --broadcast)
      shift
      EXTRA_ARGS+=("--broadcast")
      # Collect all following args that aren't flags
      while [ "$#" -gt 0 ] && [[ ! "$1" =~ ^-- ]]; do
        EXTRA_ARGS+=("$1")
        shift
      done
      ;;
    --list-interfaces)
      EXTRA_ARGS+=("--list-interfaces")
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

generate_run_id_if_needed() {
  if [ -z "${TE_RUN_ID:-}" ]; then
    export TE_RUN_ID="$(generate_run_id)"
  fi
}

generate_run_id_if_needed

compute_repo_fingerprint() {
  local real_root
  if command -v readlink >/dev/null 2>&1; then
    real_root="$(readlink -f "$REPO_ROOT" 2>/dev/null)" || true
  fi
  if [ -z "${real_root:-}" ]; then
    real_root="$(python -c "import os; print(os.path.realpath('$REPO_ROOT'))")"
  fi
  echo -n "$real_root" | sha256sum | cut -c1-16
}

ensure_framework_secret() {
  local fingerprint secret_dir secret_file
  fingerprint="$(compute_repo_fingerprint)"
  secret_dir="$HOME/.cache/framework_shells/runtimes/$fingerprint"
  secret_file="$secret_dir/secret"
  
  if [ -f "$secret_file" ]; then
    FRAMEWORK_SHELLS_SECRET="$(cat "$secret_file")"
  else
    mkdir -p "$secret_dir"
    FRAMEWORK_SHELLS_SECRET="$(openssl rand -hex 32)"
    echo "$FRAMEWORK_SHELLS_SECRET" > "$secret_file"
    chmod 600 "$secret_file"
  fi
  
  export FRAMEWORK_SHELLS_SECRET
  export FRAMEWORK_SHELLS_REPO_FINGERPRINT="$fingerprint"
  export FRAMEWORK_SHELLS_BASE_DIR="$HOME/.cache/framework_shells"
}



cleanup_framework_shell_logs() {
  local base_dir="$HOME/.cache/te_framework"
  local logs_dir="$base_dir/logs"
  local preserved_dir="$base_dir/preserved_logs"

  # Archive any leftover logs from previous run (force-killed or otherwise)
  if [ -d "$logs_dir" ] && [ -n "$(ls -A "$logs_dir" 2>/dev/null)" ]; then
    local ts archive_dir
    ts="$(date +%s)"
    archive_dir="$preserved_dir/logs_$ts"
    
    mkdir -p "$preserved_dir"
    mv "$logs_dir" "$archive_dir"
    echo "[run_framework] Archived leftover shell logs to $archive_dir"
    mkdir -p "$logs_dir"
  fi
  
  # Clean up old preserved logs (older than 7 days)
  if [ -d "$preserved_dir" ]; then
    local now cutoff count
    now="$(date +%s)"
    cutoff=$((now - 604800))  # 7 days in seconds
    count=0
    
    for log_archive in "$preserved_dir"/logs_*; do
      if [ ! -d "$log_archive" ]; then
        continue
      fi
      
      # Extract timestamp from directory name (logs_1762550020 → 1762550020)
      local dir_name ts
      dir_name="$(basename "$log_archive")"
      ts="${dir_name#logs_}"
      
      # Validate it's a numeric timestamp
      if ! [[ "$ts" =~ ^[0-9]+$ ]]; then
        continue
      fi
      
      if [ "$ts" -lt "$cutoff" ]; then
        rm -rf "$log_archive"
        count=$((count + 1))
      fi
    done
    
    if [ "$count" -gt 0 ]; then
      echo "[run_framework] Cleaned $count preserved log archives older than 7 days"
    fi
  fi
}

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

ensure_framework_secret

_maybe_autoupdate_framework_shells

cleanup_framework_shell_logs

# Clean up stale python cache files
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

supervisor_running() {
  local pid
  pid=$(pgrep -f "python -m app.supervisor" || true)
  [ -n "$pid" ]
}

if supervisor_running; then
  echo "[run_framework] Framework already running. Stop it first or use different args." >&2
  exit 1
fi

IPC_PID_FILE="$HOME/.cache/te_framework/ipc.pid"
IPC_HOST="${TE_IPC_HOST:-127.0.0.1}"
IPC_PORT="${IPC_PORT_OVERRIDE:-${TE_IPC_PORT:-9099}}"
SLEEP_PORT=9100

export TE_IPC_HOST="$IPC_HOST"
export TE_IPC_PORT="$IPC_PORT"
export TE_PORT="$FRAMEWORK_PORT"

start_ipc_server() {
  local existing_pid=""
  if [ -f "$IPC_PID_FILE" ]; then
    existing_pid="$(cat "$IPC_PID_FILE" 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
      export TE_IPC_PID="$existing_pid"
      echo "[run_framework] Reusing existing IPC server (pid $existing_pid)"
      return 0
    fi
    rm -f "$IPC_PID_FILE"
  fi

  local python_bin="${PYTHON_BIN:-python}"
  echo "[run_framework] Starting IPC server on $IPC_HOST:$IPC_PORT (sleep listener :$SLEEP_PORT)"

  # Pass framework args (including framework port) down into IPC sleep mode so it can wake the framework.
  export TE_FRAMEWORK_ARGS_JSON
  TE_FRAMEWORK_ARGS_JSON="$(
    python - <<PY
import json, os, sys
args = json.loads(os.environ.get("TE_FRAMEWORK_ARGS_JSON_IN", "[]"))
print(json.dumps(args))
PY
  )"

  TE_FRAMEWORK_URL="${TE_FRAMEWORK_URL:-http://127.0.0.1:${FRAMEWORK_PORT}}" \
  TE_IPC_PERSIST=1 \
  IPC_LOG_PREFIX=1 \
  "$python_bin" -m app.ipc.server --host "$IPC_HOST" --port "$IPC_PORT" --sleep --sleep-port "$SLEEP_PORT" &
  TE_IPC_PID=$!
  export TE_IPC_PID
  mkdir -p "$(dirname "$IPC_PID_FILE")"
  echo "$TE_IPC_PID" > "$IPC_PID_FILE"
  echo "[run_framework] IPC server pid $TE_IPC_PID"
}

# Prepare args list for IPC to use when waking the framework.
export TE_FRAMEWORK_ARGS_JSON_IN
TE_FRAMEWORK_ARGS_JSON_IN="$(python -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${EXTRA_ARGS[@]}" --port "$FRAMEWORK_PORT")"

start_ipc_server

shutdown_ipc() {
  # Let IPC orchestrate shutdown (sleep supervisor) and then exit itself.
  curl -fsS -X POST "http://${IPC_HOST}:${SLEEP_PORT}/actions/exit" >/dev/null 2>&1 || \
    curl -fsS -X POST "http://${IPC_HOST}:${SLEEP_PORT}/actions/sleep" >/dev/null 2>&1 || true

  # Wait briefly for IPC to self-exit; do not kill it unless it's stuck.
  for _i in $(seq 1 50); do
    if ! kill -0 "$TE_IPC_PID" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done

  # Last resort.
  kill "$TE_IPC_PID" 2>/dev/null || true
}

trap 'shutdown_ipc' EXIT INT TERM

if [ "$SLEEP_MODE" -eq 0 ]; then
  # Wait for sleep listener to come up, then wake framework.
  for _i in $(seq 1 50); do
    if curl -sS "http://${IPC_HOST}:${SLEEP_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
  echo "[run_framework] Waking framework via sleep listener"
  curl -sS -X POST "http://${IPC_HOST}:${SLEEP_PORT}/actions/wake" >/dev/null || true
else
  echo "[run_framework] Sleep mode: framework not started (wake via http://${IPC_HOST}:${SLEEP_PORT}/actions/wake)"
fi

# Ctrl+S triggers sleep (stop framework, keep IPC alive).
# Note: Ctrl+S may be intercepted by terminal flow control depending on stty settings.
while kill -0 "$TE_IPC_PID" 2>/dev/null; do
  key=""
  IFS= read -rsn1 -t 0.2 key || true
  if [ "${key}" = $'\x13' ]; then
    echo "[run_framework] Ctrl+S -> /actions/sleep"
    curl -fsS -X POST "http://${IPC_HOST}:${SLEEP_PORT}/actions/sleep" >/dev/null || true
  fi
  sleep 0.05
done
