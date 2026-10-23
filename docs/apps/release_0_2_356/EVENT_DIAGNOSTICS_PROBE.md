# N3: event headers and retained diagnostics

2026-10-23, checkpoint 7e214f4d. User approves isolated source/mypyc
qualification, regression tests and documentation, not production edits,
full-domain compilation/selection, activation, restart or commit.
Subsequent approval adopts the diagnostics safe-copy/type slice below; a second
explicit approval covers the one-line async deletion compatibility correction.
Neither approval includes full-domain builds, activation/restart or commit.

## Source and coverage

- worker_services/event_bus.py: seven-field WorkerEvent TypedDict; the owner
  and 16 other modules use its header/payload. Build copies the payload map,
  not nested values. Queues/metrics and project-generation consumers retain
  existing ownership/order. The inspected selected domain compiles event_bus.
- diagnostics_bridge.py: private DiagEntry aliases dict[str, object]. Intake
  normalizes marker maps/keys once. Every aggregation calls _marker_list again,
  rebuilding those dictionaries while normalizing the same keys again. Cache
  is keyed by path/owner and capped at 500; clear is owner-scoped.
- file_tabs_projection.py: FileTabDiagnostics is both retained count metadata
  and a wire shape. Do not replace public dictionaries merely to wrap two ints;
  this comparison does not change it.
- diagnostics_bridge is lazily imported from wba_event_bridge and absent from
  the inspected .codex-scratch/mypyc-active/manifest.json; its native probe is a
  hypothetical coverage comparison, not current compiled-path evidence. No
  eager imports or production compiler inventory changes were made.

## Method and parity

framework/domain_optimization_probe/events_probe.py reads production AST without
importing runtime owners. It copies the complete bus and changes only header
construction/access in the native variant. Fan-out consumers are explicitly
synthetic equivalent handlers, not all 17 real production modules. Tests cover
stale-generation rejection, queue drain/shutdown, stopped ingress, metrics counts
and payload helper behavior; path normalization remains in timing.

Diagnostics variants extract the actual normalization/update/prune functions,
valid-owner clear loop and aggregation block. Six alternatives separate native
metadata from marker copy policy: dictionary baseline, native fields, dictionary
without copies, native without copies, dictionary with shallow dict.copy, native
with shallow dict.copy. Initial normalization/validation remains unchanged.

Output parity covers multi-owner updates/clears, empty resources, invalid and
outside-project URIs, malformed marker filtering/key coercion, project pruning,
and cap/oldest-tie eviction. It is not a full live debounce/project-switch test.
Timestamp values are not compared across sequential runs; eviction order is.

**Removing marker copies entirely fails ownership parity.** A consumer mutating
the published marker map mutates the cache in the no-copy variants; the original
and dict.copy variants isolate that mutation. All variants retain shared nested
values, so dict.copy preserves the original shallow-copy contract, not a new
deep-copy policy. This matters independently of how today's subscribers behave.

## Local timing (not application/network performance)

CPython 3.14.4/mypyc 2.3.0 on this desktop. Seven rotated samples. Diagnostics
times cover complete aggregation of already-populated cache (50 iterations per
sample), not intake, timers, bus subscribers, encoding or network delivery.

| Aggregate fixture | Source baseline | Source safe copy | Compiled baseline | Compiled safe copy |
|---|---:|---:|---:|---:|
| 20 files × 5 markers | 543 µs | 473 µs | 416 µs | 395 µs |
| 200 files × 20 markers | 10.69 ms | 7.31 ms | 6.57 ms | 5.85 ms |

Safe copying lowers local interpreted aggregate time ~13–32%; compiled ~5–11%.
Native record alone was mixed/slightly worse in the second run: 573 µs/10.89 ms
source and 430 µs/6.61 ms compiled. Native plus safe-copy gives little extra
versus safe-copy alone for the large fixture. Neither claim measures live gains.
Unsafe no-copy is faster but is explicitly rejected, not recommended.

Event-header gains are small/mixed under these consumers: source delivery-only
changes range from ~2.6% faster to ~0.4% slower; with construction, ~0.4% faster
to ~1.6% slower. Compiled results range ~1–9% faster. The earlier run also showed
a slight compiled 12-consumer regression. Generation checks repeatedly normalize
the project path; header field access is not the dominant cost here. This is
insufficient evidence to recommend a broad 17-module conversion now.

Retained ignored evidence:

- .codex-scratch/n3-events-diagnostics-20261023.log: first four-variant run.
- .codex-scratch/n3-events-diagnostics-v2-20261023.log: six-variant comparison
  with the safe shallow-copy alternatives (table above).
- .codex-scratch/n3-events-diagnostics-v3-20261023.log: final source/compiled
  parity rerun, adding explicit payload-map isolation and nested-sharing checks.
- Matching generated source/compiler trees are retained; no selectors change.

Probe strict mypy and source regression test pass. Source and native generated
fixtures pass output parity and expose the expected no-copy ownership failure.

## Approved bounded production implementation

Prefer the source-visible redundant-work reduction, not native records for their
own sake. Make the internally constructed diagnostics cache record explicitly
typed (TypedDict), retaining its existing dictionary representation and five
fields. Use direct typed fields and shallow marker.copy during aggregation of
that trusted cache; intake remains the only normalizer. Existing cache timestamp,
metrics counts and log path reads can use the same typed fields without repeated
coercion/copies. No new wrapper, schema island, wire change or compile-coverage
expansion is needed. Unknown extension marker contents stay opaque dictionaries.

Validation covers actual diagnostics-module owner clears, resource clearing,
project reset/pruning, eviction, malformed intake and published-marker isolation,
plus existing storm/metrics/file-tab regressions and the stronger 249-file audit.
Qualify the actual module in a small compiled fixture without claiming that
current full-domain inventory compiles it. Keep event-header conversion deferred
unless stronger real-consumer evidence justifies its scope. Update technical docs,
plan/tracker/memory. Full-domain build/adoption/restart/commit remain separate.

The approved implementation replaces the broad DiagEntry alias with a five-field
TypedDict, retaining dictionary construction. Aggregation now copies trusted
marker maps directly; timestamp/metrics/log reads use typed fields. No unknown
ingress validation is removed and no cache record/extra DTO is layered on top.
Probe generation explicitly reconstructs the old aggregate/timestamp path after
adoption, preserving meaningful comparisons against the previous implementation.

Actual full-module codegen first exposed a pre-existing mypyc limitation at
del project_root inside the debounce coroutine. User approves _ = project_root
instead; the argument/API, active-project-at-emission behavior and debounce stay
unchanged. A two-module diagnostics+metrics fixture then passes actual source and
compiled behavior, publishing through the real interpreted bus rather than mocking
compiled-local callbacks. Existing owner-clear/storm/metrics/projection tests pass:
16 focused tests total. Stronger strict/extra/all-Any audit passes 249 Code TE2
files, and the probe strict check passes. No production compile coverage change
or application/network performance claim follows from isolated codegen success.

Runtime adoption requires a fresh import of diagnostics_bridge in the owning
worker. A full mypyc build is not needed solely for a module absent from its
selected compiled inventory; do not confuse a build with replacing live imports.
No Rust/frontend/OTA change is needed. Agent activation remains unapproved.
