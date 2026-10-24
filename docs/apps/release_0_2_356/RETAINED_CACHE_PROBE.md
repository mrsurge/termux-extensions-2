# N4 retained-cache work

2026-10-23, checkpoint e6a2301a. Approved scope: compare retained caches, remove
unused Git-diff size/stringification, use detached dictionary copies for Git
status projections, probe draft-index metadata and maintain tests/docs. No
full-domain build, activation, restart, selector change, commit or push.

## Inventory and selected change

diff_helper.DiffCacheEntry, draft_diff_helper.DraftDiffCacheEntry and
worker_services.git_service.GitSnapshotCacheEntry are already dataclasses with
native mypyc types. The inspected selected manifest compiles these modules and
file_ops; shared-library CPyType/CPyDef symbols confirm these classes have native
representations. Rewriting them solely to obtain native fields is unnecessary.

Two avoidable operations were found and removed:

1. collect_diff computed len(str(payload)) for DiffCacheEntry.size on every
   miss. No code read that field; it did not enforce a budget or size guard.
   The field and stringify are removed, without changing payloads/cache hits.
2. get_cached_statuses/get_status_snapshot rebuilt the validated status map in
   a Python comprehension. Builtin dict(...) now returns the same detached map
   directly. This preserves the public dict[str, str] return contract while the
   stored values are a Literal union, without an invariance cast/suppression.
   Keys/values/order and mutation isolation are unchanged.

No keys, TTLs, locks, invalidation, resource limits, snapshot authority or wire
DTOs change. Draft-index metadata remains its existing TypedDict. Draft-diff
content-based keys and existing large-content guard are unchanged. This is not
new cache capacity/eviction policy or cache integrity repair.

## Isolated comparison

framework/domain_optimization_probe/cache_probe.py extracts real diff functions
and cache class, rebuilding the historical unused-size baseline even after
source adoption. The typed diff provider is a fixture: Git/service latency,
normalization, actual diff computation and wire encoding are not measured.
Status tests use real lock/path/dirty lookup code with a minimal fixture schema,
not a replacement production GitSnapshot DTO. Draft-index tests use real locking,
TTL/path/invalidation with a stub sidecar; no real sidecar disk timings.

CPython 3.14.4, JIT disabled, mypyc 2.3.0. Seven rotated samples. Large diff
fixture: 200 hunks × 20 lines of repeated Unicode text. Existing payloads are
constructed outside timing/tracing, so measured memory is extra miss overhead.

| Fixture | Source before → after | Compiled before → after |
|---|---:|---:|
| Diff miss, 2 × 3 lines | 43.7 → 27.8 µs | 45.4 → 29.3 µs |
| Diff miss, 200 × 20 lines | 7.73 ms → 34.2 µs | 7.63 ms → 34.2 µs |
| Cached statuses, 20 paths | 26.4 → 24.0 µs | 25.1 → 24.9 µs |
| Cached statuses, 6,000 paths | 583 → 87.0 µs | 514 → 70.3 µs |
| Draft-index hit, dict → native | 22.29 → 22.15 µs | 24.61 → 24.66 µs |

For the large synthetic diff miss, traced peak overhead drops from 3,350,160
bytes to ~2,600 bytes by not building the throwaway representation. The retained
payload is not removed or counted in that saving. These are local cache-path
comparisons, not whole Git, network, model-open or IDE speedup claims. Native
draft-index fields have no convincing win when real hit locking/path work stays
included, so that conversion is not adopted.

Evidence (ignored, retained): .codex-scratch/n4-caches-20261023.log and
.codex-scratch/n4-caches-v2-20261023.log, plus matching source/compiler trees.
The second run qualifies the final dict(...) status-copy spelling.

## Actual production-module validation

tests/test_retained_cache_optimizations.py tests actual diff_helper,
draft_diff_helper and git_service in source and a small three-module compiled
group, with explicit loaded-module provenance. Only the external pipe call is
stubbed, not native-local helper dispatch. A str-subclass sentinel raises if
unused payload repr work returns. Controlled time verifies exact TTL boundaries.

Coverage includes base-ref normalization and partitioning, root/path separation,
file/project/global invalidation, same-object hits, Unicode hunks, slash
normalization, provider failure with one attempt/no cache insertion, detached
cached/fresh status copies, dirty/unknown no-provider reads, unchanged draft
diff content keys/TTL and its large-content guard. Source probe regression also
checks reconstructed baselines. Existing historical/project tests remain green.

Validation: two actual source/codegen tests, plus 18 grouped tests and five
subtests. Stronger strict/extra/all-Any mypy passes all 249 Code TE2 files; the
probe passes strict mypy. No production Any, casts, schema weakening or new
dependencies are introduced.

## Activation and next work

No worker was refreshed and no artifact selected. These modules are in the
selected compiled graph: a matching mypyc build and fresh worker adoption are
needed when using that graph; interpreted mode needs fresh imports. No Rust,
frontend or OTA build is required by this slice. User subsequently reports the
local build passing live validation and approves commit/push; this is functional
acceptance, not a measured live speedup or independent runtime-provenance check.
N5 conditional search-coverage/terminal work remains a separate candidate, not
permission to change other apps' terminal owners or eagerly inflate imports.
