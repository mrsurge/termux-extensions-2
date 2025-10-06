#!/data/data/com.termux/files/usr/bin/bash

set -eu

TARGET_DIR=${1:-"$HOME"}
SHOW_HIDDEN=${2:-0}

# Ensure the target is a valid, accessible directory
if [ ! -d "$TARGET_DIR" ]; then
    echo '{"error": "Invalid or inaccessible directory"}' >&2
    exit 1
fi

shopt -s nullglob
case "$SHOW_HIDDEN" in
    1|true|TRUE|yes|YES|on|ON|--hidden|--show-hidden)
        shopt -s dotglob
        ;;
    *)
        shopt -u dotglob
        ;;
esac

first=true

# JSON escaping function
json_escape () {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's_/_\/_g' -e 's/\n/\\n/g'
}

# Begin JSON array
echo "["

# Process directories first, then files
for item in "$TARGET_DIR"/*/; do
    if [ -d "$item" ]; then
        if [ "$first" = false ]; then echo ","; fi
        first=false
        basename=$(basename "$item")
        trimmed="${item%/}"
        printf '{"name": "%s", "type": "directory", "path": "%s"}' "$(json_escape "$basename")" "$(json_escape "$trimmed")"
    fi
done

for item in "$TARGET_DIR"/*; do
    if [ -f "$item" ]; then
        if [ "$first" = false ]; then echo ","; fi
        first=false
        basename=$(basename "$item")
        printf '{"name": "%s", "type": "file", "path": "%s"}' "$(json_escape "$basename")" "$(json_escape "$item")"
    fi
done

# End JSON array
echo
echo "]"
