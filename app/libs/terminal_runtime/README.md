# Shared terminal projection

`screen_projection.py` contains the existing Pyte screen/checkpoint/delta algorithm,
not shell launch, input, sockets, project state or tab ownership. The parser in
`pyte_parser.py` stays demand-loaded on first projection use.

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
