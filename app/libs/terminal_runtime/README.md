# Shared terminal projection

`screen_projection.py` contains the existing Pyte screen/checkpoint/delta algorithm,
not shell launch, input, sockets, project state or tab ownership. The parser in
`pyte_parser.py` stays demand-loaded on first projection use.

Checkpoints restore a curated terminal mode set as well as screen cells: mouse
protocol/encoding, bracketed paste, application cursor keys, alternate-buffer
selection and origin/scroll region. Disable stale mouse modes before enabling
selected modes: xterm shares protocol state and an unrelated later reset can
disable the restored protocol. This is parsed-state reconstruction, not arbitrary
escape-sequence replay. Alternate-screen checkpoints omit normal scrollback.

`terminal_cursor.ts` repairs xterm DOM block cursor precedence after rendering:
remove inline cell foreground/background from cursor spans so xterm's generated
theme/OSC cursor rules remain visible on RGB application backgrounds. It owns no
input, resizing, shell state or inactive cursor styling.

`terminal_shift.ts` handles printable mobile IME Shift text without altering
escape/control sequences. `terminal_shift_button.ts` owns pointer/long-press
timing only: each app retains its own modifier/session state. Single-tap arms
Shift, double-tap or 500ms hold locks it; tapping a locked key releases it.
Lifecycle transitions cancel pending holds. Code TE2 drawer Sel is a sticky
Shift modifier forwarded to the terminal app (including navigation keys), not
a local-buffer selection interception; the application owns selection behavior.

Each `TerminalScreenProjectionRegistry` requires a `log_opener` that returns a
context-managed `LogReader`. That application-owned boundary supplies file identity,
captured size and bounded byte reads. Readers are closed before return; failures
propagate, with no filesystem/native fallback selected by the shared core. Registry
state, capacity and locks are instance-local; identical shell IDs in different
registries do not share state or readers.

Code TE2's `terminal_screen_projection.py` is the thin native-log adapter and owns
its existing singleton. Its native bridge configuration remains in Code TE2's
`terminal_log_io.py`. File Explorer's ordinary Python worker owns a separate
Node PTY worker/pipe adapter and supplies its app-owned `terminal_projection.py`
log opener to an independent registry, bounded at an acknowledged byte offset.
It does not borrow Code TE2's embedded native manager or another app's shellspec.
See `app/apps/file_explorer/TERMINAL.md` for its control/output/lifetime contract.

The interpreted test reader remains in Code TE2's adapter, not this shared core.
For an isolated compiled proof (no activation or process restart):

```bash
python -B scripts/probe_terminal_projection_mypyc.py \
  --output "${TMPDIR:-.codex-scratch}/shared-terminal-projection-proof"
```

Choose a fresh output directory. The proof compiles the core/parser/native-log
adapter together and exercises shared-reader isolation plus the retained checkpoint
regressions. It is not a full worker-domain build or a release artifact.
