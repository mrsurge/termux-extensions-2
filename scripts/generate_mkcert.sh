#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CERT_DIR="${PROJECT_ROOT}/certs"

usage() {
    cat <<'EOF'
Usage: scripts/generate_mkcert.sh <hostnames-or-ips>

Examples:
  scripts/generate_mkcert.sh 127.0.0.1 localhost
  scripts/generate_mkcert.sh 127.0.0.1 localhost 192.168.1.23

This script:
  1. Ensures mkcert is installed.
  2. Runs `mkcert -install` (no-op if already done).
  3. Creates PEM files in ./certs (dev-cert.pem / dev-key.pem) for the hosts.

Run this on the machine serving the NiceGUI app (desktop/laptop), not on Android.
EOF
}

if [[ $# -eq 0 ]]; then
    usage
    exit 1
fi

if ! command -v mkcert >/dev/null 2>&1; then
    echo "mkcert is required but not found on PATH."
    echo "Install mkcert from https://github.com/FiloSottile/mkcert and try again."
    exit 1
fi

mkdir -p "${CERT_DIR}"

echo "Running mkcert -install (safe to rerun)..."
mkcert -install

CERT_FILE="${CERT_DIR}/dev-cert.pem"
KEY_FILE="${CERT_DIR}/dev-key.pem"

echo "Generating certificate for hosts: $*"
mkcert -cert-file "${CERT_FILE}" -key-file "${KEY_FILE}" "$@"

echo
echo "Certificates written to:"
echo "  ${CERT_FILE}"
echo "  ${KEY_FILE}"
echo
echo "Remember to copy the mkcert root CA (see 'mkcert -CAROOT') to your Android device"
echo "and install it under Settings → Security → Encryption & credentials → Install from storage."
*** End Patch
