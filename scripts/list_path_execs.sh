#!/data/data/com.termux/files/usr/bin/bash

set -eu

# This script lists all unique executable files found in the directories
# listed in the PATH environment variable. It outputs a JSON array.

first=true
declare -A seen # Use an associative array to track unique basenames

# Start JSON output
echo "["

# Read PATH into an array, splitting by colon
IFS=':' read -r -a path_dirs <<< "$PATH"

for dir in "${path_dirs[@]}"; do
    # Skip non-existent or non-readable directories
    [ -d "$dir" ] && [ -r "$dir" ] || continue

    for item in "$dir"/*; do
        basename=$(basename "$item")
        # Check if it's a file, is executable, and we haven't seen it before
        if [ -f "$item" ] && [ -x "$item" ] && [ -z "${seen[$basename]+_}" ]; then
            seen[$basename]=1 # Mark as seen

            if [ "$first" = false ]; then echo ","; fi
            first=false

            # JSON escaping
            name_esc=$(printf '%s' "$basename" | sed 's/"/\"/g')
            path_esc=$(printf '%s' "$item" | sed -e 's/\\/\\\\/g' -e 's/"/\"/g' -e 's_/_\/_g')

            printf '{"name": "%s", "path": "%s"}' "$name_esc" "$path_esc"
        fi
    done
done

echo
echo "]"
