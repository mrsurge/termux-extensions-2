#!/data/data/com.termux/files/usr/bin/bash
#
# termux-extensions v2 - List Sessions Script
#
# Outputs a JSON array of active and interactive Termux sessions.

set -eu

CACHE_DIR="$HOME/.cache/te"

# Check if the base directory exists. If not, there are no sessions.
if [ ! -d "$CACHE_DIR" ]; then
  echo "[]"
  exit 0
fi

first=true
echo "["

# Find all session directories.
find "$CACHE_DIR" -mindepth 1 -maxdepth 1 -type d | while read -r session_dir;
do
  meta_file="$session_dir/meta"

  if [ ! -f "$meta_file" ]; then continue; fi

  CWD=""; SID=""; SESSION_TYPE=""; SOCK=""
  . "$meta_file"

  if [ "$SESSION_TYPE" != "interactive" ]; then continue; fi
  if ! ps -p "$SID" > /dev/null; then
    rm -rf "$session_dir"
    continue
  fi

  if [ "$first" = true ]; then first=false; else echo ","; fi

  # JSON escaping function
  json_escape () {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's_/_\/_g' -e 's/\n/\\n/g'
  }

  # Escape all string values before printing
  sid_esc=$(json_escape "$SID")
  cwd_esc=$(json_escape "$CWD")
  sock_esc=$(json_escape "$SOCK")

  # Print the session details as a compact JSON object
  printf '{"sid":"%s","cwd":"%s","sock":"%s"}' "$sid_esc" "$cwd_esc" "$sock_esc"

done

echo

echo "]"

