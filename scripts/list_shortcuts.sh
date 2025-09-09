#!/data/data/com.termux/files/usr/bin/bash
#
# termux-extensions v2 - List Shortcuts Script
#
# Outputs a JSON array of available shortcuts in ~/.shortcuts.

set -euo pipefail

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

  # Add a comma before each entry except the first one.
  if [ "$first" = true ]; then
    first=false
  else
    echo ","
  fi

  # JSON escaping function
  json_escape () {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
  }

  # Print the shortcut details as a JSON object.
  printf '  {
'
  printf '    "name": "%s",
' "$(json_escape "$shortcut_name")"
  printf '    "path": "%s"
' "$(json_escape "$shortcut_path")"
  printf '  }'
done

echo "\n]"
