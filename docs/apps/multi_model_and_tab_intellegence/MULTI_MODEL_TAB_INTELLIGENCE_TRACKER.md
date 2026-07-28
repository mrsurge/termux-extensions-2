# Multi-Model And Tab Intelligence Tracker

## Current Status

- Branch: `feature/multi-model-tab-intelligence`
- Planning: complete
- Implementation: Phases 1 through 5 implemented; Phase 6 background
  Explorer/Problems projection live-validated
- Runtime behavior changed: WBA retains the Python-materialized sidecar open
  set across active tab switches and projects the complete set as synthetic
  extension-host tabs
- Frontend bundle changed: rebuilt with no frontend source changes
- Android scope: none
- Live acceptance: inactive `checker.py` produced 51 BasedPyright markers while
  `.repo_memory.md` remained the active file

## Hard Invariants

- [x] No background reconciliation await is added before
      `editor_open_complete`.
- [x] The active browser keeps one Monaco model.
- [x] Active document edits remain direct browser -> WBA.
- [x] Python uses the existing Framework-Shells pipe for WBA control.
- [x] Sidecar recents remain the 12-entry logical open-set authority.
- [x] Sidecar `last_file` remains active-file authority.
- [x] Frontend localStorage remains visual-order authority only.
- [x] Normal tab switching does not emit document close/open churn.
- [x] Canonical tab close is the ordinary per-document release trigger.
- [x] Project/session generation rejects stale reconciliation.
- [x] Android files and bundled assets remain out of scope.

## Baseline Findings

- [x] Confirmed active payload materialization already prefers unsaved sidecar
      draft content over disk.
- [x] Confirmed visible Monaco open completion does not await WBA hydration.
- [x] Confirmed active frontend language traffic uses the direct WBA lane.
- [x] Confirmed Python has a correlated Framework-Shells pipe RPC path to WBA.
- [x] Confirmed WBA already injects synthetic extension-host documents.
- [x] Confirmed synthetic add/change/remove operations produce extension-host
      document lifecycle events.
- [x] Confirmed the current WBA active open removes the previous document.
- [x] Confirmed the current WBA background set is URI-only and disk-only.
- [x] Confirmed normal frontend model switches currently delete retained URI
      diagnostics.

## Phase 1: Shared Draft-Aware Materializer

### Design

- [x] Define one typed materialized-document result.
- [x] Extract draft-wins behavior from `_read_file_payload()`.
- [x] Keep preferences and view-state decoration outside the content
      materializer where practical.
- [x] Preserve replacement decoding behavior for non-UTF-8 bytes.
- [x] Preserve current base/content SHA behavior.
- [x] Decide language-ID derivation owner without adding active-open work.

### Implementation

- [x] Add the shared materializer under the editor backend services.
- [x] Make active editor payload construction call the shared implementation.
- [x] Add an async background wrapper using a worker thread.
- [x] Verify the active path performs no additional read or hash pass.

### Validation

- [x] Clean disk file test.
- [x] Unsaved draft-wins test.
- [x] Clean cached entry falls back to disk test.
- [x] Missing/unreadable file test.
- [x] Content/base SHA test.
- [x] Active payload compatibility test.

### Stop Gate

- [x] Compare active payload output and structural read/hash work before
      proceeding.
- [x] Stop if extraction adds visible-open latency or changes content semantics.

## Phase 2: Unified WBA Document Registry

### Design

- [x] Replace `backgroundDocuments: Set<string>` with a typed registry.
- [x] Define active, background, and provisional-background roles.
- [x] Keep one extension-host document identity per URI.
- [x] Separate WBA document version from sidecar and Monaco revisions.
- [x] Define content-identity and active-epoch stale-write guards.

### Implementation

- [x] Implement retain.
- [x] Implement full-text replace through `$acceptModelChanged`.
- [x] Implement active promotion without duplicate document add.
- [x] Implement active demotion without document removal.
- [x] Implement canonical release.
- [x] Implement project/session reset.
- [x] Update `$tryOpenDocument` to use the same registry.
- [x] Remove the URI-only background set after all callers migrate.
- [x] Project every retained canonical document through one complete synthetic
      extension-host tab model.
- [x] Publish a missing background document before language activation so a
      newly started language client discovers the complete logical open set.

### Validation

