#!/bin/env bash

# Vendor Monaco Editor for offline use
MONACO_VERSION="0.44.0"
VENDOR_DIR="app/apps/code_oss/static/vendor/monaco"

echo "Downloading Monaco Editor v${MONACO_VERSION}..."

# Create directories
mkdir -p "${VENDOR_DIR}/min/vs"

# Base URL
BASE_URL="https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min"

# Download loader
echo "Downloading loader..."
curl -sL "${BASE_URL}/vs/loader.js" -o "${VENDOR_DIR}/min/vs/loader.js"

# Download editor main
echo "Downloading editor main..."
mkdir -p "${VENDOR_DIR}/min/vs/editor"
curl -sL "${BASE_URL}/vs/editor/editor.main.js" -o "${VENDOR_DIR}/min/vs/editor/editor.main.js"
curl -sL "${BASE_URL}/vs/editor/editor.main.css" -o "${VENDOR_DIR}/min/vs/editor/editor.main.css"
curl -sL "${BASE_URL}/vs/editor/editor.main.nls.js" -o "${VENDOR_DIR}/min/vs/editor/editor.main.nls.js"

# Download base components
echo "Downloading base components..."
mkdir -p "${VENDOR_DIR}/min/vs/base/worker"
curl -sL "${BASE_URL}/vs/base/worker/workerMain.js" -o "${VENDOR_DIR}/min/vs/base/worker/workerMain.js"

# Download basic languages
echo "Downloading language support..."
mkdir -p "${VENDOR_DIR}/min/vs/basic-languages"

for lang in javascript typescript python html css json sql markdown; do
    echo "  - ${lang}"
    mkdir -p "${VENDOR_DIR}/min/vs/basic-languages/${lang}"
    curl -sL "${BASE_URL}/vs/basic-languages/${lang}/${lang}.js" \
         -o "${VENDOR_DIR}/min/vs/basic-languages/${lang}/${lang}.js" 2>/dev/null || true
done

# Download language workers
echo "Downloading language workers..."
mkdir -p "${VENDOR_DIR}/min/vs/language"

# TypeScript/JavaScript worker
mkdir -p "${VENDOR_DIR}/min/vs/language/typescript"
curl -sL "${BASE_URL}/vs/language/typescript/tsWorker.js" \
     -o "${VENDOR_DIR}/min/vs/language/typescript/tsWorker.js" 2>/dev/null || true

# CSS worker  
mkdir -p "${VENDOR_DIR}/min/vs/language/css"
curl -sL "${BASE_URL}/vs/language/css/cssWorker.js" \
     -o "${VENDOR_DIR}/min/vs/language/css/cssWorker.js" 2>/dev/null || true

# HTML worker
mkdir -p "${VENDOR_DIR}/min/vs/language/html"
curl -sL "${BASE_URL}/vs/language/html/htmlWorker.js" \
     -o "${VENDOR_DIR}/min/vs/language/html/htmlWorker.js" 2>/dev/null || true

# JSON worker
mkdir -p "${VENDOR_DIR}/min/vs/language/json"
curl -sL "${BASE_URL}/vs/language/json/jsonWorker.js" \
     -o "${VENDOR_DIR}/min/vs/language/json/jsonWorker.js" 2>/dev/null || true

echo "Monaco Editor vendored to ${VENDOR_DIR}"
echo "Update document-viewer.html to use local paths instead of CDN"