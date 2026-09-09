# Selected Commit Inline Diff Plan

Branch: `feature/selected-commit-inline-diff`

## Goal

Restore inline commit comparisons against the commit selected in the Explorer,
while fixing related mobile touch, commit selection, and draft navigation bugs.
The branch started from upstream main at `a95cb8e6` (TE2 0.2.346).

The original scope and historical file-enumeration correction have passed live
acceptance. Commit `ba51875d` is the pushed checkpoint before the follow-up
direction below. Phase 1 is implemented and live-accepted; remaining phases begin
with source-backed investigation and concrete implementation/validation scope.

## Scope And Sequence

1. **Mobile touch handles during inline diff transitions.** Fix handle geometry
   when switching between plain and inline diff editors, including switching
   back without a page refresh.
2. **Explorer Git commit selector.** External commits must update a HEAD-following
   selector through Git facts, without first opening By changes. Show HEAD and
   the latest commit as one choice; preserve explicitly selected older baselines.
3. **Unified comparison workflow (combines the two remaining items).** Share the
   Explorer comparison selector with the editor and a new status-bar drop-up,
   and correct Drafts navigation as part of the same phase. Investigate existing
   authority and event paths before approving the concrete implementation.

## Unified Comparison Workflow

- Keep one backend-owned, project-scoped comparison selection, shared by the
  Explorer selectors, By changes, and inline commit comparisons. The status-bar
  drop-up mirrors and changes that same selector state, not a separate copy.
- Put the status control at the far left, before extension contributions.
  Show the active filename without its path and the comparison state:
  `file @ HEAD · hash`, `file @ hash`, `file @ disk`, or the filename in plain
  mode. Breadcrumbs already provide the path.
- Highlight historical/non-HEAD selection yellow in both the status control
  and Explorer selectors. Preserve HEAD-following versus pinned-ref semantics.
  Disk mode labels the actual disk comparison rather than suggesting Git data
  is being displayed; the menu can still expose the retained shared Git ref.
- The drop-up combines the existing commit choices with mutually exclusive
  plain, selected-commit, and draft-versus-disk modes. Use existing custom menu
  components, not native browser dropdowns or dialogs.
- Draft-versus-disk turns autosave off. Clicking a Drafts result applies draft
  mode and disk comparison before opening/jumping to that file. Commit and
  draft inline comparison must not both be enabled by this workflow.
- Disk comparison loads no Git baseline/content. Commit comparison loads the
  selected commit as the original and keeps the current editable file as the
  modified model; this is not checkout or historical-file replacement.
- Keep By changes current from Git facts and comparison-selection events, just
  as Drafts stays current. Reopening an overlay must not be required to repair
  its state. No polling or frontend-to-frontend authority shortcuts.
- Fence baseline results against project, file, mode, and selected-ref changes.
  HEAD movement invalidates HEAD comparisons but does not unpin older refs.
  Keep baseline work off the critical file-open completion path.
- Investigate missing historical paths, unborn repositories, cold restoration,
  reconnect, and multiple client surfaces before finalizing error behavior.

The combined control is especially important on mobile: Explorer is hidden when
closed and occupies the screen when open, so comparison state and selection
must also be available while editing.

## Constraints

- Preserve the existing Gboard input, touch dragging, and editor focus behavior.
- Reuse existing state projection, Git baseline services, and surface RPC lanes.
- Keep frontend file opening responsive; baseline loading must not introduce
  unnecessary blocking into the editor open path.
- Publish the touch extension from its editable fork. Do not hand-edit its UMD.
- Treat the parent repository and touch-extension fork as separate commit scopes.
- Android builds, APK seed updates, and release version changes are separate
  publication steps, not implicit requirements for each frontend fix.
- Later items remain pending investigation and detailed user requirements.
- The Explorer selector chooses the comparison baseline for By changes and,
  in the upcoming editor work, inline commit diffs. It is not a checkout command.
  Detached-HEAD workflows and checkout/history navigation are outside this branch.

## Validation

