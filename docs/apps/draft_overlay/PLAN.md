# Explorer draft overlay projection

## Approved scope

Fix the non-destructive presentation bug where discarding one draft removes the
remaining overlay content until refresh or another edit. Keep backend ownership,
atomic snapshots and item-based eviction. No live draft mutations, client
publication, compiled-domain activation or shared framework restart are approved.

## Source-backed cause

`explorer_runtime._broadcast_review_state_for_project` broadcast lightweight
entries with empty hunks after discard. `runtime_notifications` later published
full entries, and explicit refresh also returned full entries. The frontend
unconditionally replaced its list for all such events. Mutation acknowledgements
also reused `explorer.review.entries.updated`; payloads without entries were
interpreted as an empty list. The store's drafts were not deleted by this UI bug.

## Implementation

- One `ReviewProjectionOwner` serves initial requests, bootstrap and live updates.
  It serializes reads off-loop, keys complete rows by draft hash/disk identity,
  and caches unchanged entries. Sidecar membership/revision is read strictly and
  checked again after computation; failure/supersession cannot commit eviction.
- Complete snapshots carry project root/generation, worker projection ID and
  monotonic revision. The frontend validates and swaps membership atomically,
  rejects stale/wrong-project/malformed updates and reuses unchanged row objects.
  Missing items in a complete accepted snapshot are evicted individually.
- The review renderer retains unchanged DOM groups and selection. Loading/error
  status does not destroy the last complete view. Mutation acknowledgements use
  distinct completion methods, never a missing-entries state update.
- Draft notifications use existing LatestProjection coalescing rather than
  cancelling a running off-thread snapshot build.
- Backend source changes require matching mypyc build/activation and worker
  refresh; frontend changes require matching native-client asset publication.

### Cold-restoration correction

The first live run exposed a missing prerequisite: a restored active project can
reach Drafts before History/search/project-switch establishes the event bus
generation. None therefore does not by itself prove staleness. Snapshot admission
now verifies the backend's active project path before initializing the shared
generation when absent. It rechecks both path and generation after waiting for
the snapshot lock and after off-loop work. Old-project requests cannot mint a new
generation, and a queued request cannot survive a switch. Regression coverage
starts with the real fact bus at generation zero, not a mocked initialized epoch.
This correction is Python-only; existing rebuilt frontend assets remain current.

## Approved hunk reversion and context

ProjectSidecar stores full draft models (`content`, hashes and document revision),
not only patches. User approved three surrounding context lines in review hunks
and a confirmed Revert hunk action. Shared inline-editor diff generation remains
zero-context; review-only `review_hunks.py` uses three lines and standard grouping
of nearby edits. It derives display ranges and exact replacement spans from the
same keepends-aware diff, preserving Unicode, line endings and missing final
newlines. Only changed spans are reversed; surrounding context is not replaced.
Oversized previews suppress that file's hunks with a warning, not other drafts.

`explorer.review.revertHunk` uses the authenticated Explorer lane and backend
project/item identity, never client-supplied edit text or arbitrary ranges.
Projection receipts include worker/generation, draft hash/revision and disk stamp.
The owner validates retained membership, project, disk hash/stamp and current
draft before computing a replacement off-loop. Final source checks and the strict
sidecar compare/commit are synchronous on the owning worker loop, without a
suspension. Persistence errors propagate; no success-shaped in-memory fallback.
Disk is read only. Partial reversion retains the draft's original save base guard;
if its entire content now matches disk it becomes clean. Bulk Save/Discard still
operate on whole files; hunk-level Save is not included.

The existing backend editor mirror and draft-notification lanes publish results.
Conditional mirrors carry the expected prior content hash: receiving editors
preserve newer unpublished local content instead of overwriting it, and only
matching buffers bypass the normal mirror hot window. Successfully applied
guarded mirrors notify WBA through the existing document-change publisher.
Pending/uncertain mutations are not automatically replayed. The compare/commit
contract is worker-owned; it does not claim an OS-level transaction with arbitrary
external writers to the private sidecar.

## Approved Explorer overlay chrome and selection tree

Drafts reuses By Changes' file toggle/body, hunk header row/toggle, shared path
labels, compact aligned actions and sticky scope boundaries. Header clicks expand
or collapse; only diff rows navigate. Every file and hunk has a checkbox. File
selection selects all children; partial selection makes the parent indeterminate.
Unchanged projection identities retain DOM, expansion and selection. Changed or
evicted file identities clear selection rather than retargeting selected indexes.

Revert Selected confirms once, then submits selected indexes together per file
through the existing guarded hunk RPC. All selected edits in one file are computed
against the same original model and committed once; multiple files are sequential,
not a cross-file transaction. Errors stop remaining work without automatic retry.
Initially Save Selected Files was disabled for partial selections. The separately
approved selective Save follow-up below supersedes that restriction. The file
Discard action remains available independently,
including when an oversized file cannot provide hunk previews. Disk-write and
draft-authority ownership remain unchanged. Backend additions need a matching
mypyc activation/worker refresh; frontend assets need separate publication.

## Approved selective-hunk Save

`explorer.review.saveHunks` accepts retained file identity and selected hunk indexes
on the Explorer lane. The canonical keepends-aware review diff also supplies
forward disk edits using UTF-8 byte offsets and exact expected text. All selected
hunks for one file go through existing `fs.textEdits.apply`/`apply_disk_edits` once,
against the captured disk hash. The Rust service remains write/path/encoding
authority; no new patch engine is introduced. Before issuing, validate project,
draft revision/content, original draft base, disk stamp/hash and shared active-edit
ownership. Honor the service's existing 375 KiB input/output and 10,000 edit limits.
Its existing-file restriction remains: new files use whole-file Save only.

After confirmed disk write, read the latest authoritative draft and advance its
base hash while retaining its full content, including newer edits arriving during
I/O. This is permitted only while its prior base still matches the admitted disk
hash, with fresh revision/content compare/commit. Equal content/disk hashes mark
the draft clean; otherwise the new diff naturally excludes saved hunks and fixes
remaining coordinates. Draft removal/base changes, sidecar persistence errors or
a subsequent external disk change report `diskSaved=true,draftReconciled=false`,
never false failure implying rollback. Disk and sidecar are not a joint transaction.

Operation ownership is shielded from caller cancellation so post-write work can
finish. Retain one attempted receipt per file (bounded) to reject repeated use of
an uncertain write; no automatic retries or rollback. Multi-file actions remain
sequential and stop on error. Publish existing FileSaved/Git/draft projection facts;
guarded same-content mirrors update editor base/dirty metadata without rewriting
the model or issuing an artificial WBA text change. No agent live mutations,
activation, shared framework restart or frontend publication are part of this slice.

## Separate existing test issue

`tests/change_statistics.test.mjs` expects clicking a suppressed-preview toggle
to mark `host.js` as MRU. It receives no MRU entries. An in-memory build of the
committed HEAD changes renderer reproduces the same result. This is outside the
draft overlay fix, not a newly introduced regression or a claimed runtime bug.
