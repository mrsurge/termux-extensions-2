#!/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF2'
Usage: run_asgi_framework.sh [--reload]

Launches the framework under the ASGI host (Uvicorn).

  --reload    Enable Uvicorn autoreload (development only)
EOF2
}

RELOAD_ARGS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --reload)
      RELOAD_ARGS+=("--reload")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export TE_SESSION_TYPE="framework"
export TE_RUN_ID="asgi_$(date +%s)"

exec python -m app.supervisor --asgi "${RELOAD_ARGS[@]}"