- Touch changes: build/typecheck the touch-extension fork, verify the published
  UMD matches its build output, and obtain live mobile acceptance across diff
  toggles. Inspect wrapped lines, scrolling, and changing gutter geometry when
  relevant to subsequent changes.
- Host/editor changes: run Code TE2 typecheck and frontend build, with focused
  behavioral checks for the affected baseline or navigation contract.
- Selected-commit comparisons: verify the displayed baseline matches the chosen
  commit and current file, including rapid file/commit changes and missing paths.
  Final behavior for exceptional cases is to be determined during investigation.

## Follow-Up Direction: Historical Worktree View

Extend the accepted comparison workflow into a historical repository view
without checking out a commit or creating a detached HEAD. The editable files
remain in the current worktree throughout.

| Action | HEAD view | Historical view |
| --- | --- | --- |
| Browse/edit | Yes | Yes, current worktree contents |
| Compare | HEAD baseline | Selected immutable commit baseline |
| Restore | From HEAD | From selected commit into current worktree |
| Stage/commit through Explorer | Yes | Disabled in UI and rejected by backend |

### Phase 1: Progressive By Changes

Implementation decision (2026-09-07): use native `search.changes.start` on the
existing search job scheduler and project its lifecycle through Explorer
sessions. The old request waited for enumeration plus every hunk before its
reply, while the frontend request timeout is eight seconds; this is a concrete
blocking contract, not a measured attribution for every reported timeout.

The first implementation streams individual files within bounded 40-file pages,
replaces the page on Next, and provides First page/retry. File bodies are capped
at 256 KiB, with explicit omission and enumeration-truncation notices. Each job
pins the commit and continuation validates candidate path/status/stat metadata.
Python retains continuation metadata only; Rust owns Git generation. This is
not an atomic worktree snapshot, and cancellation waits for a current libgit2
operation to return. Native ack/ordering, cancellation, continuation, historical
content, body limits, startup races, and incremental DOM have focused tests.
User live acceptance confirmed Phase 1 works. Dedicated first-result timing and
large-history/slow-client responsiveness measurements remain open.

- Investigate `explorer.search.run` latency across file enumeration, hunk
  generation, transport, and rendering. Large synchronous result generation is
  a timeout hypothesis, not yet a measured conclusion.
- Reuse the progressive content-search lifecycle and existing Rust pipe/app
  socket contracts where applicable: prompt job acknowledgement, streamed file
  summaries and hunks, explicit completion/error/cancellation, no polling.
- Freeze the selected commit hash for each job. Fence delivery by project,
  selection, mode, request generation, and live session; superseding a query,
  closing the overlay, or switching projects cancels obsolete work.
- Keep concurrency, message sizes, retained results, and queues bounded.
  Provide explicit continuation/truncation behavior rather than silently
  treating the current 40-file display cap as the whole change tree.
- Preserve existing results/expansion where practical while facts trigger a
  refresh. Do not restart an unbounded full-repository diff on every event.
- Validate first-result latency, cancellation, large histories, slow clients,
  out-of-order responses, reconnect, and active-editor responsiveness. A long
  job must not remain one request awaiting every hunk until RPC timeout.

### Phase 2: Historical Styling And Actual-State Warnings

- Maintain two independently identified projections: selected-commit-to-disk
  comparison for styling/results, and actual HEAD/index/worktree status for
  safety warnings and operations. Never infer one from the other.
- Explorer file/folder decorations follow the selected comparison, including
  aggregation and sticky scopes. Clicking a comparison-modified file in
  historical view enables selected-commit inline diff before navigation.
- Preserve draft, diagnostic, and other independent decoration semantics.
  Determine presentation of historical deletions/missing current files during
  investigation; do not make nonexistent files silently open as real files.
- Display an independent `🚨` badge for actual HEAD-relative modified/staged
  state while browsing history. Badges are DOM elements, never filename text
  used by rename/save/path operations.
