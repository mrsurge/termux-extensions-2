# Isolated domain optimization probes

Development-only comparisons; no TE2 imports in the async fixture, no production
dependency/lockfile changes, activation, sockets, selectors or runtime restarts.
The queue generator extracts the actual production queue/coalescing/drain AST;
its event sink/readiness gate are synthetic and metrics are disabled. The only
candidate transformation is PendingPush dictionary fields to native attributes.
Generated modules, compiler outputs and logs belong in named scratch storage.

From the repository root, with CPython 3.14, mypyc/setuptools and uvloop installed:

```bash
python framework/domain_optimization_probe/queue_probe.py .codex-scratch/queue-comparison
python framework/domain_optimization_probe/compile_bridge.py .codex-scratch/bridge-comparison
cargo run --locked --release --manifest-path framework/domain_optimization_probe/Cargo.toml
TE2_PROBE_BRIDGE_DIR="$PWD/.codex-scratch/bridge-comparison" cargo run --locked --release --manifest-path framework/domain_optimization_probe/Cargo.toml
```

Generation requires a new scratch directory to avoid overwriting previous work.
Repeat queue measurements independently of compilation with `--run source` or
`--run compiled` and the existing queue directory. The bridge prints the imported
fixture path to stderr; require the `.so` path for compiled qualification. Cargo
uses the selected PyO3 interpreter/toolchain; inspect these before comparing runs.
Retain Cargo caches. Neither script builds the real Code TE2 domain.

Queue timing covers pushing/draining 6,000 events, excluding JSON comparison and
tracemalloc (measured separately). Rotate candidate order across 11 samples;
compare complete outputs, counters, latest-URI semantics, owner/clear barriers,
readiness cancellation, clearing and subsequent reuse. Native attributes must
also be confirmed in generated C; typecheck success alone is insufficient.

The async test owns one Python loop thread and an explicit Tokio runtime (four
executor threads, up to 128 blocking threads, 64 admitted requests). Both paths
submit one `run_coroutine_threadsafe` operation and convert the same small result.
The baseline parks a blocking section in concurrent Future.result; the candidate
wraps/shields that Future on its owning loop and uses explicit TaskLocals. It
retains brief blocking submission and result conversion. Context is deliberately
established on submission and independently checked in the TaskLocals wrapper.
No implicit Rust-thread context inheritance is claimed.

Five rotated samples cover 1/16/64 simultaneous calls with 0/20 ms async sleeps.
JSONL reports batch elapsed time, within-batch request p95, peak active blocking
sections and midpoint blocking occupancy during the delayed fixture. These are
not throughput saturation, resident thread count, RSS, or application benchmarks.
Both paths test result/exception/deadline, owning loop/context, overload rejection
and caller-drop admission retention. Bridge shutdown/stale-loop guards are tested
separately. The detached driver/shield is a proposed ownership mechanism, not an
existing production guarantee; timeout cancellation and caller-drop differ.

Results, limitations and recommended ordering:
`docs/apps/release_0_2_356/DOMAIN_OPTIMIZATION_PROBE.md`.

## Broader traffic-record comparisons

```bash
python framework/domain_optimization_probe/rpc_probe.py .codex-scratch/rpc-record-comparison
python framework/domain_optimization_probe/delivery_probe.py .codex-scratch/rpc-delivery-comparison
```

Both extract production AST without importing production owners. RPC metadata
keeps common msgspec/error support interpreted and compiles both lane-parser
variants plus native record definitions; host/Explorer normally keep those
parsers interpreted, so this qualifies a split-module design, not deployment.
Immediate/eight-read fixtures distinguish construction from reuse; small/wide
payloads include or exclude MessagePack decoding. Direct delivery compares the
actual wrapper/adapter against typed arguments with a synthetic namespace, not
real Rust/admission/socket traffic. Parity precedes timing; no wire/schema change.

After N2a, delivery generation extracts the actual direct method as well, while
reconstructing the former dictionary wrapper for comparison. It no longer inlines
the candidate's namespace call. Existing generated scratch fixtures are historical
evidence; use a new scratch directory for current-source qualification.

Queue generation handles either the old TypedDict or current native-class source,
using independent AST copies. Staged findings/production and activation gates:
`docs/apps/release_0_2_356/NATIVE_TYPES_AUDIT.md`.

## Complete common/lane parser comparison

```bash
python framework/domain_optimization_probe/common_rpc_probe.py .codex-scratch/common-parser-comparison
```

Compare the original intermediate dataclass, a plain native public-read-only
record, and direct reuse of the validated frozen msgspec schema. Preserve actual
coverage: only editor contracts and candidate metadata compile; Explorer/host/
Sidebar contracts and msgspec/error support stay interpreted. All four lane
validators are copied unchanged except import routing; notification processing
follows the real request-then-notification path. Source/compiled parity includes
complete error details, ID/params edges, normalization, frozen public fields and
unknown-field spoofing. Timing includes complete lane parsing and optionally
MessagePack decoding, not synthetic repeated field access.

The exact frozen-dataclass relocation initially failed native import on installed
mypyc 2.3/CPython 3.14 (KeyError: object). The ordinary native comparison avoids
that failure but does not promise dataclass equality/introspection compatibility.
The reuse candidate keeps the original private schema and public legacy
constructor; the coercer returns the schema's attribute-compatible concrete type
instead. Surrounding method whitespace uses frozen structs.replace, without
mutating input or adding an object on the ordinary already-trimmed path.
See release_0_2_356/COMMON_RPC_PROBE.md for evidence and production decision gates.

After N2b adoption, generation explicitly reconstructs the old dataclass baseline
before deriving candidates. Real production consumers are separately covered by
tests/test_socketio_jsonrpc_reuse.py in source and actual-editor-codegen modes;
benchmark copies alone are not production regression evidence.

## N3 event headers and diagnostics allocation

```bash
python framework/domain_optimization_probe/events_probe.py .codex-scratch/n3-comparison
```

The complete event-bus module is copied from source, with dictionary/native
header variants. Existing dispatch, queue shutdown, metrics, payload helpers and
generation methods run against explicitly synthetic equivalent subscribers.
These are not whole-application subscribers or network benchmarks. Path/project
normalization remains in timing, rather than hiding its dominant real cost.

Diagnostics variants extract actual normalization, cache update/pruning,
aggregation and valid-owner clear code. Compare dictionary/native cache records,
unsafe copy elimination (ownership counterexample), and shallow dict.copy on
already-normalized marker maps. The latter keeps detached outer maps/shared
nested values. Default source and compiled qualification compare all variants;
--check-only skips timing. Never adopt a faster candidate that fails ownership.

Current diagnostics_bridge is lazy-loaded and absent from the inspected domain
manifest: compiling its probe does not establish production compile coverage.
No production owner is imported or changed; no selector/activation is performed.
Findings and implementation gates: release_0_2_356/EVENT_DIAGNOSTICS_PROBE.md.
