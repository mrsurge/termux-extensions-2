# Staged native types: traffic first, reused caches second

2026-10-23, source checkpoint 20d15a01. User expands the scope beyond PendingPush,
prioritizes pipe/network traffic, and explicitly includes UI caches. Following
the read-only audit, approved first slice: apply the measured WBA record, add
isolated RPC metadata/direct-delivery comparisons, and maintain the staged plan.
This is not blanket production conversion, async bridge adoption, full-domain
build/activation, runtime restart, version bump or commit permission.

Subsequent bounded approval also implements N2a direct typed network delivery.
The parsed-metadata/schema-module split (N2b) and other stages remain candidates;
agent-led activation is not included. The user later builds/reloads and accepts
both N1/N2a; compiled provenance is recorded below and in TRACKER.md.

## Selection rules and stages

Replace existing records, not every PyObject. Native fields are promising when
records are read/updated repeatedly; a direct typed argument can be better than
another wrapper. Do not add a second DTO merely to unpack/reencode it. Preserve
opaque extension payloads, nullable/bool/ID distinctions, wire/persistence schemas,
client/presentation ownership, budgets, barriers, eviction and lifecycle behavior.
Verify actual compiled inventory and generated C; dataclasses/ordinary classes may
already have native fields. Runtime-inspected msgspec/Protocol islands stay intact.

| Order / surface | Source targets | Qualification |
|---|---|---|
| N1 WBA inbound queue | workbench_adapter_shell_manager.PendingPush | Six private fields; measured reused coalescing/drain record. Source implemented, no wire change. |
| N2 network delivery/request metadata | network_rpc_ingress → NativeSocketServer.deliver_rpc; socketio_jsonrpc.JsonRpcEnvelope; parsed editor/Explorer/host records | N2a direct delivery source implemented; N2b parsed metadata remains isolated. Preserve lane validation/IDs/notifications/errors. |
| N3 pipe-derived events/diagnostics | worker_services.event_bus.WorkerEvent; diagnostics_bridge entries; file_tabs_projection.FileTabDiagnostics | Shared event headers, owner/path/timestamp/counts are candidates. Payloads stay opaque; broad callback migration needs matched owners and project/owner barriers. |
| N4 retained UI/data caches | explorer.services.file_ops.DraftCacheEntry; diff_helper/draft_diff_helper cache entries; Git snapshot-backed state | Measure repeated access/allocation; response dictionaries remain at encoding edges. Existing dataclasses may already be native. |
| N5 conditional coverage/terminal | explorer.services.search_sessions cached records; terminal checkpoint/delta records | Search module absent from inspected startup snapshot: investigate compile coverage without eager imports. Drawer reader/registry classes already native; other terminal app backends remain independently owned. |

Each row is a candidate stage, not a promise every listed class needs edits. N2
precedes cache expansion because traffic is the main target. Async completion
remains an independently gated concurrency/capacity path, not a prerequisite.

## Pipe and network source findings

- control_bytes already decodes into fixed-layout msgspec PipeEnvelope/PipeError.
  Cloning every envelope into a second native object is not automatically faster.
  InboundEnvelopeRouter, AppIntentPipe, NativeSocketServer and NativeShells readers
  already use ordinary typed classes; retain original-byte/schema admission.
- WBA control stream already uses guarded bytes/msgspec. Its reader normalizes
  envelope/payload maps, a later outer-record candidate, not permission to flatten
  arbitrary extension bodies. Direct WBA frontend relay bypasses Python entirely.
- Network ingress constructs a context dictionary which deliver immediately
  reads back. A typed argument entrypoint could avoid that allocation while
  retaining native-owned context and the namespace trigger/cancellation path.
- Common RPC parsing converts to an interpreted msgspec schema, builds a parsed
  dataclass, then lane parsers build dictionary records. Native metadata should
  replace existing allocations, not be layered on top. Keep schema inspection
  interpreted; split native definitions into a dependency-safe compiled module.
- Pending-call maps already index IDs directly to Futures/queues; they are indexes,
  not loose records needing an additional wrapper for its own sake.

## N1 source change and validation

PendingPush is now an explicitly initialized ordinary class in its existing owner.
Only queue/coalescing/drain field access changes. URI indexes/payloads stay maps;
ordering, timestamps, metrics, counters and lifecycle/clear barriers are unchanged.

- Focused diagnostics/WBA/bootstrap regressions: 17 passed plus 2 subtests.
- New regression verifies field/counter values and distinct missing-URI entries;
  existing owner-clear/workspace barriers pass.
- Strong strict/extra/all-Any audit: 249 source files pass.
- Queue AST probe now handles either source representation and compiles the actual
  current class/functions, not a stale hand-copied class. Source and mypyc output/
  lifecycle parity pass; this run's compiled reductions are 11.1% and 14.8%, with
  the same ~64 KiB traced peak reduction. Earlier samples were 8.5–12.1%: this is
  noisy queue-only evidence, not a global application speed/RSS claim.

No full domain snapshot is built/selected and no worker is restarted. Activation
requires interpreted-domain adoption or a separately requested matching mypyc
build/fresh worker. No frontend/OTA/Rust change is required for N1.

## N2 isolated comparisons, not production adoption

Tooling: framework/domain_optimization_probe/rpc_probe.py and delivery_probe.py.
Both extract real source AST without importing production runtime owners.

