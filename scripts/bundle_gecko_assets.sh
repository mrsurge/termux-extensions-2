#!/usr/bin/env bash
# Publish the manifest-declared Android asset seed into the APK source tree.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$REPO_ROOT/app/android_editor_assets_bundle.json"
DEST="$REPO_ROOT/android/app/src/main/assets/editor_static"
TEMP_BASE="${TEMPDIR:-$REPO_ROOT/.android-assets-tmp}"

command -v jq >/dev/null 2>&1 || {
    echo "jq is required to publish Android assets" >&2
    exit 1
}
command -v node >/dev/null 2>&1 || {
    echo "node is required to render Android asset templates" >&2
    exit 1
}
[ -f "$MANIFEST" ] || {
    echo "Android asset manifest not found: $MANIFEST" >&2
    exit 1
}

validate_relative_path() {
    local path="$1"
    if [ -z "$path" ] ||
        [[ "$path" = /* ]] ||
        [[ "$path" = ".." ]] ||
        [[ "$path" = ../* ]] ||
        [[ "$path" = */../* ]] ||
        [[ "$path" = */.. ]]; then
        echo "Asset path must stay repository-relative: $path" >&2
        exit 1
    fi
}

VERSION_FILE="$(jq -er '.version_file' "$MANIFEST")"
validate_relative_path "$VERSION_FILE"
[ -f "$REPO_ROOT/$VERSION_FILE" ] || {
    echo "Android asset version file not found: $REPO_ROOT/$VERSION_FILE" >&2
    exit 1
}
VERSION="$(tr -d '\r\n' < "$REPO_ROOT/$VERSION_FILE")"
[ -n "$VERSION" ] || {
    echo "Android asset version is empty: $REPO_ROOT/$VERSION_FILE" >&2
    exit 1
}
if [ "$#" -gt 0 ] && [ "$1" != "$VERSION" ]; then
    echo "Requested version $1 does not match source version $VERSION" >&2
    exit 1
fi

mapfile -t EXCLUDE_EXTENSIONS < <(jq -r '.exclude_extensions[]?' "$MANIFEST")
mapfile -t EXCLUDE_DIRS < <(jq -r '.exclude_dirs[]?' "$MANIFEST")

should_include() {
    local relative="$1"
    local excluded
    for excluded in "${EXCLUDE_DIRS[@]}"; do
        if [[ "/$relative/" = *"/$excluded/"* ]]; then
            return 1
        fi
    done
    for excluded in "${EXCLUDE_EXTENSIONS[@]}"; do
        if [[ "$relative" = *"$excluded" ]]; then
            return 1
        fi
    done
    return 0
}

mkdir -p "$TEMP_BASE"
STAGE_ROOT="$(mktemp -d "$TEMP_BASE/editor-static.XXXXXX")"
STAGE="$STAGE_ROOT/editor_static"
mkdir -p "$STAGE"

cleanup() {
    rm -rf "$STAGE_ROOT"
    rmdir "$TEMP_BASE" 2>/dev/null || true
}
trap cleanup EXIT

copy_file() {
    local src="$1"
    local dest="$2"
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
}

copy_tree() {
    local src_root="$1"
    local dest_root="$2"
    while IFS= read -r -d '' src; do
        local relative="${src#"$src_root"/}"
        should_include "$relative" || continue
        copy_file "$src" "$dest_root/$relative"
    done < <(find "$src_root" -type f -print0 | sort -z)
}

render_template() {
    local src="$1"
    local dest="$2"
    local entry_json="$3"
    mkdir -p "$(dirname "$dest")"
    node - "$src" "$dest" "$entry_json" <<'NODE'
const fs = require("fs");
const sourcePath = process.argv[2];
const destinationPath = process.argv[3];
const entry = JSON.parse(process.argv[4]);
let content = fs.readFileSync(sourcePath, "utf8");
for (const [needle, replacement] of Object.entries(entry.replacements || {})) {
  content = content.split(needle).join(replacement);
}
fs.writeFileSync(destinationPath, content);
NODE
}

entry_count="$(jq '.entries | length' "$MANIFEST")"
entry_index=0
while IFS= read -r entry; do
    entry_index=$((entry_index + 1))
    kind="$(jq -r '.kind' <<<"$entry")"
    dest="$(jq -r '.dest' <<<"$entry")"
    required="$(jq -r 'if has("required") then .required else true end' <<<"$entry")"
    validate_relative_path "$dest"
    echo "[$entry_index/$entry_count] $kind -> $dest"

    if [ "$kind" = "version" ]; then
        mkdir -p "$(dirname "$STAGE/$dest")"
        printf '%s' "$VERSION" > "$STAGE/$dest"
        continue
    fi

    src="$(jq -r '.src' <<<"$entry")"
    validate_relative_path "$src"
    source_path="$REPO_ROOT/$src"

    case "$kind" in
        file)
            if [ ! -f "$source_path" ]; then
                if [ "$required" = "true" ]; then
                    echo "Required Android asset file is missing: $source_path" >&2
                    exit 1
                fi
                continue
            fi
            copy_file "$source_path" "$STAGE/$dest"
            ;;
        tree)
            if [ ! -d "$source_path" ]; then
                if [ "$required" = "true" ]; then
                    echo "Required Android asset tree is missing: $source_path" >&2
                    exit 1
                fi
                continue
            fi
            copy_tree "$source_path" "$STAGE/$dest"
            ;;
        glob)
            match_count=0
            while IFS= read -r source_match; do
                [ -f "$source_match" ] || continue
                relative_match="${source_match#"$REPO_ROOT"/}"
                should_include "$relative_match" || continue
                copy_file "$source_match" "$STAGE/$dest/$(basename "$source_match")"
                match_count=$((match_count + 1))
            done < <(compgen -G "$source_path" | sort || true)
            if [ "$match_count" -eq 0 ] && [ "$required" = "true" ]; then
                echo "Required Android asset glob matched no files: $src" >&2
                exit 1
            fi
            ;;
        template)
            if [ ! -f "$source_path" ]; then
                if [ "$required" = "true" ]; then
                    echo "Required Android asset template is missing: $source_path" >&2
                    exit 1
                fi
                continue
            fi
            render_template "$source_path" "$STAGE/$dest" "$entry"
            ;;
        *)
            echo "Unsupported Android asset entry kind: $kind" >&2
            exit 1
            ;;
    esac
done < <(jq -c '.entries[]' "$MANIFEST")

backup="${DEST}.previous.$$"
rm -rf "$backup"
if [ -e "$DEST" ]; then
    mv "$DEST" "$backup"
fi
if mv "$STAGE" "$DEST"; then
    rm -rf "$backup"
else
    rm -rf "$DEST"
    if [ -e "$backup" ]; then
        mv "$backup" "$DEST"
    fi
    exit 1
fi

total="$(du -sh "$DEST" | cut -f1)"
file_count="$(find "$DEST" -type f | wc -l)"
echo
echo "Android asset seed published"
echo "Version: $VERSION"
echo "Files:   $file_count"
echo "Size:    $total"
echo "Target:  $DEST"