- Keep actual state available for every displayed document. The active-document
  status bar shows applicable `Modified 🚨` and `Staged changes exist 🚨`
  indicators, including both when appropriate, only with a non-HEAD selection.
  Returning to HEAD hides all warning labels without clearing actual Git state.
  Draft status remains separately identified. Final wording/layout is subject
  to live acceptance.
- Project external edits, staging, unstaging, commits, and HEAD movement through
  facts; warnings cannot depend on operations originating in Explorer.
- Validate clean-against-HEAD/historically-modified files, staged-only changes,
  mixed staged/unstaged changes, drafts, sticky ancestors, and client reconnect.

### Phase 3: Guarded Historical Restore

- Approved draft policy: offer an explicit combined discard-draft-and-restore
  confirmation. A newer draft arriving during mutation must survive and produce
  a warning rather than being silently discarded by the refresh.
- The implementation uses prepare/unstage/apply on existing Explorer RPC, with
  captured project identity and bounded, expiring, single-use backend tokens.
  Rust preview fingerprints pin HEAD/source/index/disk; Python pins draft state
  and comparison/project generation. Unstage is a separate accepted mutation;
  cancelling the subsequent restore does not silently restage the file.
- Initial supported scope is regular files up to 32 MiB, opened at the repository
  root. Reject conflicts, symlinks, directories, and submodules. Renames require
  individual path operations. The final check/write interval is not exclusive
  against arbitrary external filesystem/Git processes.
- Phase 2 safety prerequisite (approved and implemented): stage/commit/reset
  are blocked in historical view; Phase 3 replaces the temporary Restore block.
  Missing historical files remain in By changes, not synthetic tree entries.
- Disable Explorer stage/commit controls in non-HEAD comparison views and enforce
  the same restriction in backend actions, including bulk and overlay entry
  points. Check canonical selection when executing, not a client-supplied flag.
- Reuse one backend restore operation. Historical restore copies from the
  selected immutable commit into the current worktree; it does not move HEAD,
  switch branches, or automatically stage/commit the result.
- Confirmation identifies the file and source commit, explains possible loss of
  existing edits, and distinguishes actual worktree/index changes from the
  historical comparison. Resolve the source shown to the user before execution;
  a changed source/state must not silently change the confirmed operation.
- If the file is staged, block restore and explain that it must be unstaged.
  Offer an explicit path-scoped unstage step before restore confirmation; warn
  that staged-only contents can differ from disk. Cancellation makes no further
  changes. Do not silently unstage unrelated files or bypass conflicts.
- Recheck selection, index/worktree state, and relevant draft revisions after
  confirmation. Reject/reconfirm stale intent if another client or external Git
  tool changed them. Investigate the strongest practical transaction boundary;
  do not promise exclusivity against arbitrary external processes.
- A file absent from the selected commit means deletion, with a distinct explicit
  warning. Investigate additions, deletions, renames, conflicts, and safe path
  handling before finalizing supported restore cases.
- Define draft reconciliation before writing disk: no silent draft discard,
  stale draft replay over restored contents, or unintended autosave overwrite.
  Publish the resulting disk/draft/Git facts through established ownership paths.
- Validate cancel, unstage-then-restore, changed state during confirmation,
  return-to-HEAD restore, cross-client refresh, and backend rejection of direct
  historical stage/commit requests.

### Phase 4: By Changes Actions And Large-Diff Presentation

- Add a restore control to each file header, using Phase 3's exact operation and
  confirmations. Label its source clearly; no separate destructive shortcut.
- Each hunk initially shows up to 50 displayed diff lines, including context.
  Longer hunks have a dark gradient blind and a button to reveal all remaining
  lines or retract to 50. The hunk header separately collapses its entire body.
- Keep file summaries, warnings, progress, and controls available while collapsed.
  Integrate lazy hunk delivery with Phase 1 where useful; expansion must not
  recreate the whole job or lose the selected comparison identity.
- Expansion is ephemeral DOM state only. Preserve existing rendered groups during
  progressive append; newly rendered results start with fresh controls. No
  persistent or backend expansion registry is introduced.