The RPC probe keeps common msgspec/error support interpreted and compiles both
lane-parser variants plus native records together. Host/Explorer normally keep
those parsers interpreted, so this qualifies a split-module design, not current
whole-production performance. The common intermediate parsed dataclass remains.
Source and mypyc pass 17 output/error cases per lane (51 per mode): missing/null/
boolean/numeric/string IDs, invalid versions/methods/params, non-string parameter
keys, and nested/binary payloads. Production notification/encoding policy is not
changed. Nine rotated timing samples distinguish immediate versus eight-read
record use, with/without MessagePack decoding.

| Compiled small payload, one metadata read | Dictionary ns | Native ns | Including decode: dict→native ns |
|---|---:|---:|---:|
| Editor | 3,589 | 3,425 | 4,505→4,358 |
| Explorer | 3,802 | 3,578 | 4,150→3,975 |
| Host | 3,801 | 3,838 | 4,644→4,597 |

Eight-read fixtures generally favor native metadata more, but do not manufacture
reuse to match them. Wide-payload decode dominates; results include regressions
and do not support blanket conversion.

The delivery probe extracts the real adapter/ingress guard+decode bodies with a
synthetic namespace. Compiled small-fixture medians: editor 1,881→1,099 ns,
Explorer 1,894→1,334 ns, host 1,976→1,282 ns. Wide fixtures are mixed:
49.1→54.9 µs, 54.9→51.7 µs, 49.4→46.7 µs. Sixteen source and sixteen compiled
parity cases cover three lanes, scalar/forged-context payloads, malformed bytes
and invalid context. Real Rust guards, admission/Future paths, generic namespace
protocol dispatch and application handlers are outside this synthetic comparison:
these are not network benchmarks or authority to bypass namespace lifecycle.

Recommendation: propose N2 direct typed delivery next, with actual submit_rpc/
namespace and cancellation parity. Then simplify the common→lane metadata chain
and measure the complete path before expanding all three production lanes.

## N2a direct typed network delivery — approved source implementation

The recommendation above is now implemented in its existing Python owners:
network_rpc_ingress retains the exact lane/SID/event guard and cached msgspec
decode, then calls NativeSocketServer.deliver_rpc(namespace, sid, data). That
method resolves the registered namespace and invokes trigger_event("rpc", sid,
data); there is no transport-context dictionary, string re-coercion, dynamic
event branch or argument-tuple assembly in this RPC adapter. Namespace handlers
still own handler lookup, cancellation and application/schema policy. The
general deliver method remains unchanged for lifecycle and other events.

No Rust/codec/queue/admission/Future/ACK/outbound, client protocol or payload
change. N2b parsed request metadata is not converted in production. No replay,
fallback dispatcher, runtime restart, full-domain build/activation or commit.

Validation: 13 tests pass across source namespace/ingress regressions and the
actual three-module mypyc fixture. Tests exercise native_worker.submit_rpc →
owning loop/Future → real adapter, preserve opaque/scalar/forged-context data,
reject malformed input before dispatch, and check handler failures (one call),
handler cancellation, caller cancellation and stale clients. Additional source
tests retain NativeNamespace cancellation-to-None and exact session cleanup on
the unchanged general disconnect path. Stronger strict/extra/all-Any audit
passes 249 Code TE2 source files. Probe/helper strict mypy and diff checks pass.

The AST delivery comparison now uses today's real direct method rather than an
inlined candidate, reconstructing the former map-based wrapper explicitly.
Sixteen cases pass in both source and actual mypyc modes. Compiled small fixture
medians: 1,630→1,088 ns editor, 1,610→1,065 ns Explorer, 1,613→1,075 ns host;
wide fixtures 41.17→40.15, 42.04→41.03, 41.68→41.59 µs respectively. This remains
a synthetic namespace/decode microbenchmark, not live network throughput or an
end-to-end latency claim. Raw output: ignored
.codex-scratch/domain-rpc-direct-production-20261023.log.

Activation is Python-domain only: refresh interpreted modules or explicitly build
and adopt matching compiled modules. No additional native Rust build or frontend
publication is required by N2a itself. The user subsequently completes the full
domain build/reload and accepts hot reload/normal behavior. Read-only process
maps identify the current verified 35fb05ee… snapshot, including the compiled
group/worker/WBA, with FORCE_INTERPRETED=0; reflection is not enabled or needed
for that check. Full receipt is in TRACKER.md. This is activation/functional
acceptance, not a live speedup measurement. Next candidate is N2b common/lane
metadata allocation reduction; async adoption remains separate.

Evidence: ignored .codex-scratch/domain-native-queue-production-20261023.log,
domain-rpc-records-v2-20261023.log and domain-rpc-delivery-20261023.log, plus their
generated source/compiler directories. No live resources or selectors are touched.

## N2b common-schema reuse — approved source implementation

The common socketio_jsonrpc coercer now returns its validated frozen msgspec
envelope directly, with read-only request_id/has_id properties over the unchanged
id wire field. A whitespace-normalized method alone uses structs.replace; the
ordinary path avoids a separate metadata dataclass allocation. The legacy public
JsonRpcEnvelope constructor remains available, but returned values are explicitly
annotated as the private schema, not disguised dataclass instances. Schema/error
modules stay interpreted; lane policies and final dictionaries remain unchanged.

The stronger strict/extra/all-Any audit passes all 249 Code TE2 files. Actual
production editor/Explorer/host/Sidebar consumers match the reconstructed old
baseline across 34 cases each, in source and actual compiled-editor modes. The
codegen fixture uses a small multi-module group with network_rpc_ingress to match
production's shared-library layout; common schema and other lanes stay Python.
This is not a full-domain build or activation. Full-domain adoption/live checks
remain separately gated; no Rust rebuild, frontend assets or OTA are needed for
this Python-only change. Comparisons/limits: COMMON_RPC_PROBE.md.
