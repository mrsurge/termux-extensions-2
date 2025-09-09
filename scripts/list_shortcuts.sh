#!/data/data/com.termux/files/usr/bin/bash
#
# termux-extensions v2 - List Shortcuts Script
#
# Outputs a JSON array of available shortcuts in ~/.shortcuts.

set -eu

SHORTCUTS_DIR="$HOME/.shortcuts"

if [ ! -d "$SHORTCUTS_DIR" ]; then
  echo "[]"
  exit 0
fi

first=true
echo "["

# Find all executable files in the shortcuts directory.
find "$SHORTCUTS_DIR" -type f -executable | while read -r shortcut_path; do
  shortcut_name=$(basename "$shortcut_path")

  if [ "$first" = true ]; then first=false; else echo ","; fi

  # JSON escaping function
  json_escape () {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's_/_\\/_g'
  }

  # Escape all string values before printing
  name_esc=$(json_escape "$shortcut_name")
  path_esc=$(json_escape "$shortcut_path")

  # Print the shortcut details as a compact JSON object
  printf '{"name":"%s","path":"%s"}' "$name_esc" "$path_esc"

done

echo
echo "]"