- [x] Duplicate retain emits one `addedDocuments`.
- [x] Replace emits change without close/open.
- [x] Promote emits editor state without document add.
- [x] Demote removes only active editor state.
- [x] Release emits exactly one `removedDocuments`.
- [x] Reset closes all retained documents.
- [x] Duplicate extension-host document add is prevented by registry identity.
- [x] Missing hydration emits `addedDocuments` before `onLanguage` activation.
- [x] Failed activation rolls back only the provisional background document.

### Stop Gate

- [x] Prove an active/background role transfer without LSP lifecycle churn.
- [x] Confirm role transfer requires no frontend open-transaction wait.

## Phase 3: Revisioned Pipe DTOs

### Membership

- [x] Add `vscode.logicalDocuments.reconcile`.
- [x] Include project path.
- [x] Include project generation.
- [x] Include open-state revision.
- [x] Include active path as exclusion/protection metadata.
- [x] Include background document descriptors only.
- [x] Return missing/stale hydration requests.

### Hydration

- [x] Add `vscode.logicalDocuments.hydrate`.
- [x] Include exact materialized text.
- [x] Include language ID.
- [x] Include content and base identity.
- [x] Include dirty state.
- [x] Reject stale generation/revision/active epoch.

### Validation

- [x] Round-trip DTO tests.
- [x] Stale revision rejection test.
- [x] Stale project generation rejection test.
- [x] Active document protection test.
- [x] Large text payload test.
- [x] One failed document does not abort the snapshot test.

### Stop Gate

- [x] Confirm the DTO methods use the existing JSON-RPC dispatcher/stdio pipe;
      the Phase 4 caller remains `adapter_rpc()` and no new transport exists.

## Phase 4: Python Open-Set Reconciler

### Scheduling

- [x] Add a focused background reconciliation service/projector.
- [x] Subscribe to `OpenStateChanged`.
- [x] Subscribe to adapter workspace-ready/reset lifecycle.
- [x] Subscribe to WBA `document/activeChanged` through the existing pipe.
- [x] Subscribe to draft changes that alter background contents.
- [x] Subscribe to existing workspace-file facts for clean background changes.
- [x] Cancel or supersede older per-project work.
- [x] Return from serial event-bus handlers before materialization/RPC.

### Snapshot Derivation

- [x] Filter active path from recents without mutating the source list.
- [x] Preserve sidecar order only as a hydration priority hint.
- [x] Enforce 12-entry canonical bound.
- [x] Ignore invalid/missing/out-of-project clean files.
- [x] Retain valid unsaved drafts even when no disk file exists.
- [x] Carry current project generation and open-state revision.
- [x] Resolve language identity in WBA from extension contributions.

### Hydration

- [x] Send membership metadata first.
- [x] Materialize only WBA-requested missing/stale paths.
- [x] Run reads, hashing, and large encoding off the asyncio event loop.
- [x] Send one document at a time.
- [x] Yield between large sends.
- [x] Stop promptly when superseded.
- [x] Reject draft/stat identity races before pipe hydration.

### Validation

- [ ] Live cold 12-tab startup.
- [x] Automated 12-entry bound and requested-only hydration.
- [x] Warm metadata-only tab switch.
- [x] Rapid revision supersession/coalescing.
- [x] Browser/WBA active-model replay through `document/activeChanged`.
- [x] WBA restart reconciliation.
- [ ] Live project switch cancellation.
- [x] Background draft change reconciliation.
- [x] Missing file release.

### Stop Gate

- [ ] Use diagnostics/open latency probes to verify no active-open regression.
- [ ] Stop and redesign if Python event-loop contention delays editor open.

## Phase 5: Active/Background Adoption

- [x] Preserve the existing visible-open transaction boundary.
- [x] Demote previous active document to provisional background.
- [x] Promote an already retained target document.
- [x] Add a missing active document only once.
- [x] Apply direct frontend text as the active semantic authority.
- [x] Prevent late Python hydration from overwriting newer active text.
- [x] Confirm the authoritative snapshot or release provisional documents.
- [x] Keep the current latest-wins frontend WBA open scheduler.

### Validation

- [x] A -> B -> A retains both LSP sessions.
- [x] No `didClose(A)` on A -> B.
- [x] No second `didOpen(A)` on B -> A.
- [x] Active draft text wins over a late background snapshot.
- [x] Switching during background hydration remains correct.
- [x] Visible open succeeds when WBA is unavailable.

