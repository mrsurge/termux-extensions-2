# Native editor-services worker

Independent Rust/PyO3 crate. Code TE2's shellspec launches the raw
**`CODE_TE2_WORKER_BIN`** selected by framework bootstrap. Source startup builds
or reuses the fingerprinted native executable; packaged startup validates its
matched worker/domain/runtime payload. There is no Python-server fallback or
Cargo fallback for a missing binary-release payload. The empty `[workspace]`
keeps Cargo separate from `framework/rust`. Direct crate-target builds below are
diagnostic tooling, not the default launch-path authority. Domain compilation/
activation remains explicit for source installs; release tooling owns packaged
assembly and target acceptance.

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

Native namespace emission accepts `skipSid` as null/absent, one string, or a list
of exact SID strings. Validate the complete list before fan-out; never ignore a
list as though no exclusion was supplied. Namespace and room membership still
gate recipients. Python transport protocols and the native filter must agree;
annotations alone cannot establish delivery semantics. The 2026-10-21 correction
requires a matching worker build before live list-exclusion acceptance; see
`docs/apps/release_0_2_356/TYPING_AUDIT.md`.

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

WBA push intake only re-encodes decoded payloads for telemetry size when
`CODE_TE2_DIAGNOSTICS_LATENCY_METRICS` is enabled. With the existing metrics
owner disabled, payload_bytes is zero and no counting encode crosses PyO3.
This field is diagnostics accounting, not a queue-admission byte budget; actual
wire decode limits and push ordering/coalescing remain unchanged. Enabled mode
retains exact serialized payload lengths. This Python-domain change requires
matching interpreted imports or a new activated mypyc snapshot/worker refresh,
not a rebuilt native executable or frontend publication. Broader object-graph/
buffer changes remain separately qualified under release_0_2_356 O2.

The isolated Cargo example `boundary_probe` compares current graph conversion
with guarded serialized buffers without production activation. Run recipes,
compiled/interpreted measurements and acceptance differences are recorded in
`docs/apps/release_0_2_356/BOUNDARY_PROBE.md`. Optional
`BOUNDARY_PROBE_MYPYC_DIR` affects only that probe's import overlay. Successful
probe exit includes an explicitly asserted/reported set-acceptance mismatch;
it is not proof that the candidate can replace production conversion.

Framework-pipe ingress now retains one original bounded frame while applying the
unchanged native decoder, then calls `native_worker.control_bytes` with one
PyBytes instead of recursively constructing Python values through PyO3. Cached
typed msgspec decoding feeds the existing synchronous inbound router. Native
corruption closes the stream; schema-invalid envelopes retain the old precise
error reply through validation-only conversion and processing continues. That
error-only conversion never dispatches/retries a request. Outbound, WBA codecs,
socket paths and admission/ordering remain unchanged. The validation graph still
exists transiently and original bytes are copied; this is not zero-copy.

New native workers check the callable bytes entrypoint before domain startup;
stale compiled snapshots fail with rebuild/reactivation guidance, not a fallback.
Prepare matching native/domain artifacts before an approved worker refresh.
Retained `control(object)` supports older native callers, not automatic new-worker
fallback. External framework wire compatibility is unchanged. Real isolated
dispatch and capture-inclusive trade-offs are in the follow-on section of
`docs/apps/release_0_2_356/BOUNDARY_PROBE.md`: search/Git fixtures improve locally,
binary-heavy fixtures regress. Live adoption remains separately gated.

WBA control ingress now has the analogous original-frame handoff: the existing
subscription-local framer validates/retains bytes and `wba_stream.rs` exposes
`feed_frames`; Python's typed adapter msgspec-decodes before the unchanged stdout
consumer. Native graph `feed` remains for older callers/probe comparison, not a
fallback for a missing new entrypoint. Configured native streams lacking
feed_frames fail with rebuild guidance. Partial/EOF/batch-error/owner semantics,
outbound encoding and direct WBA browser sockets are unchanged. This is not a
new transport, zero-copy path or incremental-parser rewrite. Matching worker and
Python/mypyc adoption is required, not frontend OTA/Node rebuilding. Surface audit,
actual-PyO3 probe, binary-heavy regression caveat and network
RPC seam are in `docs/apps/release_0_2_356/INGRESS_AUDIT.md`.

