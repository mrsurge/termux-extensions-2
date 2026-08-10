#!/bin/sh
# Dex • 2025-12-08 — quick LSP switch smoke test

API_BASE=${API_BASE:-http://localhost:8088}
PATH_PREFIX=${PATH_PREFIX:-/api/app/code_te2}
PROJECT_ROOT=${PROJECT_ROOT:-/data/data/com.termux/files/home/mrselect5}
LOG_FILE=${LOG_FILE:-$HOME/.tmp/test.log}

mkdir -p "$(dirname "$LOG_FILE")"

base="${API_BASE%/}${PATH_PREFIX}"
payload='{"languageId":"typescript","projectRoot":"'"${PROJECT_ROOT}"'"}'

echo "[LSP switch test] $(date -Iseconds) base=${base}" >> "$LOG_FILE"
curl -sS -X POST "${base}/api/lsp/switch" \
  -H 'Content-Type: application/json' \
  -d "$payload" >> "$LOG_FILE" && echo >> "$LOG_FILE"

curl -sS "${base}/api/lsp/active" >> "$LOG_FILE" && echo >> "$LOG_FILE"

echo "[done]" >> "$LOG_FILE"
