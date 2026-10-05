# Native editor-services worker

Independent internal Rust/PyO3 crate. On this experimental branch Code TE2's
default shellspec launches **`code-te2-worker`** from this crate's release target.
Build it before opening Code TE2. There is no Python-server fallback. The empty
`[workspace]` keeps Cargo separate from `framework/rust`; wheel/bootstrap build
integration is deliberately not implemented yet. Do not publish this branch as
an installed release without that integration.

## Compiled intelligence launch regression

Run with the domain's Python/mypyc toolchain and a new output directory:

```bash
python -B scripts/probe_code_te2_launch_context.py --output "$TMPDIR/te2-launch-probe"
```

If `TMPDIR` is unset, choose a named `.codex-scratch/` directory instead. The
probe compiles the actual adapter/code-server launch dictionaries and repeatedly
evaluates them without launching children, connecting to a framework, or changing
extensions. Build and stress logs remain in the output directory. The Linux
wheel builder runs this gate with its release compiler before domain assembly.

`--embedded-await` is an intentional negative control, restoring the crashing
pre-fix cache lookup inside the dictionary. It can segfault its isolated Python
child; never run that mode inside a live worker. With mypyc 2.3.0, the original
shape reproduces SIGSEGV under both desktop CPython 3.14.4 and private 3.14.6.
Hoisting the await passes 10,000 evaluations per launcher. This is not a substitute
for live extension install/uninstall acceptance of the full compiled runtime.

## Actual Code TE2 worker

Rust owns Hyper HTTP resources, Socketioxide's five existing namespaces, rooms,
Engine.IO lifecycle and framework MessagePack stdin/stdout. A dedicated Python
asyncio thread runs the real `main.py` lifecycle and existing namespace/domain
handlers through PyO3. Framework replies remain independent of socket dispatch.
The worker binds loopback only after application startup, then emits the
`app.readiness` MessagePack notification over its framework stdout pipe, with
`params: {status: "ready", phase: "serving"}`. The manifest declares
`"readiness_support": "pipe"`; the framework rejects HTTP readiness updates for
this mode and never substitutes a shell probe. The pipe's registered app and
current shell identity, not payload identity, authorize the fact. Rebuild both
the framework and this worker before testing; an older framework ignores this
notification and leaves the readiness gate closed. No frontend OTA is needed.
FWS still owns the separate worker; WBA/browser intelligence and
existing FWS child ownership are unchanged.

### Worker-local intelligence shell manager

`shells.rs` uses Ferrous revision `f7ce068` (the native-drawer PTY branch) inside this **independent worker**, not
inside the TE2 server. `native_shells.py` adapts WBA/code-server lifecycle and
binary pipe operations through PyO3. The existing shellspecs, labels, discovery,
code-server output readiness marker and WBA MessagePack handshake remain in use.
Ferrous starts its own parent-dashboard peer from the inherited FWS environment;
the adapter does not construct another peer or a framework HTTP control client.

Each WBA reader has one bounded native read in flight, retained across Python
timeout/cancellation. Releasing it waits for that read to stop. Code-server's
one-shot readiness reader hands stdout to a Rust logs-only drainer, so a full OS
pipe cannot stall it later. `wba_codec.rs` owns bounded concatenated control
records and native encode; Python retains writer serialization, JSON-RPC reply
matching, pushes and domain policy. A decoder belongs to one stdout subscription,
so replacement cannot join partial records from separate shells. Interpreted
tests/tools retain the existing Python codec, never as a native-failure retry.
Persisted records alone never grant live stdin/stdout; the existing adoption
policy replaces inaccessible children. Explicit child
termination uses Ferrous's exact PID-tree shutdown, not process-group killing.
Worker teardown stops its readers/drainers; framework lifecycle still owns tree
cleanup. There is no fallback to Python FWS for these two consumers.

Run profiles and page previews also use this manager: native `output_match`
readiness consumes live pipe bytes with at most 64 KiB retained match context,
honors shellspec deadlines and reaps the exact child on failure. Success hands
stdout to logs-only draining (maximum 64 active drainers), without periodic
whole-log reads. Existing profile reuse/replace, proxy publication and preview
port-conflict policy remain Python-owned. Shell listing is scoped to migrated
Code TE2 labels.

