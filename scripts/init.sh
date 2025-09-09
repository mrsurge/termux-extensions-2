#!/data/data/com.termux/files/usr/bin/bash
#
# termux-extensions v2 - Session Attach Script (v2)
#

# This function contains the core logic for setting up the session metadata.
# It will be called after the shell is confirmed to be inside a dtach session.
setup_session_metadata() {
    # If TE_SID is already set, it means we've already run setup. Do nothing.
    if [ -n "${TE_SID:-}" ]; then return 0; fi

    export TE_SID="${BASHPID:-$}"
    export TE_SESSION_TYPE="${TE_SESSION_TYPE:-interactive}"
    export TE_DIR="$HOME/.cache/te/$TE_SID"
    mkdir -p "$TE_DIR"

    # Function to write metadata to the file.
    write_meta() {
      {
        printf 'CWD="%s"\n' "$(pwd)"
        printf 'SID="%s"\n' "$TE_SID"
        printf 'SESSION_TYPE="%s"\n' "$TE_SESSION_TYPE"
        [ -n "${TE_SOCK:-}" ] && printf 'SOCK="%s"\n' "$TE_SOCK"
      } > "$TE_DIR/meta"
    }
    write_meta

    # Define a cleanup function to be called on exit.
    cleanup() {
        rm -rf "$TE_DIR" 2>/dev/null
    }

    # Set the prompt command to keep the CWD updated.
    PROMPT_COMMAND="write_meta;${PROMPT_COMMAND:-}"

    # Set a trap to call the cleanup function on shell exit.
    trap cleanup EXIT
}


# --- Main Execution Logic ---

# 1. Only run for interactive shells.
case $- in
  *i*) ;; # Continue if interactive
  *) return 0 2>/dev/null || exit 0 ;; 
esac

# 2. If not already inside dtach, re-execute the shell inside dtach.
if [ "${TE_DTACH:-0}" != "1" ] && command -v dtach >/dev/null 2>&1; then
  run_base="${XDG_RUNTIME_DIR:-$HOME/.local/run}/te"
  mkdir -p "$run_base"
  sock="$run_base/$PPID-$-$RANDOM.sock"

  # Set environment variables for the new shell to inherit.
  export TE_DTACH=1
  export TE_SOCK="$sock"

  # This is the key change. We use --rcfile to force the new shell
  # to source this script *before* becoming interactive. This ensures
  # the setup logic below is executed by the new dtach-managed shell.
  # BASH_SOURCE[0] refers to this script's own path.
  exec dtach -A "$sock" bash --rcfile "${BASH_SOURCE[0]}"
fi

# 3. If we are here, we are inside the dtach-managed shell.
#    (Or dtach wasn't found). Run the setup function.
setup_session_metadata
