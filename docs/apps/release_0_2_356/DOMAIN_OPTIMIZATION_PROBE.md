# Native records versus async completion: isolated qualification

2026-10-23, production source HEAD 20d15a01. User approves both isolated probes
and documentation, not production conversion, dependency adoption or activation.
No framework/domain/client restart, full mypyc build, version bump or commit.

Subsequent approval implements the private WBA record and adds broader isolated
RPC comparisons. That is recorded separately in NATIVE_TYPES_AUDIT.md; statements
below that production source is unchanged describe the initial probe stage, not
the later N1 source change. No broader transport or async cutover is adopted.

## Source-backed targets

`workbench_adapter_shell_manager.PendingPush` is a private queue TypedDict, not
a wire/persistence schema. The selected compiled snapshot actually compiles this
module. Its generated `_queue_push` uses CPyDict_GetItem/PyNumber_InPlaceAdd/
CPyDict_SetItem for each event/count update and boxes the incoming tagged integer.
A plain typed class can remove those lookups and retain tagged integer fields.
The generated candidate C confirms CPyTagged event_count/payload_bytes members.
Payload dictionaries/strings remain normal objects; zero PyObject is not a goal.

NativeSocketServer is already a native class with direct C fields; its PyObject
container pointers do not mean its field access is interpreted. Search's typed
dataclasses/counters are another coverage lead, but search_sessions.py is absent
from the inspected snapshot's startup/compiled inventory. Native annotations there
alone cannot improve that snapshot. Do not force eager imports or change inventory
without separately investigating startup and lazy-loading costs.

`Backend.call_input` retains admission while a blocking task calls concurrent
Future.result(120). Async completion can release that blocking section while
Python waits, but cannot speed synchronous Python, eliminate serialization or
remove the GIL. The isolated candidate uses pyo3-async-runtimes 0.28.0/PyO3
0.28.3 with explicit TaskLocals on the existing-shaped owning loop, not a new
loop-owning main macro or replacement global policy.

## Environment and method

Desktop Linux x86_64, CPython 3.14.4, JIT disabled (PYTHON_JIT=0), mypyc 2.3.0,
uvloop 0.23.0, rustc 1.95.0; crate lock records Tokio 1.54.1. This is not the
production worker's full dependency graph or private-runtime/Android qualification.
Reproducible source and commands: `framework/domain_optimization_probe/README.md`.

Queue functions are extracted from production AST without production imports;
record-only transformation plus synthetic readiness/sink and metrics disabled.
6,000 events with owner changes and clear barriers, repeated or distinct URIs;
11 alternating samples per representation, actual compiled `.so` imports verified.
JSON comparisons and tracing are outside timing. No full domain activation.

## Queue results

Final reruns, median total push/drain milliseconds:

| Mode / fixture | Dictionary | Native class | Reduction |
|---|---:|---:|---:|
| mypyc / repeated URIs | 10.090 | 8.870 | 12.1% |
| mypyc / distinct URIs | 10.527 | 9.633 | 8.5% |
| interpreted / repeated URIs | 18.373 | 17.675 | 3.8% |
| interpreted / distinct URIs | 19.320 | 18.525 | 4.1% |

Compiled traced peak allocation is 629,744→564,104 bytes and
1,464,928→1,399,368 bytes respectively (~64 KiB less in each workload).
This is Python-traced peak allocation, not process RSS or retained production
memory. Earlier compiled rerun reductions were ~11%; small-run noise is visible.
These numbers are queue-only improvements, not end-to-end WBA speedups.

Both source and compiled variants agree on full emitted data/counters, contiguous
owner/latest-URI coalescing and clear barriers; gated drain cancellation, queue
clear and subsequent reuse pass. Real production callback/lifecycle integration
must still be checked if the class is adopted.

## Async results

Both source and actual mypyc fixture imports pass success, owning-loop and explicit
context checks, exception/deadline propagation, overload admission and permit
retention after caller cancellation. The original accepted operation finishes;
caller disappearance does not cancel it or release its permit prematurely.
Bridge shutdown cancels pending operations, completes the waiter, releases its
permit and rejects stale-loop binding. This is fixture parity, not TE2 lifecycle
proof. Explicit deadline cancellation follows existing cancel-on-timeout shape;
it is not a claim that cancellation has synchronously finished when requested.

Five rotated samples per 1/16/64-request burst, both default asyncio and uvloop.
Compiled-fixture uvloop medians, batch milliseconds:

| Requests / synthetic wait | Blocking result | Async bridge | Mid-wait blocking occupancy |
|---|---:|---:|---:|
| 1 / 0 ms | 0.318 | 0.411 | n/a |
| 16 / 0 ms | 2.078 | 2.470 | n/a |
| 64 / 0 ms | 6.739 | 6.237 | n/a |
| 1 / 20 ms | 20.631 | 20.704 | 1→0 |
| 16 / 20 ms | 22.698 | 22.638 | 16→0 |
| 64 / 20 ms | 27.130 | 26.476 | 64→0 |

Across source/compiled and asyncio/uvloop there is no consistent latency win.
The robust observed difference is freeing blocking sections during async waits.
Burst submission still briefly acquires blocking threads/GIL and can show high
peak occupancy: do not infer 64 fewer resident threads or a measured RSS saving.
Zero-delay overhead, saturation/fairness, full-domain handlers and real transport
costs need separate qualification. Five small batches are not a stable application
p95 estimate; no live search/WBA speedup is claimed.

## Decision recommendation and remaining gates

1. Prefer the bounded native PendingPush class as the next production proposal:
   small, repeatable local CPU/allocation win without wire/loop/dependency changes.
   Preserve coalescing barriers, lifecycle cancellation and interpreted parity;
   run existing diagnostics tests plus real codegen tests before activation.
2. Keep async completion as a separate capacity/concurrency proposal. Its benefit
   is avoiding long parked waits, not demonstrated faster everyday requests.
   Qualify the real submit/submit_rpc lifetime and worker shutdown, bulk conversion,
   byte/count limits and CPython/Termux packaging before adoption. Brief blocking
   submission/result conversion and owned-driver cancellation are deliberate.
3. Both can fit one coordinated workstream, but keep independent production
   patches/acceptance gates. These probes do not justify an inseparable cutover.

Validation: strict mypy passes all three probe Python sources; queue source and
mypyc runs pass; async source/mypyc × asyncio/uvloop runs pass. Rust build/format
checks are probe-only. Production source/dependencies/lockfiles are unchanged.

Local raw outputs are in `.codex-scratch/domain-optimization-queue-final-*.jsonl`,
`.codex-scratch/domain-optimization-bridge-{source,compiled}.jsonl` and matching
stderr. These are scratch evidence, not installed artifacts. The probe crate's
own Cargo.lock is retained; production Cargo.lock files are untouched.

Primary mypyc references:

- [Native class and primitive annotation behavior](https://mypyc.readthedocs.io/en/stable/using_type_annotations.html).
- [Native classes and decorator limitations](https://mypyc.readthedocs.io/en/stable/native_classes.html).

Current online docs are 2.4; installed 2.3 behavior above is independently checked
through actual generated C/imports, not inferred solely from those docs.