The three frontend RPC request lanes now retain original guarded body bytes too:
only `rpc` on `/rpc/editor`, `/rpc/explorer` and `/ui_ipc` uses `ValidatedRpc` plus
native-owned SocketRef namespace/SID/event. `rpc_ingress.rs` passes these to
`native_worker.submit_rpc`; cached msgspec decode feeds the same namespace adapter
on its existing domain loop. The old wrapper's depth/node budget is retained by
a borrowed native graph walk, without constructing its Python object graph.
Parse versus backend errors, native admission, 120-second Future wait/cancel,
ACK encoding/disconnect handling and outbound paths stay unchanged. Lifecycle,
other socket events, HTTP helpers and direct WBA streams do not migrate.

The direct-delivery follow-up keeps that Rust/PyO3 contract intact: after the
existing context guard/decode, Python calls NativeSocketServer.deliver_rpc with
typed namespace/SID/data, without constructing a temporary context dictionary.
It still uses the registered namespace's trigger_event; general lifecycle
delivery is unchanged. This follow-up needs matching Python/mypyc adoption only,
not another native build or client update. Qualification: NATIVE_TYPES_AUDIT.md
in the .356 workstream; parsed RPC schema/metadata conversion remains separate.

Startup also requires callable `submit_rpc`, rejecting stale domains explicitly.
The helper is included in startup inventory; prepare a matching native worker and
full domain/mypyc before separately approved adoption. No frontend/OTA/framework
rebuild or wire negotiation change is needed. The small real-codegen fixture and
actual-PyO3 probe verify isolated parity, not live network throughput or speedup.

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

Linux binary Code TE2 instead owns a private ordinary
CPython 3.14 interpreter/stdlib/dependency closure. It must select that payload
deterministically, reject host Python path/site contamination, and preserve a
separate host executable identity for Node discovery and run-profile children.
Termux retains its resolved regular system 3.14/Bionic ABI. Private payload,
relative ELF linkage and target-install validation remain release contracts;
source interpreter handoff alone is not proof of a self-contained release.

Private manifest schema 2 declares `pythonRuntime.mode="bundled"`, relative
`home`, `executable`, `sourceRoot`, and the embedded `extensionSuffix`.
Bootstrap supplies `CODE_TE2_PYTHON_ISOLATED=1` and
`CODE_TE2_PYTHON_SOURCE` only for that validated payload. The worker disables
environment and site initialization, explicitly selects the private stdlib,
dynload and dependency directory, then loads its declared source/compiled
overlay. It does not import the host package root or process `.pth` files.
`CODE_TE2_HOST_PYTHON_EXECUTABLE` retains launcher identity for child launching
and discovery. These loader contracts are tested; the complete private runtime
materializer and host-independent platform-tag hooks exist. Exact build/repair,
installed-runtime and user-acceptance evidence is retained in the desktop
packaging tracker; do not carry a superseded pending checkpoint into current
runtime instructions or infer fresh acceptance from loader tests alone.

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

The native worker accepts `CODE_TE2_MYPYC_DIR` pointing to a matching build's
manifest/lib directory. Bootstrap supplies the shellspec selection. In editable
installs, an absent automatic `.codex-scratch/mypyc-active` target (including a
dangling symlink after deleting a snapshot) selects an empty value and interpreted
imports in the same Rust/PyO3 worker. The selector is not rewritten or deleted.
An existing target remains strict: missing/malformed manifests, missing libraries,
ABI errors and permission failures are not silently bypassed. Explicit selections
(including an intentionally empty value) retain their policy.

`CODE_TE2_FORCE_INTERPRETED=1 te2` deliberately overrides editable domain selection,
including an explicit path, without changing the worker binary or snapshot. A
new normal framework invocation resumes normal selection. This is bootstrap-owned
and does not change a live worker or a manually launched raw worker. Packaged
installs reject the override and require the verified compiled payload.
There is no automatic mypyc build. Startup reports the compiled
module count. The overlay links source-owned resource directories into its lib
layout because compiled modules resolve sibling assets relative to their `.so`.
These development symlinks are not a portable wheel packaging solution.

#### Installed artifact selection

The executable remains independent of `te2-server`. Bootstrap resolves concrete
paths once and supplies them to the app shellspec:

- Source installs: configured Cargo workers publish under
  `$TE2_CACHE_HOME/code_te2/build/bin/<fingerprint>/<profile>/code-te2-worker`.
  Explicit `build_mypyc.py` publishes validated domain snapshots separately;
  `.codex-scratch/mypyc-active` is a selector, not a mutable compiler-cache runtime.