Watchexec uses the binary reader with bounded 64 KiB newline framing in Python,
not an asyncio subprocess handle. Start/stop/replacement serialize; old readers
close before another project starts. JSON-to-workspace-event policy is unchanged.
The drawer also uses this manager with its interactive PTY shellspec. Ferrous
establishes a controlling-terminal session, and resize uses the kernel's
foreground-job notification rather than Python PID/group guesses. A native
drainer flushes each PTY output batch to its raw log before FWS publication.
Close performs exact-tree shutdown, stops the drainer, then removes the owned
exited record/logs and publishes removal. Foreign persisted PTYs are not adopted.

`terminal_log.rs` opens one log descriptor with identity/size from that descriptor
and bounded 64 KiB reads. `terminal_log_io.py` installs this bridge before domain
imports; its interpreted reference reader is for tests/tools, never failure retry.
Pyte remains lazy Python domain code; checkpoint/delta, offsets, reset and resize
semantics remain unchanged. Reads stop at the opened snapshot's size so a growing
producer cannot make a single projection chase EOF indefinitely.

`fws_observer.rs` now owns the outbound FWS observer connection, distinct from
Ferrous's publishing peer. The existing `/fws` JSON/ack protocol stays intact.
`native_fws.py` delivers its structural events to Python domain handlers without
Python Socket.IO/Engine.IO. Native generations, bounded events (256 / 8 MiB tree
budget) and pending calls (16 / ten seconds) prevent stale replies or silently
gapped streams. Overflow disconnects and resynchronizes. Snapshot application
precedes serial notification replay; reconnect restores terminal subscriptions.
The terminal subscription uses `projection: true`, avoiding full historical log
transfer because native raw-log projection already owns history.

A fresh main-module import test blocks socketio, engineio, aiohttp and
framework_shells. This is not proof that every lazy feature import is eliminated;
msgspec, WBA domain DTOs and remaining Python filesystem/HTTP consumers stay in
scope for subsequent work. See CODE_TE2.md, Native FWS Observation, for lifecycle and
underlying-library timeout limits.
Rebuild this worker before live testing; no frontend/APK update is required.

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
emulator. Server namespace helpers are local typed domain adapters, not Python
Socket.IO classes. Python Socket.IO client imports through the FWS client bridge,
msgspec domain validation, JSON conversion and other file I/O remain. No complete
dependency elimination or startup speedup is claimed. HTTP conditional/range
responses and release packaging are not part of this first cutover.

Source framework bootstrap supplies `CODE_TE2_PYTHON_HOME=sys.base_prefix` and
`CODE_TE2_PYTHON_EXECUTABLE=sys.executable`. Before its first Python attachment,
the worker initializes CPython with those explicit `PyConfig.home` and
`program_name` values, selecting the launching interpreter's stdlib and venv.
This does not set global `PYTHONHOME` for terminal/other child processes.
Incomplete selections fail before domain startup. Standalone diagnostic runs
without either selection retain inherited matching-version `VIRTUAL_ENV`
site-packages and editable `.pth` handling. Compile and run with the same regular CPython ABI;
do not supply a free-threaded or different-version venv.

The approved Linux binary packaging target instead owns a private ordinary
CPython 3.14 interpreter/stdlib/dependency closure. It must select that payload
deterministically, reject host Python path/site contamination, and preserve a
separate host executable identity for Node discovery and run-profile children.
Termux initially retains its validated regular system 3.14. Full private payload,
relative ELF linkage and clean-wheel acceptance remain packaging gates; the
source interpreter handoff above is not proof of a self-contained release.

Private manifest schema 2 declares `pythonRuntime.mode="bundled"`, relative
`home`, `executable`, `sourceRoot`, and the embedded `extensionSuffix`.
Bootstrap supplies `CODE_TE2_PYTHON_ISOLATED=1` and
`CODE_TE2_PYTHON_SOURCE` only for that validated payload. The worker disables
environment and site initialization, explicitly selects the private stdlib,
dynload and dependency directory, then loads its declared source/compiled
overlay. It does not import the host package root or process `.pth` files.
`CODE_TE2_HOST_PYTHON_EXECUTABLE` retains launcher identity for child launching
and discovery. These loader contracts are tested; the complete private runtime
materializer and host-independent platform-tag hooks now exist. The complete
manylinux build/repair and clean-wheel acceptance remain pending.

