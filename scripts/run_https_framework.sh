#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/run_https_framework.sh <cert-path> <key-path> [optional-framework-args...]
#
# Example:
#   scripts/run_https_framework.sh certs/dev-cert.pem certs/dev-key.pem
#
# This script sets the TE_SSL_CERT / TE_SSL_KEY env vars and launches the framework
# using ./scripts/run_framework.sh. Run it from the project root.

if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <cert-path> <key-path> [framework-args...]"
    exit 1
fi

CERT_PATH="$1"
KEY_PATH="$2"
shift 2

if [[ ! -f "${CERT_PATH}" ]]; then
    echo "Certificate file not found: ${CERT_PATH}"
    exit 1
fi

if [[ ! -f "${KEY_PATH}" ]]; then
    echo "Key file not found: ${KEY_PATH}"
    exit 1
fi

export TE_SSL_CERT="$(cd "$(dirname "${CERT_PATH}")" && pwd)/$(basename "${CERT_PATH}")"
export TE_SSL_KEY="$(cd "$(dirname "${KEY_PATH}")" && pwd)/$(basename "${KEY_PATH}")"

echo "Using certificate: ${TE_SSL_CERT}"
echo "Using key:         ${TE_SSL_KEY}"
echo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_SCRIPT="${SCRIPT_DIR}/run_framework.sh"

if [[ ! -x "${FRAMEWORK_SCRIPT}" ]]; then
    echo "Framework script not found or not executable: ${FRAMEWORK_SCRIPT}"
    exit 1
fi

exec "${FRAMEWORK_SCRIPT}" "$@"