- Binary wheels: package-owned `app/release_runtime/code_te2/` contains the worker,
  compiled domain, resources/interpreted islands and provenance. The resolver
  `app/release_runtime/code_te2.py` validates package-relative inventories and
  component hashes, selecting Linux bundled-Python schema 2 or Termux system-ABI
  schema 1. No developer symlinks or absolute build-host paths may be required.

Match regular CPython minor/ABI, architecture, libc and libpython at the native
boundary. Linux's isolated bundled interpreter permits host-independent platform
wheel tags; Termux's system-interpreter payload retains its exact ABI tags.
Do not treat bundled mypyc libraries as host-importable extensions. Rust/domain
fingerprints remain separate, so a domain edit does not force a Rust rebuild.
Missing/incompatible binary artifacts fail explicitly, with no Cargo/interpreted
fallback. Installed validation and publication follow the release workflow;
snapshot publication or source build does not grant release/activation permission.

#### Pip bytecode and compiled-domain reuse

Pip may create adjacent `__pycache__` entries even inside a venv. Both runtime
schemas permit only conventionally named bytecode associated with a tracked,
hash-verified source file; unknown files and symlinks still fail validation.
Bootstrap supplies `CODE_TE2_PYTHON_CACHE_PREFIX` inside the verified payload.
Native PyConfig requires that prefix to be absolute and absent and disables
bytecode writes, so pip-generated adjacent caches are never consumed. This is
embedded-interpreter configuration, not a generic environment change inherited
by terminal shells or Node children.

For release packaging only, `scripts/build_linux_release_wheel.py
--reuse-domain-wheel <validated-wheel>` can preserve a compiled group. The
restorer verifies transfer/native-library hashes, matching ABI/platform and the
complete startup-source digest, then imports all restored modules before
publishing a fresh immutable snapshot. Any startup-source change rejects reuse.
Resources and non-startup packaging helpers come from the new pinned source.
The restored snapshot records the original wheel SHA-256; this is not a mutable
compiler cache, automatic activation, or permission to publish a release.

#### Cached build and retention workflow (current developer behavior)

Preferred editable entrypoint (uses the invoking Python/venv; callable from any
working directory):

```bash
python -B app/apps/code_te2/build_mypyc.py
```

Publishes validated mypyc snapshots under the resolved
`TE2_CACHE_HOME/code_te2/build/mypyc-snapshots/` (normally
`~/.cache/te2/code_te2/build/mypyc-snapshots/`). The finished shared objects are in
the snapshot's `lib/`, alongside its manifest/provenance. New snapshots are named
`domain-<sha256>` from startup source contents, toolchain/configuration and build
recipe. An unchanged invocation inventories sources and verifies metadata/library
checksums, then reuses the exact snapshot without mypyc code generation, C
compilation or relinking. Different source/toolchain/recipe inputs produce a new
immutable snapshot. A corrupt existing fingerprinted snapshot fails visibly;
the builder does not overwrite or delete accepted snapshots. The existing cached
build helper remains the authority; compiler intermediates stay in its existing
`${TMPDIR:-<repo>/.codex-scratch}/mypyc-build-cache` to retain cache reuse.
Default jobs is `MAX_JOBS`, otherwise one; override with `--jobs N`.
The entrypoint checks `ccache --version` with a bounded timeout before inventory.
If missing, unlaunchable (for example a libc++ linker mismatch), timed out or
nonzero, it reports the actual failure and automatically falls back to uncached
compilation. It does not disable ccache for Android as a platform. Explicit bypass:
`python -B app/apps/code_te2/build_mypyc.py --no-cache` (equivalently
`NO_CACHE=1 python -B app/apps/code_te2/build_mypyc.py`). These overrides disable
compiler caching for that invocation, including a user-supplied ccache wrapper;
they do not delete the persistent intermediates or existing cached objects.
`--print-commands` resolves everything without changing state; `--no-activate`
publishes without selecting it. Default activation reuses the existing atomic
`.codex-scratch/mypyc-active` selector and preserves its previous selection;
the selector now points outside scratch, to the canonical published snapshot.
No worker restart, Rust rebuild, wheel packaging or resource copying is implied.
Editable resource links still point to this checkout. They are not substitutes
for the portable, inventory-validated packaged resources described above.