### Stop Gate

- [x] Reject any implementation that puts adoption acknowledgement before
      `editor_open_complete`.

## Phase 6: Diagnostics Retention

- [ ] Replace destructive leave-model clearing with projection detachment.
- [x] Keep marker-store entries for logical background URIs.
- [ ] Reapply retained markers after active Monaco model creation.
- [ ] Keep active toolbar counts scoped to the active URI.
- [x] Keep Explorer/Problems projections multi-URI.
- [ ] Clear one URI on canonical release.
- [ ] Clear all URIs on project/session reset.
- [ ] Guard late diagnostics by generation/version.

### Validation

- [ ] Squiggles restore immediately when returning to a tab.
- [x] Background tab diagnostics update while another tab is active.
- [ ] Closed tab diagnostics disappear.
- [ ] Project switch leaves no stale diagnostics.
- [ ] Diagnostics storms do not delay visible opens.

### Live Evidence

- [x] Fresh app-worker/WBA startup reconciled `checker.py` as a missing
      background Python document.
- [x] Python supplied the exact materialized model while another file remained
      active.
- [x] BasedPyright published 51 markers for `checker.py` without an active-tab
      switch.
- [x] Python retained the background projection as one file with 51 markers.
- [x] The host Problems drawer rendered `checker.py` with a 51-error badge
      while its file tab remained `aria-selected="false"`.

## Phase 7: Semantic Acceptance Matrix

### Open-files-only mode

- [ ] One open draft and disk dependencies.
- [ ] Multiple open drafts with cross-file imports.
- [ ] Background draft changes diagnostics in the active file.
- [ ] Active draft changes diagnostics in a background file.
- [ ] Closing a tab removes it as a diagnostic root.

### Workspace mode

- [ ] Logical open overlays combine with disk-backed tracked files.
- [ ] Open draft overlays remain authoritative for their URIs.
- [ ] Closed tracked files continue to use disk content.

### Lifecycle

- [ ] Save does not close/reopen the document.
- [ ] External clean-file change rehydrates the background document.
- [ ] External change cannot overwrite an unsaved draft.
- [ ] Worker restart reconstructs the open set.
- [ ] WBA restart reconstructs the open set.
- [ ] Browser reload preserves the WBA set.
- [ ] Project switch closes the old set.

## Performance Acceptance

- [ ] Capture pre-change visible-open baseline.
- [ ] Capture post-change visible-open results using the same files/device.
- [ ] Verify no new await exists before visible open completion.
- [ ] Verify warm tab switches send metadata only.
- [ ] Verify initial background hydration is paced and bounded.
- [ ] Verify Python Socket.IO responsiveness during cold hydration.
- [ ] Verify WBA direct provider latency remains unchanged.
- [ ] Record memory use for 1, 6, and 12 retained WBA documents.

## Contingency Decision Gate

Move stronger live-buffer ownership into WBA if any of these become true:

- [ ] Python full-content reconciliation repeatedly races active edits.
- [ ] Large background hydration causes app-worker event-loop latency.
- [ ] Role transfer cannot preserve one extension-host document identity.
- [ ] Correctness requires frontend open to wait for Python/WBA convergence.

If triggered:

- Python remains sidecar membership and orchestration authority.
- Python supplies cold disk-plus-draft reconstruction/checkpoints.
- WBA owns retained live semantic buffers and LSP versions.
- Monaco owns foreground edits.
- Visible frontend opens remain independent and nonblocking.

## Required Validation Commands

The exact focused test commands will be finalized with implementation, then
the owning suites must include:

```text
Python strict type checking for changed backend modules
Python focused unit tests for materialization and reconciliation
WBA TypeScript typecheck
WBA focused lifecycle/dispatcher tests
Code TE2 npm run typecheck
Code TE2 node build.mjs
git diff --check
```

Android asset publication and APK builds are not part of this tracker.

## Completion Record

- [ ] Implementation approved.
- [ ] All phases completed.
- [ ] Live mobile validation completed.
- [ ] Live desktop validation completed.
- [x] `.repo_memory.md` updated with the verified current architecture.
- [ ] Commit created only after user review.
- [ ] Push performed only after user request.
