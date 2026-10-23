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