Cache existence does not guarantee incremental speedup. A shared group-header
change can invalidate all native C objects; verify unchanged/body-only/signature
edit builds before claiming effective reuse. No cache or release checkpoints are
automatically deleted by this entrypoint.

`build` keeps intermediates under `${TMPDIR:-.codex-scratch}/mypyc-build-cache`.
`--cache-dir` overrides that root.

Code TE2 mypyc uses the repository's explicit `pyproject.toml` configuration:
`[tool.mypy] strict = true`. This includes disallow-any-generics,
disallow-subclassing-any, typed/incomplete definition checks, checking untyped
bodies, warn-return-any and strict equality, plus mypy's other strict checks.
`disallow_subtyping_any` is not a mypy option; the supported spelling is
`disallow_subclassing_any`. The build passes the config path explicitly, so an
invoking working directory cannot select another policy. Finished snapshot
fingerprints include the parsed mypy settings, but not unrelated project version
metadata. Config/source changes require a new validated snapshot; previous active
snapshots and compiler caches are retained, with no automatic activation/rebuild.

Separate cache generations are keyed by checkout,
CPython ABI/version, compiler/version/flags, mypy/setuptools versions and compiled
module membership; ordinary source-content changes reuse the same generation.
An exclusive writer lock protects the cache. Generated C and objects remain there;
never point `CODE_TE2_MYPYC_DIR` at the mutable cache.

The installed setuptools recompiles a changed shared extension as a whole. When
`ccache` is present, the workflow uses a dedicated cache with content-based
compiler checking; unchanged C/header/flag combinations reuse cached objects.
New caches default to **512 MB**. An explicit `CCACHE_MAXSIZE` or a per-cache
`<cache-root>/ccache/ccache.conf` takes precedence; unrelated global cache settings
are not edited. This desktop's ignored local cache config sets **1 GiB**, keeps
compression enabled and disables ccache file_clone/hard_link. Other machines do
not inherit that local file or larger budget. Logs identify environment limits
versus cache-local configuration instead of always claiming 512 MB.

Snapshot `.so` publication tries Linux FICLONE into a new inode, falling back to
an ordinary independent copy on unsupported/cross-filesystem operations. It never
attempts FICLONE on Android, where the optional ioctl can be denied despite normal
file access; Android snapshots use independent copies directly. It never
hard-links mutable compiler outputs; cache rebuilds cannot modify an accepted
snapshot. Genuine I/O failures abort publication, not silently copy or activate a
partial result. Reflink support is filesystem-dependent and does not imply disk
savings on ext4; this desktop's small probe used the copy fallback successfully.
This is distinct from ccache's cloning mode, which would disable object compression.

The low-level probe can still run without ccache, but the preferred local
entrypoint and low-level probe both diagnose unavailable/broken ccache and fall
back; `--no-cache`/`NO_CACHE=1` skip probing. A user-supplied ccache `CC` wrapper is
removed while uncached compilation runs, then restored in the caller's environment.
On Termux, `pkg install ccache` supplies this **development** tool; it is
not a runtime/user-install dependency. Shared generated-header changes can invalidate
many objects. We retain a single shared compilation unit and `multi_file=True`.

During C compilation, stdout prints flushed `[mypyc completed/total]` lines
after each successful target, using the generated extension source inventory
(not the Python module count). Up-to-date extensions count as `Up-to-date`;
ccache-backed compiler calls count after successful return. Failed targets do
not advance the counter. Detailed compiler output remains in `build.log`.
Targets now report `Cache hit`, `Compiled (cache miss)`, `Compiled (uncached)`
or `Compiled (cache status unknown)`. Cache labels come from ccache's official
machine-readable statistics for an isolated per-invocation stats log, not timing
or shared-counter deltas. Per-command logging configuration and context-local
correlation preserve parallel builds without changing the process environment.
Missing/unrecognized/failed statistics stay unknown rather than failing a
successful compilation or claiming a miss. Up-to-date extension skips remain
distinct from ccache hits. Temporary target logs are removed after observation;
no global statistics are reset and no existing objects/cache entries are removed.
This counter covers C targets, not typechecking/code generation, linking or
snapshot validation; a full counter is not a published snapshot. Verified
finished-snapshot reuse still reports reuse without inventing compilation work.
Progress reporting does not change compiler concurrency or cache policy.

