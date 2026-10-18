# Search memory tracker

Historical evidence only. Current tasks/acceptance are maintained once in
docs/apps/release_0_2_354/TRACKER.md. The multiline follow-up and all seven user
notes were transferred there verbatim on 2026-10-17. PLAN.md retains the technical
direction; this move is not an implementation or new acceptance claim.

- [x] Read-only source investigation and bounded file statistics.
- [x] User approved producer-side bounded previews and file-result reuse.
- [x] Implement compact previews, byte-budgeted progressive batches and shared
  cancellation on delivery failure.
- [x] Add huge-line, Unicode/multiline, edit-coordinate, batching and rejected
  delivery regressions.
- [x] Targeted Rust tests and formatting/diff validation.
- [x] User confirmed live acceptance with the updated framework.

## Validation environment

Initial free disk: ~1.8 GiB. Interrupted the first default debug test build when
dependency compilation reduced it to ~1.2 GiB. Retained the cache and resumed
single-job tests with only the te2-server package's debug information disabled
and incremental compilation disabled. No release build or OOM reproduction.

## Results

- Rust search provider, progressive Git search and replacement tests: 29 passed,
  four existing benchmark tests ignored. Includes serial and parallel compact
  results, byte-budget batches, rejection cancellation, UTF-8/multiline clipping
  and exact replacement coordinates.
- Scheduler rejected-delivery regression: one passed.
- Existing cross-language pipe codec regression: one passed (31 total passed).
- Formatting and `git diff --check`: passed.
- Isolated ~20 MB single-line fixture retained all 371 hits, with serialized
  result below 1 MiB. `/usr/bin/time -v` reported 83,908 KiB maximum RSS and
  0.54 seconds wall time for the entire fixture test process, including fixture
  construction. This is not a production framework RSS or end-to-end benchmark.
- Agent validation did not launch/restart the shared runtime or publish clients.
  User subsequently confirmed live acceptance and approved commit/push.
- Free disk after validation was approximately 0.8 GiB. User subsequently ran
  `cargo clean` in framework/rust, reporting 1.8 GiB removed. No agent cleanup.

## Follow-up — multiline correctness and keyboard entry

Current checklist and unmodified user notes are in the consolidated release
tracker under Recent work. No multiline fix has been implemented yet.