Linux assembly uses `release/linux-wheel/code-te2-runtime-requirements.txt` for
runtime-only dependencies, separate from the mypyc build environment. The
materializer's `--private-python` and `--private-dependencies` inputs are paired:
contained interpreter links become regular files, site customizations/escaping
links are rejected, and lazy helper/application source joins the compiled tree.
The builder requires Rust 1.94+ (pinned Engineioxide MSRV) and OpenSSL development
headers/pkg-config for the independent worker; framework vendored TLS alone is
not sufficient. Post-repair payload hashes and wheel RECORD are regenerated by
`scripts/finalize_code_te2_payload.py`; final ELF/linkage checks must still pass.

The private interpreter's relative-path `DT_NEEDED` entries are normalized to
the bundled libpython SONAME before repair. Auditwheel receives the private
library directory to resolve bundled Tcl/Tk and excludes only
`libpython3.14.so.1.0`: its normal extension-oriented removal rule would break
the standalone embedding executable. The final audit separately requires the
worker to retain that dependency and resolve it to the exact packaged libpython,
then checks every ELF's glibc floor and unresolved libraries. The supplied
interpreter executable can be self-contained; if dynamically linked to libpython,
it must also resolve the packaged copy.
Dependency-owned nested `.dist-info/RECORD` files remain payload data; only the
outer wheel RECORD is regenerated after repair.

Pip can create host-ABI `.pyc` files inside this nested runtime. Schema 2 tolerates
only adjacent `__pycache__` entries associated with inventoried `.py` sources;
source and native-library checksums remain mandatory. Isolated PyConfig disables
bytecode writes and sets `pycache_prefix` to the reserved, absent
`<private-home>/.disabled-bytecode-cache`, so it cannot consume adjacent pip
caches. Files under that reserved prefix still fail the artifact inventory.
The standalone import acceptance probe uses the same prefix and `-B`.

Declared Node vendor roots are published runtime dependencies, not source build
intermediates. Their `node_modules`, `build` and `target` directories must remain
complete; the generic resource exclusions apply only outside those roots.
Installed Linux acceptance imports Socket.IO and the real WBA server entrypoint
with the candidate Node executable (ephemeral loopback port, no shared framework
or live Code Server), separately from compiled-Python import checks.

### Experimental mypyc domain compile probe

This is a **developer-only compiled-domain experiment**, not a release wheel.
Use the matching regular CPython, a C compiler, `mypy==2.3.0` (which
supplies mypyc), and `setuptools==84.0.0`. From the repository root, choose a
new snapshot path under `$TMPDIR` when set, otherwise under `.codex-scratch`:

```bash
MYPYC_OUT="${TMPDIR:-.codex-scratch}/mypyc-snapshots/check-$(date +%Y%m%d-%H%M%S)"
python -B scripts/probe_code_te2_mypyc.py build --output "$MYPYC_OUT"
# Build already validates compiled imports before publishing the snapshot.
# Optional explicit revalidation:
python -B scripts/probe_code_te2_mypyc.py validate --manifest "$MYPYC_OUT/manifest.json" --lib "$MYPYC_OUT/lib"
# Explicit selection only; does NOT restart the worker/framework:
python -B scripts/probe_code_te2_mypyc.py activate --snapshot "$MYPYC_OUT"
```

The build inventories the startup-loaded local modules, compiles one shared
group, and records its interpreted islands in `manifest.json`. It does not copy
extensions into the source tree or change the running TE2 worker. Build output
is a validated runtime snapshot (libraries, manifest, resource symlinks, provenance
and log), not another copy of all generated C/object intermediates. The desktop
preflight compiled and imported 135 modules; compiled-overlay tests exposed
mock-rebinding/native-class differences still to resolve before any runtime
cutover. The matching-ABI Pixel/Termux probe also built and imported all 135
compiled wrappers; that initial probe did not switch the worker. See
`docs/apps/client_runtime_polish/PLAN.md` §6 for evidence and gates.

