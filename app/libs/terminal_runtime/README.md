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
`terminal_log_io.py`. File Explorer has no shell adapter/drawer yet: its Python app
worker cannot borrow Code TE2's embedded native manager by importing it.

The interpreted test reader remains in Code TE2's adapter, not this shared core.
For an isolated compiled proof (no activation or process restart):

```bash
python -B scripts/probe_terminal_projection_mypyc.py \
  --output "${TMPDIR:-.codex-scratch}/shared-terminal-projection-proof"
```

Choose a fresh output directory. The proof compiles the core/parser/native-log
adapter together and exercises shared-reader isolation plus the retained checkpoint
regressions. It is not a full worker-domain build or a release artifact.
