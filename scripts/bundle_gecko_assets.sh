#!/usr/bin/env bash
# scripts/bundle_gecko_assets.sh
# Copies qualifying static files from app/ into the GeckoView APK assets
# directory, mirroring the URL path structure for trivial request interception.
#
# Usage:  ./scripts/bundle_gecko_assets.sh [VERSION]
#   VERSION defaults to a timestamp if not provided.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
DEST="$REPO_ROOT/android/app/src/main/assets/editor_static"
VERSION="${1:-$(date +%Y%m%d%H%M%S)}"

echo "=== Bundle GeckoView Static Assets ==="
echo "Source:  $APP_DIR"
echo "Dest:    $DEST"
echo "Version: $VERSION"

# Clean previous bundle
rm -rf "$DEST"
mkdir -p "$DEST"

# ---------- Helper ----------
copy_tree() {
    local src="$1" dst="$2"
    mkdir -p "$dst"
    # Copy files, exclude .map, .bak, .bak2, __pycache__, node_modules, .pyc
    find "$src" -type f \
        ! -name '*.map' \
        ! -name '*.bak' \
        ! -name '*.bak2' \
        ! -name '*.pyc' \
        ! -path '*/__pycache__/*' \
        ! -path '*/node_modules/*' \
        -print0 | while IFS= read -r -d '' f; do
            rel="${f#$src/}"
            mkdir -p "$dst/$(dirname "$rel")"
            cp "$f" "$dst/$rel"
        done
}

copy_file() {
    local src="$1" dst="$2"
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
}

# ===================================================================
# 1. /static/ (shared statics — excluding heavy vendor dirs)
# ===================================================================
echo "[1/8] Shared statics..."

# /static/fonts/
copy_tree "$APP_DIR/static/fonts" "$DEST/static/fonts"

# /static/js/
copy_tree "$APP_DIR/static/js" "$DEST/static/js"

# /static/ top-level files
for f in icon.png move.png manifest.webmanifest bookmarks.json; do
    [ -f "$APP_DIR/static/$f" ] && copy_file "$APP_DIR/static/$f" "$DEST/static/$f"
done

# ===================================================================
# 2. /static/vendor/ (selected vendor libs only)
# ===================================================================
echo "[2/8] Selected vendor libs..."

for vdir in codicons seti-icons es-module-shims xterm ws; do
    [ -d "$APP_DIR/static/vendor/$vdir" ] && copy_tree "$APP_DIR/static/vendor/$vdir" "$DEST/static/vendor/$vdir"
done

# socket.io standalone file
[ -f "$APP_DIR/static/vendor/socket.io.min.js" ] && \
    copy_file "$APP_DIR/static/vendor/socket.io.min.js" "$DEST/static/vendor/socket.io.min.js"

# ===================================================================
# 3. Monaco runtime CSS + workers
# ===================================================================
echo "[3/8] Monaco te2-lang runtime assets..."

MONACO_SRC="$APP_DIR/static/vendor/monaco-editor-core/te2-lang"
MONACO_DST="$DEST/static/vendor/monaco-editor-core/te2-lang"

# Monaco JavaScript is compiled into Code TE2's host.js. Keep only the runtime
# stylesheet, its font, and optional language-worker modules as separate files.
mkdir -p "$MONACO_DST/bootstrap"
[ -f "$MONACO_SRC/bootstrap/monaco.bootstrap.bundle.css" ] && \
    copy_file \
        "$MONACO_SRC/bootstrap/monaco.bootstrap.bundle.css" \
        "$MONACO_DST/bootstrap/monaco.bootstrap.bundle.css"
[ -f "$MONACO_SRC/bootstrap/codicon-LN6W7LCM.ttf" ] && \
    copy_file \
        "$MONACO_SRC/bootstrap/codicon-LN6W7LCM.ttf" \
        "$MONACO_DST/bootstrap/codicon-LN6W7LCM.ttf"
[ -d "$MONACO_SRC/workers" ] && copy_tree "$MONACO_SRC/workers" "$MONACO_DST/workers"

# ===================================================================
# 4. Monaco ESM (worker-only)
# ===================================================================
echo "[4/8] Monaco ESM worker bundle..."