The native worker now accepts `CODE_TE2_MYPYC_DIR` pointing to a matching
build's manifest/lib directory. The experimental shellspec selects
`.codex-scratch/mypyc-active`; build/validate a snapshot and explicitly select it before starting
the worker, or remove that shellspec environment entry to run interpreted.
There is no automatic build or silent fallback. Startup reports the compiled
module count. The overlay links source-owned resource directories into its lib
layout because compiled modules resolve sibling assets relative to their `.so`.
These development symlinks are not a portable wheel packaging solution.

#### Planned installed artifact placement

The repo-local Cargo executable and `.codex-scratch/mypyc-active` are the current
experimental launch paths, **not the intended installed runtime locations**.
The next packaging/launcher slice must publish a matched Code TE2 artifact set:

- Editable/source installs: the existing resolved Code TE2 cache root,
  `$TE2_CACHE_HOME/code_te2/build` (normally `~/.cache/te2/code_te2/build`).
  Immutable validated artifact sets contain `bin/code-te2-worker`, the compiled
  domain libraries/manifest, and provenance. Build intermediates remain separate;
  the runtime never launches from a mutable Cargo/compiler cache or scratch path.
- Binary wheels: package-owned `app/release_runtime/code_te2/`, with
  `bin/code-te2-worker`, domain libraries and required resources/interpreted islands.
  Resolve paths relative to the installed package, not the checkout. No developer
  symlinks or absolute build-host paths may be required.

The executable remains independent of `te2-server`. Match CPython minor/ABI
(including regular versus free-threaded), architecture, libc and linked libpython,
and verify component checksums/provenance before selecting the artifact set.
The existing framework wheel's `py3-none` tag cannot simply be reused for a wheel
containing ABI-specific mypyc extensions. Preserve separate Rust/domain build
fingerprints so changing Python source does not force a Rust rebuild.

The launcher/bootstrap must resolve the source-cache or verified wheel payload
once and supply its concrete paths to the app shellspec. Binary-install missing
or incompatible artifacts fail explicitly, never silently invoke Cargo or fall
back to interpreted execution. Source build/publish and activation remain explicit
until that workflow is implemented. This section is a plan, not current behavior.

#### Cached build and retention workflow (current developer behavior)

Preferred editable entrypoint (uses the invoking Python/venv; callable from any
working directory):

```bash
python -B app/apps/code_te2/build_mypyc.py
```

Publishes validated mypyc snapshots under the resolved
`TE2_CACHE_HOME/code_te2/build/mypyc-snapshots/` (normally
`~/.cache/te2/code_te2/build/mypyc-snapshots/`). The finished shared objects are in
the snapshot's `lib/`, alongside its manifest/provenance. The existing cached
build helper remains the authority; compiler intermediates stay in its existing
`${TMPDIR:-<repo>/.codex-scratch}/mypyc-build-cache` to retain cache reuse.
Default jobs is `MAX_JOBS`, otherwise one; override with `--jobs N`.
The entrypoint requires `ccache` on PATH and exits with failure before inventory
or compilation if missing. Install it, or explicitly opt into a slower build:
`python -B app/apps/code_te2/build_mypyc.py --no-cache` (equivalently
`NO_CACHE=1 python -B app/apps/code_te2/build_mypyc.py`). These overrides disable
compiler caching for that invocation, including a user-supplied ccache wrapper;
they do not delete the persistent intermediates or existing cached objects.
`--print-commands` resolves everything without changing state; `--no-activate`
publishes without selecting it. Default activation reuses the existing atomic
`.codex-scratch/mypyc-active` selector and preserves its previous selection;
the selector now points outside scratch, to the canonical published snapshot.
No worker restart, Rust rebuild, wheel packaging or resource copying is implied.
Editable resource links still point to this checkout. The planned matched
Rust/domain deployment resolver above remains a separate slice.

Cache existence does not guarantee incremental speedup. A shared group-header
change can invalidate all native C objects; verify unchanged/body-only/signature
edit builds before claiming effective reuse. No cache or release checkpoints are
automatically deleted by this entrypoint.

`build` keeps intermediates under `${TMPDIR:-.codex-scratch}/mypyc-build-cache`.
`--cache-dir` overrides that root. Separate cache generations are keyed by checkout,
CPython ABI/version, compiler/version/flags, mypy/setuptools versions and compiled
module membership; ordinary source-content changes reuse the same generation.
An exclusive writer lock protects the cache. Generated C and objects remain there;
never point `CODE_TE2_MYPYC_DIR` at the mutable cache.

