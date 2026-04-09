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
# 3. Monaco bootstrap + chunks + basic-languages + language (NOT workers)
# ===================================================================
echo "[3/8] Monaco te2-lang (no workers)..."

MONACO_SRC="$APP_DIR/static/vendor/monaco-editor-core/te2-lang"
MONACO_DST="$DEST/static/vendor/monaco-editor-core/te2-lang"

# Bootstrap (JS + CSS only, skip .map/.bak)
mkdir -p "$MONACO_DST/bootstrap"
for ext in js css; do
    [ -f "$MONACO_SRC/bootstrap/monaco.bootstrap.bundle.$ext" ] && \
        cp "$MONACO_SRC/bootstrap/monaco.bootstrap.bundle.$ext" "$MONACO_DST/bootstrap/"
done

# Chunks
for f in "$MONACO_SRC"/chunk-*.js; do
    [ -f "$f" ] && cp "$f" "$MONACO_DST/"
done

# basic-languages + language
[ -d "$MONACO_SRC/basic-languages" ] && copy_tree "$MONACO_SRC/basic-languages" "$MONACO_DST/basic-languages"
[ -d "$MONACO_SRC/language" ] && copy_tree "$MONACO_SRC/language" "$MONACO_DST/language"

# ===================================================================
# 4. Monaco ESM (worker-only)
# ===================================================================
echo "[4/8] Monaco ESM worker bundle..."

MONACO_ESM_SRC="$APP_DIR/static/vendor/monaco-editor-core/esm"
MONACO_ESM_DST="$DEST/static/vendor/monaco-editor-core/esm"

# The main Monaco UI is already bundled into te2-lang/bootstrap/monaco.bootstrap.bundle.js.
# Android still needs the editor web worker entrypoint because m_editor_app.js loads it from
# /ui/monaco_vscode/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js at runtime.
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

# Version surface kept in sync with the server and APK bundle.
[ -f "$CM6_STATIC_SRC/version.txt" ] && \
    copy_file "$CM6_STATIC_SRC/version.txt" "$CM6_STATIC_DST/version.txt"

# Direct host-page runtime references that are not bundled into host.js.
[ -f "$CM6_STATIC_SRC/js/explorer.css" ] && \
    copy_file "$CM6_STATIC_SRC/js/explorer.css" "$CM6_STATIC_DST/js/explorer.css"

# App icons referenced by manifests/sidebar surfaces.
[ -d "$CM6_STATIC_SRC/icons" ] && copy_tree "$CM6_STATIC_SRC/icons" "$CM6_STATIC_DST/icons"

# Runtime-loaded vendor assets that remain separate from the built bundles.
[ -d "$CM6_STATIC_SRC/vendor/monaco-touch-selection" ] && \
    copy_tree "$CM6_STATIC_SRC/vendor/monaco-touch-selection" "$CM6_STATIC_DST/vendor/monaco-touch-selection"
[ -f "$CM6_STATIC_SRC/vendor/vconsole/vconsole.min.js" ] && \
    copy_file "$CM6_STATIC_SRC/vendor/vconsole/vconsole.min.js" "$CM6_STATIC_DST/vendor/vconsole/vconsole.min.js"

# ===================================================================
# 6. TE2 editor libs (served under /api/app/file_editor_cm6/ui/)
# ===================================================================
echo "[6/8] TE2 editor libs..."

CM6_MONACO="$APP_DIR/apps/file_editor_cm6/monaco_editor"
UI_DST="$DEST/api/app/file_editor_cm6/ui"

# Android only needs the built editor bundle here, not the raw per-module source tree.
mkdir -p "$UI_DST/monaco_editor"

# The Python server serves the IIFE bundle (static/dist/editor.js) when the
# browser requests m_editor_app.js.  The raw source is ESM and will crash in a
# plain <script> tag, so overwrite the raw copy with the built IIFE bundle.
DIST_EDITOR="$APP_DIR/apps/file_editor_cm6/static/dist/editor.js"
if [ -f "$DIST_EDITOR" ]; then
    cp "$DIST_EDITOR" "$UI_DST/monaco_editor/m_editor_app.js"
    echo "  → Overwrote m_editor_app.js with IIFE bundle ($(wc -c < "$DIST_EDITOR") bytes)"
else
    echo "  ⚠ static/dist/editor.js not found — run 'node build.mjs' first"
fi

# textmate UMDs
[ -d "$CM6_MONACO/textmate" ] && copy_tree "$CM6_MONACO/textmate" "$UI_DST/monaco_editor/textmate"

# themes dir (contains JSON theme files)
[ -d "$CM6_MONACO/themes" ] && copy_tree "$CM6_MONACO/themes" "$UI_DST/monaco_editor/themes"

# vscode_build_src/out/ (breadcrumbsWidget etc)
[ -d "$CM6_MONACO/vscode_build_src" ] && copy_tree "$CM6_MONACO/vscode_build_src" "$UI_DST/monaco_editor/vscode_build_src"

# file_editor_cm6 top-level JS/HTML served by routes
for f in main.js template.html; do
    [ -f "$APP_DIR/apps/file_editor_cm6/$f" ] && \
        copy_file "$APP_DIR/apps/file_editor_cm6/$f" "$DEST/apps/file_editor_cm6/$f"
done

# editor_iframe.html (served at /api/app/file_editor_cm6/ui/nc)
[ -f "$CM6_MONACO/editor_iframe.html" ] && \
    copy_file "$CM6_MONACO/editor_iframe.html" "$UI_DST/nc.html"

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

# generic app_shell.html served locally for /app/<app_id>
if [ -f "$APP_DIR/templates/app_shell.html" ]; then
    sed 's/{{ app_id|tojson }}/null/g; s|{{ url_for('\''static'\'', filename='\''js/ws_port.js'\'') }}|/static/js/ws_port.js|g' \
        "$APP_DIR/templates/app_shell.html" > "$DEST/app_shell.html"
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