- Validate touch/desktop targets, header clicks versus restore clicks, keyboard
  accessibility, streamed totals, and large-result rendering cost.

These phases do not authorize an Android, release-version, or transport rewrite.
Existing state authority and native control-plane boundaries remain in force.

### Follow-Up Correction: Comparison Scheduling

Comparison intent must not await baseline or decoration materialization before
By changes can begin. Keep serial fact delivery, but schedule independent bounded
latest-only read projections. Selection notifications trigger enumeration;
selectionRevision/selectionOnly completion metadata prevents a second enumeration
without suppressing real worktree invalidations. A native read already running
finishes under a stale-output fence; replacing pending work must not create an
unbounded thread backlog. Mutation ordering remains untouched.

### Phase 5: Shared Text Edits, Hunk Restore, And Find/Replace

**Required next phase and branch merge blocker.** Deliver all three parts:
the shared framework edit method, per-hunk Restore, and content Find/Replace.
This replaces the former optional later-investigation scope. Implementation
details still require source investigation and concrete-plan approval.

Investigate a Rust-owned guarded text-edit operation reusable by per-hunk Restore
and content Find/Replace. Feature logic would produce exact edits rather than
round-tripping through textual patch syntax or an external patch process.
Verify revision/hash checks, encoding and line-ending preservation, draft versus
disk ownership, and existing editor/WBA/Git projection before implementation.
Per-hunk Restore must preserve edits outside the selected hunk, unlike the
explicit whole-file discard-and-restore operation. This extends Phase 4.

Both per-hunk Restore and Find/Replace write directly to disk regardless of
existing autosave preferences. Python checks draft presence/revision and obtains
explicit discard consent before dispatching a mutation. It does not materialize
drafts for matching or create replacement drafts. Newer drafts must not be
silently discarded. Rust validates the disk snapshot and preserves unrelated
bytes and index entries; existing facts project accepted changes to editors/WBA.

Define replacement scope, multi-file partial-failure reporting, cancellation,
encoding/line-ending preservation, and concurrent-client guards. Validate both
features against live draft and modified-file workflows, plus type checks,
automated regressions, and responsiveness checks. The branch is not merge-ready
until this phase receives user live acceptance.

#### Approved Search And Replacement Authority

By contents is the only Find/Replace home; reuse existing disk search options
and multiline semantics. The earlier draft-aware-search policy is superseded
by the user's explicit direct-to-disk decision. Both features stop for a draft
warning offering discard/cancel before dispatch. No extra dirty-HEAD warning
is required for Find/Replace; hunk Restore may show it as informational context.
Per-hunk Restore preserves all disk edits outside the exact selected hunk.
Neither operation changes autosave settings, stages, or commits. Draft preflight
belongs to Python; guarded persistence belongs to Rust.

Every match occurrence is a separate logical hit, including multiple occurrences
on the same line. Three matches on one line must produce three independently
addressable results, each with its own exact range and disk snapshot identity.
The UI must display each hit independently rather than deduplicating by line.
Counters and result caps count occurrences, not matching lines. Single-hit
replacement targets only that occurrence; bulk replacement includes every hit
within its explicitly selected scope.

#### Approved Bounded Replacement UI

- Preserve the existing 700-occurrence search cap. Replace All targets every
  retained hit in the completed search set, excluding dismissed files, not merely
  rendered rows and not additional matches beyond the cap. Disclose truncation.
- Provide Show All and Select All at the results top; Select All also shows all.
  Provide Replace Selected and Replace All. There is no Replace Visible action.
- Each file header has a desktop-UA-only checkbox, Replace All in File, Show All in File when
  presentation hides retained hits, and a `×` dismiss-file control. Dismissed
  files are excluded from selection and replacement for the current search.
- Each hit has a desktop-UA-only checkbox and an individual Replace control. Selecting a file
  reveals and selects all retained hits for that file. Counters count occurrences.