The installed setuptools recompiles a changed shared extension as a whole. When
`ccache` is present, the workflow uses a dedicated **512 MB** compiler cache with
content-based compiler checking; unchanged C/header/flag combinations reuse cached
objects. The low-level probe can still run without ccache, but the preferred local
entrypoint requires explicit opt-out instead of silently accepting that mode.
On Termux, `pkg install ccache` supplies this **development** tool; it is
not a runtime/user-install dependency. Shared generated-header changes can invalidate
many objects. We retain a single shared compilation unit and `multi_file=True`.

Snapshot publication copies only this build's extension libraries (no hard links
to mutable compiler outputs), validates all compiled imports in a separate isolated
process, checks startup-source consistency and atomically publishes only on success.
`artifact.json` records toolchain/source/checksum provenance. Explicit `activate`
checks ABI and snapshot checksums, atomically switches the active symlink and keeps
the former target at `mypyc-active-previous`. Neither action restarts a process;
already-running workers retain old imports until an approved app-worker restart.
Snapshot resource links still refer to editable source, as in the existing probe.

No automatic deletion occurs. For new managed snapshots only:

```bash
python -B scripts/probe_code_te2_mypyc.py prune --root "${TMPDIR:-.codex-scratch}/mypyc-snapshots"
# Inspect the dry run first, then explicitly opt in:
python -B scripts/probe_code_te2_mypyc.py prune --root "${TMPDIR:-.codex-scratch}/mypyc-snapshots" --apply
```

Pruning keeps the newest two snapshots plus active/previous targets. It ignores
symlink aliases, unrecognized legacy directories and `.release` artifacts.
It cannot discover every manually selected/running process's artifact ownership:
do not apply pruning while unrelated workers use older snapshots, or increase
`--keep` appropriately. Toolchain cache generations and legacy experiment folders
are not deleted by this command. Preserve `.release/mypyc-checkpoint-20260929/`.

The opt-in real-compiler regression benchmark is:

```bash
TE2_MYPYC_CACHE_BENCHMARK=1 python -B -m pytest -q -s tests/test_mypyc_build_workflow.py
```

It verifies unchanged-object reuse and changed code behavior using an isolated
two-module shared group. Full worker import/native tests and live acceptance remain
separate checks; fixture timings are not release/startup performance claims.

The 134-module desktop group passes all 20 isolated native-worker tests,
including History and terminal over polling and WebSocket. `pipe_dto` remains
interpreted because its msgspec Struct annotations fail runtime validation when
compiled; msgspec consumers remain compiled. Distinct exception bindings in the
editor RPC coroutine avoid a compiled error-path type mismatch. Live acceptance
remains a separate gate; the matching Pixel group also passed all 20 isolated
native-worker tests.

### Framework bootstrap-managed native executable (source installs)

Normal `te2` startup and `te2 --build-only` now prepare the workers listed in
`app/native_worker_builds.json`. Each entry declares an app ID, framework-relative
Cargo manifest, binary name, environment key and whether Python ABI participates
in its build identity. The initial entry is Code TE2; do not add arbitrary launch
commands to this registry.

The Code TE2 executable publishes atomically under
`$TE2_CACHE_HOME/code_te2/build/bin/<fingerprint>/<release|debug>/code-te2-worker`.
Intermediates remain in `code_te2/build/cargo-target`. A per-app lock and the
existing framework publication/pruning helpers protect the final cache; mypyc
snapshots and checkpoints are not pruned. Rust source/lockfile, profile, platform,
compiler identity/flags and invoking Python ABI determine reuse. `--force-build`
also rebuilds configured workers. `--print-command` resolves paths without build
or publication. Worker builds use `--locked` and the invoking `sys.executable`
as `PYO3_PYTHON`, independently of the server's Cargo target cache.

Bootstrap exports `CODE_TE2_WORKER_BIN` to the framework process. The app shellspec
launches this exact raw executable directly with the existing project/port args;
there is no pipe-facing Python bootstrap wrapper. This requires a newly launched
framework to ingest the resolved environment; an app-worker restart under an old
framework cannot manufacture the new environment key.

