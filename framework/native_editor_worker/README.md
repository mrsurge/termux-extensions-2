# Native editor-services worker

Independent internal Rust/PyO3 crate. On this experimental branch Code TE2's
default shellspec launches **`code-te2-worker`** from this crate's release target.
Build it before opening Code TE2. There is no Python-server fallback. The empty
`[workspace]` keeps Cargo separate from `framework/rust`; wheel/bootstrap build
integration is deliberately not implemented yet. Do not publish this branch as
an installed release without that integration.

## Actual Code TE2 worker

Rust owns Hyper HTTP resources, Socketioxide's five existing namespaces, rooms,
Engine.IO lifecycle and framework MessagePack stdin/stdout. A dedicated Python
asyncio thread runs the real `main.py` lifecycle and existing namespace/domain
handlers through PyO3. Framework replies remain independent of socket dispatch.
The worker binds loopback only after application startup, then posts serving
readiness. FWS still owns the separate worker; WBA/browser intelligence and
existing FWS child ownership are unchanged.

The common Engine.IO parser remains in use: application RPC payloads are binary
`msgpack-v1`, not Socket.IO's optional MessagePack packet parser. Cargo.lock pins
Engineioxide 0.17.7: 0.17.3's waiting-poll encoder concatenated binary packet
batches without separators. Repeated real polling RPC tests cover that path.

There are 64 concurrent application calls and 16 control calls, with a 120-second
domain-future deadline. Pipe frames retain the 32 MiB cap, 64-item queue and
64 MiB queued/active output budget. Socket buffers are bounded; these limits are
not total RSS caps. Disconnect cleanup uses the existing domain handlers; no
disconnected-event replay or mutation retry is introduced.

The adapter preserves Python domain state and validation, not a general ASGI
emulator. Python Socket.IO namespace/client imports, the FWS client bridge,
frontend MessagePack codecs, persistence and other file I/O remain. No complete
dependency elimination or startup speedup is claimed. HTTP conditional/range
responses and release packaging are not part of this first cutover.

Embedded Python loads the inherited matching-version `VIRTUAL_ENV` site-packages
and editable `.pth` files. Compile and run with the same regular CPython ABI;
do not supply a free-threaded or different-version venv.

### Pixel build and live test

From `~/mrselect6`, after pulling this branch:

```bash
PYO3_PYTHON=/data/data/com.termux/files/usr/bin/python cargo build --release --locked --manifest-path framework/native_editor_worker/Cargo.toml
```

Then launch/restart Code TE2 through its normal framework app lifecycle with the
system Python environment (or its matching `.jitenv`). The shellspec selects
`target/release/code-te2-worker`; do not run the fixture executable below as the
app. No frontend assets changed in this slice. Live Pixel acceptance is pending.

The isolated integration suite uses temporary stores, a fake framework pipe peer
and disabled managed intelligence, not the shared runtime. It requires the
repository `.jitenv` with the normal app dependencies plus pytest, msgpack,
requests and websocket-client:

```bash
env -u PYTHONPATH .jitenv/bin/python -m pytest -q framework/native_editor_worker/tests/test_code_te2.py tests/test_code_te2_socketio_polling.py
```

## Retained pipe-only fixture executable

The separate `te2-native-editor-worker` executable below remains the bounded
transport test harness, not the actual application entrypoint.

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
env -u PYTHONPATH TE2_NATIVE_WORKER_BIN="$PWD/framework/native_editor_worker/target/release/te2-native-editor-worker" .jitenv/bin/python -m pytest -q framework/native_editor_worker/tests/test_worker.py
```

On the Pixel after the approved commit/pull, use `PYO3_PYTHON="$PREFIX/bin/python"`
for Cargo, and the system Python with pytest/msgpack to run tests. Do not borrow
native modules from a different-ABI venv through PYTHONPATH. The Pixel build using
`/data/data/com.termux/files/usr/bin/python` succeeded and ran 15/16 initial
subprocess tests. Its truncated-EOF test exposed a reader shutdown ordering race,
not an interpreter mismatch. The correction retains the queue sender until
terminal status/pending cleanup are published, with deterministic and repeated
regression coverage. The user waived Pixel retesting of that correction; this is
not recorded as an observed Pixel pass.
The executable links to libpython; the ~939 KiB Linux optimized binary is not a
self-contained distribution of Python or Code TE2.

Current local correction: 5 Rust unit tests and 17 subprocess tests pass using
the system-Python `.jitenv` runner, including 30 truncated-EOF process launches.
The original slice also passed 75 surrounding Python pipe/worker/debug tests.
Cargo fmt passes;
clippy was unavailable in the installed toolchain. No startup speedup claimed.

## Next gate

Live-test the actual branch-default worker on Pixel, especially document/draft
state, intelligence, sidebar, terminal, reconnect and clean shutdown. Keep the
remaining Python imports visible and measure startup before further removal.
See `docs/apps/client_runtime_polish/NATIVE_WORKER_HANDOFF.md`.