MONACO_ESM_SRC="$APP_DIR/static/vendor/monaco-editor-core/esm"
MONACO_ESM_DST="$DEST/static/vendor/monaco-editor-core/esm"

# The main Monaco UI is compiled into Code TE2's host.js. Android still needs
# the generic editor worker entrypoint as a separate module worker.
[ -f "$MONACO_ESM_SRC/vs/editor/common/services/editorWebWorkerMain.bundle.js" ] && \
    copy_file \
        "$MONACO_ESM_SRC/vs/editor/common/services/editorWebWorkerMain.bundle.js" \
        "$MONACO_ESM_DST/vs/editor/common/services/editorWebWorkerMain.bundle.js"

# ===================================================================
# 5. file_editor_cm6/static/ (Android-needed subset only)
# ===================================================================
echo "[5/8] file_editor_cm6 statics..."

CM6_STATIC_SRC="$APP_DIR/apps/file_editor_cm6/static"
CM6_STATIC_DST="$DEST/apps/file_editor_cm6/static"

# The Android shell loads the built host bundle, not the raw host source tree.
[ -f "$CM6_STATIC_SRC/dist/host.js" ] && \
    copy_file "$CM6_STATIC_SRC/dist/host.js" "$CM6_STATIC_DST/dist/host.js"
[ -f "$CM6_STATIC_SRC/dist/host.css" ] && \
    copy_file "$CM6_STATIC_SRC/dist/host.css" "$CM6_STATIC_DST/dist/host.css"

# Version surface kept in sync with the server and APK bundle.
[ -f "$CM6_STATIC_SRC/version.txt" ] && \
    copy_file "$CM6_STATIC_SRC/version.txt" "$CM6_STATIC_DST/version.txt"

# Direct host-page runtime references that are not bundled into host.js.
[ -f "$CM6_STATIC_SRC/dist/explorer.css" ] && \
    copy_file "$CM6_STATIC_SRC/dist/explorer.css" "$CM6_STATIC_DST/dist/explorer.css"
[ -f "$CM6_STATIC_SRC/dist/explorer-highlight-github.css" ] && \
    copy_file \
        "$CM6_STATIC_SRC/dist/explorer-highlight-github.css" \
        "$CM6_STATIC_DST/dist/explorer-highlight-github.css"
[ -f "$CM6_STATIC_SRC/dist/explorer-search-widget.css" ] && \
    copy_file \
        "$CM6_STATIC_SRC/dist/explorer-search-widget.css" \
        "$CM6_STATIC_DST/dist/explorer-search-widget.css"

# App icons referenced by manifests/sidebar surfaces.
[ -d "$CM6_STATIC_SRC/icons" ] && copy_tree "$CM6_STATIC_SRC/icons" "$CM6_STATIC_DST/icons"

# Runtime-loaded vendor assets that remain separate from the built bundles.
[ -d "$CM6_STATIC_SRC/vendor/monaco-touch-selection" ] && \
    copy_tree "$CM6_STATIC_SRC/vendor/monaco-touch-selection" "$CM6_STATIC_DST/vendor/monaco-touch-selection"
[ -f "$CM6_STATIC_SRC/vendor/vconsole/vconsole.min.js" ] && \
    copy_file "$CM6_STATIC_SRC/vendor/vconsole/vconsole.min.js" "$CM6_STATIC_DST/vendor/vconsole/vconsole.min.js"

# App-local terminal drawer helpers loaded by host-terminal-drawer.ts.
[ -d "$APP_DIR/apps/file_editor_cm6/vendor/android-terminalapp-assets-js" ] && \
    copy_tree \
        "$APP_DIR/apps/file_editor_cm6/vendor/android-terminalapp-assets-js" \
        "$DEST/apps/file_editor_cm6/vendor/android-terminalapp-assets-js"

# ===================================================================
# 6. TE2 editor libs (served under /api/app/file_editor_cm6/ui/)
# ===================================================================
echo "[6/8] TE2 editor libs..."

CM6_MONACO="$APP_DIR/apps/file_editor_cm6/monaco_editor"
UI_DST="$DEST/api/app/file_editor_cm6/ui"