The Rust launcher renders shellspecs from the complete inherited server
environment, then applies the authoritative Ferrous overlay and app launch
overrides in that order. Ferrous's child overlay alone is not a complete
environment: using it alone drops `CODE_TE2_WORKER_BIN` before command rendering
and prevents spawning on both desktop and Termux. Launcher regression coverage
renders the actual Code TE2 shellspec and checks the raw executable and inherited
`PYTHONPATH`. Spawn failures log the full cause chain. Changes to this handoff
require rebuilding the framework server, not only the worker.

Mypyc compilation/activation is still explicit through `build_mypyc.py`; this
slice does not build it automatically or replace its selected domain overlay.
Source installs include the independent worker's Cargo manifest/lockfile/source.
Binary release wheels still require matched executable/domain/resources and ABI
tagging: the new source-build path refuses to compile a worker as a fallback for
a binary release lacking integrated worker payloads. No integrated release is
claimed, and wheel assembly remains the next gate.

### Pixel source build and live test

From `~/mrselect6`, after pulling this branch:

```bash
te2 --build-only
```

Use the regular system Python environment (or matching `.jitenv`) for bootstrap.
Then, only when approved, launch the framework anew so it receives the published
`CODE_TE2_WORKER_BIN`; Code TE2 launches through the normal app lifecycle.
The manual Cargo command remains available for isolated worker test builds, but
its target output is no longer the app shellspec's runtime path. Do not run the
fixture executable below as the app. No frontend assets changed. The native
listener cutover at `8e46ae91` has
user-confirmed Pixel live acceptance. The subsequent codec slice needs its own
live check; acceptance of the listener does not establish its performance.

### Persistence byte boundary

Before domain initialization, the native worker installs PyO3 byte reads and
atomic writes for `persistence_io.py` (preferences, extension registry and
intelligence state). Blocking filesystem calls release interpreter attachment;
this preserves synchronous completion and does not make a domain-loop call async.
Python retains JSON formatting/validation, locks, defaults and corruption policy.
Fixed temporary files retain normal creation/existing permissions; unique files
are private (0600). Writers close before rename, clean temporary files, and add
neither directory creation nor fsync. OS errors retain exception class and errno.
Interpreted tools/tests retain the reference Python byte implementation; an
installed native backend never retries failed operations through that reference.
Other filesystem users, flock and WBA/FWS I/O are not migrated by this slice.

### Frontend RPC codec boundary

Python lists and tuples both become MessagePack arrays at the structural PyO3
boundary. This preserves the former codec behavior for dataclass projections
such as History refs, commit parents and file pages; arbitrary iterators and
sets remain rejected. Incoming MessagePack arrays become Python lists.

`rpc_codec.rs` owns application MessagePack for `/rpc/editor`, `/rpc/explorer`
and `/ui_ipc`. Incoming `rpc` must carry binary bytes containing exactly one
bounded value; Rust decodes before entering Python. Python receives DTOs and
keeps JSON-RPC validation/dispatch. Replies and notifications cross back as DTOs;
Rust encodes once before room fan-out. Editor replies remain `rpc` events;
Explorer/host replies remain acknowledgements and their pushes `rpc.notify`.
`None`/no-reply behavior is unchanged. No Python fallback codec is installed.

Bad bytes/nonbinary requests receive the existing `-32700` error envelopes and
do not tear down an otherwise healthy connection. Invalid decoded envelopes
remain Python `-32600` validation. The native decoder bounds depth to 64, nodes
to 1,000,000 and payloads to 8 MiB; DTO maps require unique UTF-8 string keys.
Extension markers, trailing frames and reserved markers are rejected. These are
transport validity checks, not domain normalization. Sidebar's structured RPC,
terminal events and direct WBA traffic are unchanged. The separate WBA control
pipe uses `wba_codec.rs` as described above.

`CODE_TE2_RPC_CODEC_METRICS=1` now reports native codec duration/byte metadata to
stderr, never framework stdout. Disabled metrics take no timestamps. Explorer
diagnostics emission timing no longer pretends its Python emit time is encoding
time; actual encoding lives in the native codec metrics.

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
