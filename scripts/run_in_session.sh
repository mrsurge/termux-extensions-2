#!/data/data/com.termux/files/usr/bin/bash
#
# termux-extensions v2 - Run in Session Script
#
# Usage: ./run_in_session.sh <sid> "<command>"

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <sid> \"<command>\"" >&2
  exit 1
fi

SID="$1"
CMD="$2"

META_FILE="$HOME/.cache/te/$SID/meta"

if [ ! -f "$META_FILE" ]; then
  echo "Error: Session $SID not found." >&2
  exit 1
fi

# Source the meta file to get the socket path.
SOCK=""
. "$META_FILE"

if [ -z "$SOCK" ]; then
  echo "Error: Session $SID is not attached via dtach." >&2
  exit 1
fi

# Check if dtach is available.
if ! command -v dtach >/dev/null 2>&1; then
  echo "Error: dtach is not installed." >&2
  exit 1
fi

# Inject the command into the dtach socket.
# The command must be followed by a newline to be executed.
printf '%s\n' "$CMD" | dtach -p "$SOCK"

exit 0
