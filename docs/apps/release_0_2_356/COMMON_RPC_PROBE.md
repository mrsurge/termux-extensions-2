# Complete RPC parsing: remove the intermediate metadata allocation

2026-10-23, checkpoint dc66b255. User approves isolated comparisons of native
intermediate metadata versus validated-envelope reuse, tests and documentation,
not production changes, full-domain build/activation or runtime transitions.
Subsequent explicit approval covers the bounded production schema-reuse change,
real-lane regressions/codegen and documentation, still without full-domain build,
activation, restart or commit.

## Source path and candidates

The existing common helper converts the decoded object into a frozen msgspec
schema, validates JSON-RPC/method, constructs a separate frozen Python dataclass,
and returns it. Each lane then validates its own ID/method/params and projects a
dictionary. Editor/host/Sidebar notification handling calls the common helper a
second time after request parsing returns None. Explorer has one parse path.

The common helper is used by four lanes, not only the three optimized network
ingress lanes. This probe includes Sidebar while preserving its independent
policy and current transport ownership. Only editor contract code compiles in
the inspected selected graph; the other contract/schema islands stay interpreted.

Compare:

1. Baseline: exact existing common helper/dataclass and lane validators.
2. Native: relocate intermediate metadata to an ordinary native class with
   read-only public properties; otherwise retain the same pipeline. The initial
   exact frozen-dataclass relocation compiled but failed at import with
   KeyError: object on installed mypyc 2.3/CPython 3.14. Retain that failed fixture;
   do not treat it as a universal dataclass limitation or add annotation hacks.
   The plain record is an attribute-access candidate, not a promise of dataclass
   equality/introspection compatibility.
3. Reuse: keep the original private frozen schema fields (including id), expose
   request_id/has_id as read-only properties, and return that validated object
   instead of constructing the metadata dataclass. Already-trimmed methods reuse
   the exact schema instance. Whitespace normalization alone uses frozen
   msgspec.structs.replace. Retain the existing public JsonRpcEnvelope dataclass
   constructor for compatibility. The coercer's concrete return type changes to
   the private schema, explicitly annotated; current in-repo consumers use its
   attributes, not dataclass identity. That change is a production decision gate.

No payload flattening, new narrow integer constraints, skipped validation,
parameter-map copy removal, wire changes or transports. Lane dictionaries and
error classes remain unchanged, including unknown field handling, bool/null/
missing ID distinctions, method allowlists and validation/error precedence.

## Qualification

Tooling: framework/domain_optimization_probe/common_rpc_probe.py. It generates
controlled copies in a new ignored scratch directory and never imports production
owners. Only editor variants and native metadata compile; schema/error and other
lane modules remain Python. This preserves the relevant compilation boundary,
unlike compiling every parser just to favor a candidate.

Source and actual mypyc-editor runs each pass 34 output/error cases per lane
(136 per mode), comparing both candidates with baseline. Cases cover missing/
null/bool/integer/string/container IDs, invalid versions/methods/params, method
whitespace, allowed notifications, non-string params keys, nested binary/Unicode
values and has_id/request_id spoof fields. Extra checks cover readonly public
metadata fields, input immutability and missing-versus-null properties. This
does not test mutation replay, live sockets or the full domain lifecycle, which
are not changed by the proposed common-helper optimization.

Environment: desktop CPython 3.14.4, JIT disabled, installed mypyc 2.3.0. Nine
rotated samples per three-way comparison. Small request/notification batches
use 3,000 parses, wide fixtures 100; JSON logging and collection are outside the
timed loop. Compiled-editor-mode results include MessagePack decode:

| Small request | Baseline ns | Native metadata ns | Reused schema ns | Reuse reduction |
|---|---:|---:|---:|---:|
| Editor | 3,656 | 3,316 | 2,815 | 23.0% |
| Explorer | 3,670 | 3,474 | 2,768 | 24.6% |
| Host | 3,761 | 3,612 | 2,693 | 28.4% |
| Sidebar | 3,465 | 3,268 | 2,761 | 20.3% |

Notification reduction is ~27–40% in these fixtures. Wide decoded payloads
dominate: baseline→reuse is editor 52.92→50.26 µs, Explorer 51.96→48.30 µs,
host 55.52→51.05 µs, Sidebar 48.29→48.33 µs. This is a parser microbenchmark,
not a promised overall RPC/network/IDE speedup. Local timing noise remains.

Evidence: .codex-scratch/common-rpc-parser-20261023.log retains the frozen
dataclass import failure; v2 log retains the first ordinary-native/schema reuse
comparison; v3 log qualifies the refined reuse variant that preserves both the
original private schema and legacy public constructor. Corresponding generated
source/compiler directories are retained. Probe strict mypy passes.

## Approved production implementation and pending gates

Prefer common-schema reuse over adding native metadata: it removes an entire
intermediate allocation, improves interpreted consumers too, and needs no new
compiled module/group. Leave final lane dictionaries alone for this bounded
slice. The separately approved implementation now makes that bounded change.

Production approval covers only socketio_jsonrpc.py's schema properties,
accurately annotated return type and conditional normalization/reuse, plus real
lane regressions, codegen qualification and docs. Preserve the public legacy
constructor and existing errors. Current source callers are attribute-oriented;
explicitly test that contract instead of hiding a new concrete type with a cast.
Full build/activation/restart/commit stay outside that source scope. Native
intermediate metadata need not be adopted merely because it can be compiled.

The repeatable comparison now explicitly reconstructs the pre-N2b dataclass
baseline, even when invoked against the new production source; it cannot quietly
compare reuse with itself. tests/test_socketio_jsonrpc_reuse.py additionally runs
the actual production lane modules against that baseline, with the actual editor
contract compiled separately and the common/schema/other lanes interpreted.
It checks schema fields, legacy constructor, exact ordinary-instance reuse,
read-only properties and whitespace-only frozen replacement without input edits.
The actual-codegen fixture includes network_rpc_ingress as a companion to obtain
production's root-level multi-module shared-library layout; it does not compile
or replace the common schema. Focused validation passes 28 tests/three subtests,
including existing native submit/Future regressions. Stronger Code TE2 mypy
passes 249 files; probe strict mypy and diff checks pass. These establish source
and isolated compiled parity, not selected full-domain activation/live acceptance.