`native_runtime_contracts.py` is an explicit interpreted island for
`@runtime_checkable` Protocol definitions. Compiling those definitions loses
the Protocol identity required by Python's decorator at import time. The native
Socket.IO and diagnostics-metrics implementations remain compiled and import
those contracts; do not infer code-generation compatibility from mypy success.
`tests/test_mypyc_runtime_protocols.py` compiles/imports both implementations
and exercises their runtime protocol checks without building the whole domain.

Snapshot publication copies only this build's extension libraries (no hard links
to mutable compiler outputs), validates all compiled imports in a separate isolated
process, checks startup-source consistency and atomically publishes only on success.
`artifact.json` records toolchain/source/checksum provenance. Explicit `activate`
checks ABI and snapshot checksums, atomically switches the active symlink and keeps
the former target at `mypyc-active-previous`. Neither action restarts a process;
already-running workers retain old imports until an approved app-worker restart.
Snapshot resource links still refer to editable source, as in the existing probe.

`python -B app/apps/code_te2/build_mypyc.py --status` is read-only. It reports
`current`, `stale`, `missing`, `incompatible`, or `unfingerprinted` for matching
legacy snapshots without a build-recipe fingerprint. It verifies manifest/library
checksums, source contents and toolchain/ABI without importing the worker or
compiling. An already-running worker retains its old modules even after a new
selection: status describes the selector, not the live process. This introduces
no startup hashing or automatic runtime rebuild. Low-level developer scripts keep
their legacy unique `--output` behavior unless `build --fingerprinted` is specified;
`--activate-link` selects the actual published/reused snapshot only on success.

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

### Termux ast_serialize loader failure during mypyc parsing

An observed Python 3.14.8/mypy 2.4.0/ast_serialize 0.13.1 installation failed
before C generation with `cannot locate symbol "PyExc_TypeError"`. Standalone
`python -c 'import ast_serialize'` reproduced it. ELF inspection showed the
extension depended only on libdl/libc, while Termux libpython3.14.so exported
the missing symbol: an extension linkage problem, not a TE2 type error or a
compiler-cache failure. The reason its build omitted linkage is not established.

For that exact diagnosis, the user backed up the installed extension and added
`libpython3.14.so` with `patchelf --add-needed`; import and the resumed mypyc
build then worked. This is a local repair, not automated package policy or proof
that every loader error has the same cause. Reinstalling ast_serialize can
overwrite it; a durable wheel must carry appropriate Android Python linkage.
Do not delete compiler caches or downgrade Python/Rust based on this trace alone.

Pip build isolation may separately provision Maturin in a temporary environment.
`--no-build-isolation` needs an importable backend in the invoking Python; a
system Maturin CLI alone is not that backend. Neither isolated Maturin nor Rust
nightly was established as the cause of this extension's missing dependency.

### Framework bootstrap-managed native executable (source installs)

Normal source/editable `te2` startup and `te2 --build-only` use one native Cargo
build pipeline. The framework declares its configuration in
`framework/bootstrap/native_build.json`; native workers are discovered from
`<configured-app-root>/*/native_build.json` beside their owning manifest.json.
TE2_SERVER_APP_ROOTS controls discovery in registry order (default built-in and
user-data app roots), with first-app ownership and validated app IDs. The former central
`app/native_worker_builds.json` registry is retired. Discovery does not scan
arbitrary projects or undeclared trees for executable build commands. Discovery
does not execute app-owned provider code.

Each schema-1 manifest declares `appId`, `manifestBase` (`framework` or the owning
`app` directory), relative `manifest` (the Cargo.toml), optional Cargo `package`,
`binary`, exported `environmentKey`,
`pythonAbi`, and `features`. `cache.root` is relative to `TE2_CACHE_HOME`;
`targetDirectory` and `publishedDirectory` are relative to that root. An optional
`targetDirectoryEnvironment` retains the framework's existing explicit target
override. `fingerprint.policy` is `framework-source-v2`: source patterns are in
`inputs` and source-root-contained shared files in `sharedInputs`. Identifiers,
paths and owner IDs are validated. Code TE2 keeps its independent Cargo source
under `framework/native_editor_worker`; another built-in native worker can declare
`manifestBase: app` and own its Cargo tree directly inside its app directory.

