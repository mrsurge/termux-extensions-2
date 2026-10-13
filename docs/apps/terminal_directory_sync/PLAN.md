# File Explorer terminal directory-sync maintenance

## Goal and approved scope

Fix an idle, empty File Explorer terminal waiting for another command before
following navigation. Keep the correction in its existing directory broker;
do not modify standalone Terminal, Code TE2's drawer, Android, or the framework.
No new transport, Readline hook, or compiled component. Preserve busy/partial
input protection, prompt refresh, FIFO input ordering, and unknown-edit safety.

## Evidence

Live inspection found Bash idle with a pending `prompt`-mode directory request.
The PTY output shows typing followed by erasure back to an empty prompt. The
broker marks every input dirty and only clears after submission plus an idle
event, so deleted input stays dirty. No live input or signal was sent.

## Implementation and validation

1. Track only known ordinary ASCII input length, not command contents.
2. Backspace/DEL decrement known length; ordinary Ctrl-U clears a known line.
   Cursor/history/completion/custom or non-ASCII editing remains unknown and
   conservative until a fresh submitted/cancelled prompt.
3. Resume a pending directory wake when known input becomes empty. Write the
   erasure to the PTY first; hold later input using the existing wake fence.
4. Reuse the existing signal, shell idle check, result and prompt-refresh path.
5. Test deleting before navigation, clearing during a pending request, genuine
   partial input, unknown edits, late idle events, busy builtins/children and
   Starship. Tests use disposable PTYs and isolated HOME.
6. Source checks precede separately approved live activation. No framework
   restart, release/tag/upload, or live-terminal replacement in this scope.