# Android uses the built host bundle as the entrypoint.  The inline host imports
# the editor runtime into host.js, so do not publish a parallel m_editor_app.js
# copy unless the legacy raw editor route is intentionally restored.
mkdir -p "$UI_DST/monaco_editor"

# TextMate runtime/assets. Grammar publication is intentionally retained pending
# a separate cleanup decision.
[ -d "$CM6_MONACO/textmate" ] && copy_tree "$CM6_MONACO/textmate" "$UI_DST/monaco_editor/textmate"

# themes dir (contains JSON theme files)
[ -d "$CM6_MONACO/themes" ] && copy_tree "$CM6_MONACO/themes" "$UI_DST/monaco_editor/themes"

# Direct breadcrumb stylesheet loaded by inline_host.ts.
[ -f "$CM6_MONACO/vscode_build_src/out/breadcrumbsWidget.css" ] && \
    copy_file \
        "$CM6_MONACO/vscode_build_src/out/breadcrumbsWidget.css" \
        "$UI_DST/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css"

# Editor overlay styles loaded by inline_host.ts.
CHAT_STYLE_SRC="$CM6_MONACO/vscode_chat_editing_vendor/upstream/media"
CHAT_STYLE_DST="$DEST/apps/file_editor_cm6/monaco_editor/vscode_chat_editing_vendor/upstream/media"
for style in chatEditorController.css chatEditingEditorOverlay.css; do
    [ -f "$CHAT_STYLE_SRC/$style" ] && \
        copy_file "$CHAT_STYLE_SRC/$style" "$CHAT_STYLE_DST/$style"
done

# file_editor_cm6 top-level HTML served by routes.
[ -f "$APP_DIR/apps/file_editor_cm6/template.html" ] && \
    copy_file "$APP_DIR/apps/file_editor_cm6/template.html" "$DEST/apps/file_editor_cm6/template.html"

# ===================================================================
# 7. TE2 extension frontend assets
# ===================================================================
echo "[7/8] TE2 extension frontend assets..."

EXT_SRC="$APP_DIR/extensions"
EXT_DST="$DEST/extensions"

copy_extension_frontend_tree() {
    local src="$1" dst="$2"
    mkdir -p "$dst"
    find "$src" -type f \
        ! -name '*.py' \
        ! -name '*.pyc' \
        ! -name '*.md' \
        ! -path '*/__pycache__/*' \
        ! -path '*/node_modules/*' \
        -print0 | while IFS= read -r -d '' f; do
            rel="${f#$src/}"
            mkdir -p "$dst/$(dirname "$rel")"
            cp "$f" "$dst/$rel"
        done
}

if [ -d "$EXT_SRC" ]; then
    for ext_dir in "$EXT_SRC"/*; do
        [ -d "$ext_dir" ] || continue
        copy_extension_frontend_tree "$ext_dir" "$EXT_DST/$(basename "$ext_dir")"
    done
fi

# ===================================================================
# 8. HTML pages (index, app_shell)
# ===================================================================
echo "[8/8] HTML pages..."

# index.html (served at /)
[ -f "$APP_DIR/templates/index.html" ] && \
    copy_file "$APP_DIR/templates/index.html" "$DEST/index.html"

# Code TE2 app shell served locally for /app/file_editor_cm6.
if [ -f "$APP_DIR/templates/app_shell.html" ]; then
    sed 's/{{ app_id|tojson }}/"file_editor_cm6"/g; s|{{ url_for('\''static'\'', filename='\''js/ws_port.js'\'') }}|/static/js/ws_port.js|g' \
        "$APP_DIR/templates/app_shell.html" > "$DEST/app_shell_file_editor_cm6.html"
fi

# ===================================================================
# Version file
# ===================================================================
echo "[done] Writing version.txt..."
echo "$VERSION" > "$DEST/version.txt"

# Report
TOTAL=$(du -sh "$DEST" | cut -f1)
FILE_COUNT=$(find "$DEST" -type f | wc -l)
echo ""
echo "=== Bundle Complete ==="
echo "Total size:  $TOTAL"
echo "File count:  $FILE_COUNT"
echo "Version:     $VERSION"
echo "Location:    $DEST"
