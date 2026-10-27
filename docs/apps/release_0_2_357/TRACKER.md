# 0.2.357 tracker

## Code TE2 pipe concurrency — O2 continuation

- [x] Record user-requested deferral from .356 on 2026-10-26; preserve completed
  boundary optimizations and user-reported sub-second 6,000+ file search acceptance.
- [ ] Establish an actual workload/queue-pressure or responsiveness need before
  resuming; not an automatic next task or a .356 release blocker.
- [ ] Audit reusable framework scheduler process/thread/queue machinery and
  Code TE2 Python intake/handler ownership; distinguish transport from processing.
- [ ] Approve a bounded design with ordering, cancellation and memory limits.
- [ ] Implement only if justified, compare end-to-end responsiveness and obtain
  live acceptance. No transport replacement or multiprocessing adoption implied.

## Shared-library continuation

- [x] Record user-requested deferral from .356; preserve PoC source and results.
- [x] Isolated Linux stripped cdylib comparison and boundary/loader checks
  completed under .356; see framework/shared_runtime_probe/README.md and
  ../release_0_2_356/TRACKER.md for evidence and limitations.
- [ ] Approve concrete production API/consumer scope.
- [ ] Qualify ABI, toolchain/dependency alignment and platform loader policy.
- [ ] Implement approved manifest/fingerprint/packaging integration.
- [ ] Measure actual total artifact savings and rebuild behavior.
- [ ] Validate Linux and Termux artifacts and obtain live acceptance.

No production integration or release approval is implied by this backlog.
