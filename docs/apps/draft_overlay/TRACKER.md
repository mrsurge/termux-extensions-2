# Draft overlay tracker

- [x] User clarified drafts remain stored; only the overlay loses its contents.
- [x] Inspect lightweight/full entry replacement and acknowledgement contract.
- [x] User approved backend projection, item eviction, stale-update guards,
  regressions and frontend build, without live mutations/restarts/publication.
- [x] Implement shared backend snapshot owner and strict sidecar reads.
- [x] Route initial/live/post-discard updates through the same full projection.
- [x] Preserve unchanged entries/DOM groups/selection; separate mutation replies.
- [x] Backend regressions: 17 tests pass across new review tests and existing
  live-change, scheduling and project-switch suites.
- [x] Frontend regressions: 18 review, snippet and theme-catalog tests pass.
- [x] Mypy checks pass for seven modified backend modules.
- [x] Final TypeScript check and normal host/WBA build pass.
- [x] User rebuilt/activated the first backend and found the cold-restoration
  failure `Draft review project is no longer current`, with an empty overlay.
- [x] Correct admission: initialize a missing generation only for the active
  backend project; recheck path/generation around lock waits and off-loop work.
  Added real generation-zero restoration, stale-project and queued-switch tests.
- [x] Follow-up: 20 backend projection/scheduling/project-switch tests pass;
  changed projection module passes mypy. No frontend changes in this correction.
- [x] User rebuilt/activated the domain, refreshed the worker and reported the
  projection fix working after the cold-restoration correction. No agent live
  draft mutations; no more specific scenario-by-scenario acceptance inferred.

## Context and hunk reversion

- [x] User approved investigation, then concrete three-context-line/revert scope.
- [x] Review-only contextual ranges and exact draft replacements; shared inline
  editor diff geometry unchanged.
- [x] Typed authenticated Explorer RPC and captured backend item identity.
- [x] Strict draft compare/commit, stale disk/project/draft rejection, no disk writes.
- [x] Revert hunk confirmation, single pending action and ordinary error feedback.
- [x] Conditional editor mirrors preserve newer unpublished local text; applied
  changes use the existing WBA document publisher and review notification lane.
- [x] 40 Python review, hunk, notification, scheduling and project-switch tests pass.
- [x] 19 frontend review/UI/mirror/socket/snippet tests pass, including cancellation
  and the real registered conditional-mirror handler.
- [x] Mypy validation passes for six changed backend modules.
- [x] Final TypeScript check and normal host/WBA build pass after final edits.
- [x] User reports the complete latest draft-system changes tested working;
  runtime/client activation is user-owned, not performed by the agent.
- [x] User live acceptance covers the latest draft system, including context and
  hunk reversion; individual test scenarios were not enumerated.
- [x] Later user-approved hunk Save is implemented in the follow-up below.

## Explorer overlay chrome and checkbox selection

- [x] User approved matching Explorer overlays specifically; selected-hunk revert
  first, whole-file-only Save. Partial Save remains deferred.
- [x] Shared By Changes file/hunk row geometry, collapse controls, sticky scopes,
  path labels and fixed-width aligned draft controls.
- [x] File/hunk checkbox tree with indeterminate parents, Select All/Clear,
  identity-scoped selection retention and eviction.
- [x] Guarded multi-hunk reversion computes selected edits together per file;
  sequential cross-file failure stops without retries or transaction claims.
- [x] Save disabled for partial selection; separate whole-file Discard retained.
- [x] User authorized clearing the discovered whitespace-only test draft in
  review_projection.py; exact-file sidebar clear succeeded.
- [x] 43 targeted Python and 20 frontend tests pass; changed backend mypy passes.
- [x] Final frontend typecheck/build after final style/empty-state cleanup; diff
  whitespace validation passes. Generated Explorer CSS and host bundle rebuilt.
- [x] User activated/tested the latest changes and reports everything working.
- [x] User live acceptance of revised chrome and checkbox interactions.

## Selective-hunk Save follow-up

- [x] User approved existing pipe write, full-draft reconciliation, tests/docs/build;
  no runtime transitions or publication. Discovered Android-shell draft untouched.
- [x] Forward exact UTF-8 edits share the canonical contextual hunk builder; submit
  multiple hunks once per file to existing fs.textEdits.apply.
- [x] Preflight retained project/draft/disk/base identity, service limits and shared
  active-edit slot; no new Rust patch implementation.
- [x] Preserve latest full draft content, advance base, recompute remaining hunks.
- [x] Caller cancellation shielding, attempted-receipt replay guards, explicit
  post-write reconciliation errors, and sequential cross-file failure behavior.
- [x] Same-content conditional mirrors update editor base/dirty state without
  model replacement or artificial WBA text edits.
- [x] Partial selection Save enabled; new-file drafts retain whole-file Save.
- [x] 52 targeted Python tests and 22 frontend tests pass. Six changed backend
  modules pass mypy; TypeScript check and frontend build pass. Includes Unicode/
  CRLF, early deletion/later hunk coordinates, full clean, newer draft preservation,
  stale disk, caller cancellation, unknown write failure and post-write sidecar errors.
- [x] User reports latest changes tested working; runtime/client activation
  remains user-owned.
- [x] User live acceptance of selective Save; no separate earlier-block-deletion
  live scenario claim is inferred. That case is covered by automated tests.

## Other known tests

- [ ] Separate existing test issue: suppressed-preview MRU assertion in
  change_statistics.test.mjs fails against committed renderer too; see PLAN.md.
