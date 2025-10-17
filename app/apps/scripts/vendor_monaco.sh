#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
VENDOR_DIR="$ROOT_DIR/static/vendor/monaco"
mkdir -p "$VENDOR_DIR"

WORKDIR=$(mktemp -d)
pushd "$WORKDIR" >/dev/null
npm init -y >/dev/null 2>&1
npm i monaco-editor@^0.50.0 --no-audit --no-fund --silent
mkdir -p "$VENDOR_DIR/vs"
cp -r node_modules/monaco-editor/min/vs/* "$VENDOR_DIR/vs/"
popd >/dev/null
rm -rf "$WORKDIR"
echo "Monaco vendored into $VENDOR_DIR"