- Checkboxes are translucent until selection is active. On mobile user agents,
  long press on a hit or file header enters selection mode with a small hint;
  header long press reveals/selects the file group. While selecting, a header
  tap clears a fully selected group or reveals/selects every retained hit if
  any is unselected. Subsequent hit taps toggle
  selection instead of navigating. Mobile UAs never render checkboxes or reserve
  space for them, regardless of viewport width. An inset highlight marks selection
  without reducing text width. Desktop checkboxes remain directly usable.
- Replace controls are persistent/touch-accessible, never hover-only, and appear
  when replacement mode is expanded. Empty replacement is valid deletion.
- Add the replace-field caret/twisty to the vendored search widget and inset the
  search/replace area so its controls are not squeezed against the screen edge.
- Warn before Replace All when its scope includes hidden/unrendered retained
  hits. Showing all removes that visibility warning, not the independent draft
  discard confirmation. No extra dirty-HEAD warning is added.
- Reuse existing literal/regex/case/word/multiline semantics. Apply exact edits
  atomically per file; report partial failures explicitly without rolling back
  successful files. Selection/expansion/dismissal are ephemeral to the search.

#### Implementation And Test Sequence

1. Define and test the guarded text-edit primitive independently of UI and IO:
   exact original-text offsets, explicit UTF-8/UTF-16 conversion boundaries,
   expected content identity, overlap rejection, deterministic edit ordering,
   no-op behavior, and byte/line-ending preservation for supported encodings.
2. Integrate with existing Python draft ownership and Rust disk services:
   validate draft revision plus disk base, preserve permissions/index state,
   and publish accepted changes through established editor/WBA/Git facts.
   Specify per-file atomicity and report partial multi-file outcomes explicitly.
3. Add per-hunk Restore using the selected immutable baseline and exact current
   content. Tests must prove unrelated edits survive, stale hunks fail safely,
   and draft-bearing/staged files obey the established safety rules.
4. Add disk-snapshot replacement planning to By contents. Reuse the
   actual backend matcher rather than independently rerunning JavaScript regexes.
   Verify literal and regex replacements, captures, multiline LF/CRLF, Unicode,
   zero-width matches, overlapping ranges, result caps, and file filters.
   Add regressions for repeated matches on one line: distinct displayed hits and
   ranges, accurate occurrence counts, independent replacement of a later hit,
   and inclusion of all in-scope occurrences in bulk replacement.
5. Add By contents replacement controls and explicit replacement scope. Test
   selected replacement and bulk behavior against authoritative match sets,
   not just the currently rendered or truncated preview rows.
6. Exercise concurrent clients, edits during confirmation, project switches,
   cancellation before/after mutation, partial failures, and projection order.
   Run Rust/Python/frontend type and test suites, then obtain live acceptance.

## Follow-Up: DevTools Through TE2 MCP

Expose native-client DevTools through TE2 MCP for direct, target-specific
debugging rather than relying on volatile console telemetry. Investigate the
existing Cefrium CDP, GeckoView inspector, and Electron integration before
choosing the API and transport. Include target discovery, page/frame/worker
evaluation, runtime exceptions, worker startup/debugger state, and bounded
network/event capture, with explicit capability reporting per renderer.

The transport must preserve target/session identity and protocol routing,
including nested workers, reconnects, cancellation, and clean detach. Inspection
must not silently pause workers or require the native overlay to be open.
Provide explicit debugging actions, not an artificially read-only interface.
Agree on the concrete implementation and security scope after investigation.
This remains a separate backlog item, not authorization to change Android or
MCP as part of the historical-worktree phases.

## Source References

- Touch fork: `worktrees/monaco-touch-selection/src/index.ts`.
- Touch deployment: `app/apps/code_te2/static/vendor/monaco-touch-selection/`.
- Editor transitions: `app/apps/code_te2/monaco_editor/editor_editor_lifecycle.ts`.
- Touch initialization: `app/apps/code_te2/monaco_editor/editor_touch_menu_utils.ts`.
- Technical reference: `docs/apps/code_te2/CODE_TE2.md`, section 32.

See `TRACKER.md` for completed work, evidence, and pending decisions.