Optional `runtimeProvider` declares a Python file directly inside the owning app,
exporting `prepare_runtime(NativeRuntimeContext) -> NativeRuntimeResult` from
`app.cli.native_runtime`. Code TE2's `native_runtime.py` owns its editable mypyc
and packaged Python environment policy. Providers run only during explicit
bootstrap preparation, never manifest discovery/read-only Cargo selection.
`select_native_build` exposes the existing fingerprint/receipt result without
building. The private sidecar's versioned native selection endpoint reuses it,
returning readiness/build/preparation status against bootstrap-issued context
without importing app providers. Its typed Rust client is not yet wired into
live refresh or launch. Full contract:
`docs/apps/release_0_2_356/FRAMEWORK_AGNOSTIC_AUDIT.md` (Stage A1).

The Code TE2 executable publishes atomically under
`$TE2_CACHE_HOME/code_te2/build/bin/<fingerprint>/<release|debug>/code-te2-worker`.
Intermediates remain in `code_te2/build/cargo-target`. A per-app lock and the
existing atomic framework publication helpers protect the final cache. Both use
the established framework fingerprint bytes: workspace path, profile, sorted
features, platform/architecture and selected source/lockfile/shared-file contents.
The framework's existing fingerprint and cache paths remain unchanged, including
reuse of valid binaries built before manifests existed. Python aliases,
`rustc -vV` and inherited `CC`/`CFLAGS`/`RUSTFLAGS` do not change the key: this is
the same policy the framework already used. Explicit toolchain/compiler changes
requiring replacement should use `--force-build`.

Python-linked builds have an adjacent `<binary>.build.json` runtime/ABI receipt.
A missing, corrupt or incompatible receipt requires a build before reuse; it
does not introduce a launcher-dependent fingerprint. Interpreter aliases sharing
the same runtime/ABI reuse the receipt. Cargo uses the invoking `sys.executable`
as `PYO3_PYTHON`. Source/runtime changes during compilation refuse publication.
Both framework and worker builds use manifest-driven `cargo build`, feature and
profile selection, locking and atomic publication; no worker-only Cargo policy.
Explicit legacy `--cargo-manifest`/`--no-build-cache` server CLI escape hatches
retain their direct-Cargo behavior. Normal manifest-managed binaries are retained
instead of deleting another running framework's selected path. Mypyc snapshots,
checkpoints and Cargo intermediates are untouched. `--print-command` does not
build or publish; `--force-build` rebuilds both configured framework and workers.

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

Mypyc compilation/activation is explicit through `build_mypyc.py`. For source
installs only, absence of the default `.codex-scratch/mypyc-active` selection
exports an empty `CODE_TE2_MYPYC_DIR`: the same native worker imports the Python
domain interpreted. Bootstrap prints the build command. An existing selection
(including a broken symlink) or explicit environment selection is preserved,
so invalid compiled snapshots still fail visibly. An explicit empty value opts
into interpreted mode. After first compilation/activation, launch a new framework
to select the default snapshot; already-running frameworks retain their startup
environment. Neither this choice nor the compiler script restarts a runtime.
Source installs include the independent worker's Cargo manifest/lockfile/source.
Binary release wheels require matched executable/domain/resources and ABI
validation. Packaged bootstrap resolves that validated payload instead of this
source-build path; missing payloads are refused, not compiled through a fallback.
Release and acceptance status belongs in the packaging tracker, not in a
perpetual pending-assembly statement here.

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

Editor connections additionally accept explicit `rpcCodec: "msgpack-gzip-v1"`.
This is an application envelope, not WebSocket permessage-deflate. The 12-byte
header is `TE2C`, version 1, raw/gzip flag, two zero reserved bytes, and a big-endian
u32 original length. Browser requests are raw framed MessagePack; compressed
requests are rejected. Rust encodes once and lazily gzip-compresses once per
fan-out for negotiated clients (at least 1024 bytes and only when smaller).
Legacy clients keep their original unframed bytes. Other namespaces do not accept
the new codec. No additional Python codec or application DTO parse is introduced.

Frames and original output are bounded to 8 MiB (including the header). Browser
receive is ordered with 64-packet/8-MiB declared-output admission and a 10-second
async decode deadline; disconnect aborts and invalidates old-generation work.
Malformed responses fail the editor transport, without alternate-codec retry.
Modern clients require native `DecompressionStream('gzip')`. Publication must pair
the rebuilt native worker, compiled Python editor-auth validation and frontend
assets; rebuilding the frontend alone does not activate this contract.

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
