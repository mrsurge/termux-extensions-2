# Native editor-services worker prototype

Independent internal Rust/PyO3 executable. **Not a production Code TE2 worker**:
it does not replace the app manifest, bootstrap, FWS manager, HTTP/Socket.IO
server, WBA, or the release build. Its empty `[workspace]` keeps Cargo separate
from `framework/rust`. Do not add it to production launch paths yet.

## What runs

Native stdin reader -> bounded application mailbox -> one Python service owner
-> native response writer. Replies to Python-origin calls bypass the application
mailbox so a blocked service can make a nested framework request. PyO3 releases
interpreter attachment while awaiting that reply. No Python callbacks execute
under a native pending-request lock.

The Python service exports a synchronous function:

```python
def te2_native_dispatch(envelope: dict, bridge):
    return bridge.call("service.method", envelope.get("params"), timeout=5.0)
```

Its return value becomes the response result; notifications invoke the same
function but send no response. Arguments/results are converted directly through
PyO3: no Python JSON/MessagePack codec. Supported values are null, bool, signed/
unsigned 64-bit integers, floats, UTF-8 strings, bytes, lists and string-keyed
maps. Class instances, tuples, sets, extension values and cyclic/deep values are
not service DTOs. No asynchronous service coroutine execution is implemented.

The pipe uses concatenated MessagePack maps with existing TE2 identity/correlation
field names. Native metadata validation is bounded but is **not yet a drop-in
replacement for every msgspec validation/error message**. Duplicate/non-string
map keys and extension markers are rejected; reserved markers and incomplete EOF
are fatal. Complete maps with invalid envelope metadata receive an error and do
not desynchronize later frames. Production schema/error parity is a later gate.

Python stdout is redirected to stderr before importing the service. This is a
trusted internal service boundary, not a sandbox: service code must not write
directly to fd 1, spawn uncontrolled threads, or treat arbitrary inputs as safe.
The prototype intentionally rejects `runtime.debug.*`; it does not expose eval.

## Bounds and shutdown

- 32 MiB maximum encoded frame; depth 64 and 1,000,000 node decode budget.
  Lengths are checked before payload/container allocation. Decoder consumes each
  frame once without retrying the entire prefix on each input chunk.
- 64 queued application items, plus one active dispatch; 64 MiB encoded-byte
  accounting covers queued and active items. Independent output and pending-reply
  byte budgets are each 64 MiB. At most 64 pending outbound calls.
- These are not total RSS caps. Decoded values, temporary conversions and trusted
  Python service allocations have additional memory costs.
- New application requests that exceed admission get `pipe.overloaded`. A
  notification admission failure closes the session instead of dropping a fact.
  Reply-path/output failure also fails the session. No automatic replay/retry.
- Nested-call timeouts are bounded (0 < timeout <= 300 seconds); duplicate/late
  replies cannot satisfy another call. Optional reply target identity is checked.
- Clean EOF fails nested waiters, drains accepted ordinary requests/replies, then
  stops the writer. Corruption fails the transport. A three-second post-EOF/error
  watchdog exits this isolated process if a Python handler or stdout is stuck.
  It is not a safe interpreter-cancellation API or production shutdown policy.
- Explicit writer closure does not depend on Python releasing its last bridge
  reference. CPython is process-owned; no in-process reinitialization/finalization
  cycle or graceful arbitrary Python background-task shutdown is promised.

## Build and validate from the repository root

Select the actual system CPython, not the free-threaded development venv. Linux
validation used `/usr/bin/python3` (3.14.4) and shared `libpython3.14.so.1.0`.
PyO3 is pinned to 0.28.3; `Cargo.lock` is committed source. Build output stays under
this crate's ignored `target/`, separate from the framework cache.

```bash
env -u PYTHONPATH PYO3_PYTHON=/usr/bin/python3 cargo test --locked --manifest-path framework/native_editor_worker/Cargo.toml
env -u PYTHONPATH PYO3_PYTHON=/usr/bin/python3 cargo build --release --locked --manifest-path framework/native_editor_worker/Cargo.toml
```

Run tests as their own command. The **test runner** needs pytest and msgpack;
the embedded fixture service needs only system Python. It never launches TE2.

```bash
env -u PYTHONPATH TE2_NATIVE_WORKER_BIN="$PWD/framework/native_editor_worker/target/release/te2-native-editor-worker" .venv/bin/python -m pytest -q framework/native_editor_worker/tests/test_worker.py
```

On the Pixel after the approved commit/pull, use `PYO3_PYTHON="$PREFIX/bin/python"`
for Cargo, and the system Python with pytest/msgpack to run tests. Do not borrow
native modules from a different-ABI venv through PYTHONPATH. Android/Termux
embedding/linker compatibility remains **unvalidated** until that device build.
The executable links to libpython; the ~939 KiB Linux optimized binary is not a
self-contained distribution of Python or Code TE2.

Local evidence: 4 Rust unit tests, 16 subprocess tests, and 75 surrounding Python
pipe/worker/debug tests passed (91 Python tests together). Cargo fmt passes;
clippy was unavailable in the installed toolchain. No startup speedup claimed.

## Next gate

Compile/test on the Pixel before connecting real editor services. Then implement
the Python application-loop adapter and worker-local Axum/Socketioxide lane,
preserving domain ownership and the direct browser/WBA connection. Real FWS
launch integration and existing-child adoption need their own ownership review.
See `docs/apps/client_runtime_polish/NATIVE_WORKER_HANDOFF.md`.
