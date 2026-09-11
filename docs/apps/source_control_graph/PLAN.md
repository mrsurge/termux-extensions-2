# Source Control Graph And Historical Second Editor

## Scope And Status

Planning baseline: `feature/source-control-graph`, created from main
`632354d0` following release `0.2.347`. This document records the requested design
and source investigation. Implementation is approved and the first graph-vendoring
checkpoint is underway; see TRACKER.md for completed work and remaining scope.

Add a read-only History tab beside By contents, By changes, Drafts, and
Diagnostics in the Explorer overlay. Commit headers show the real ancestry graph,
subject/hash/ref labels and numeric additions/deletions. Expand a commit to see
file names and per-file numeric additions/deletions, with graph lanes continuing
through those rows. There is NO document text or inline hunk body in this tab.

Clicking a file replaces the second window's displayed content with its full-file
historical diff, read-only on both sides, with syntax highlighting only. The
primary editor is unaffected. No stage, commit, checkout, restore, draft editing,
or automatic changes to the existing Explorer comparison selector originate here.
The Source Control working-changes/top-half UI is not part of this slice.

## Exact Upstream Source Inventory

The current `worktrees/vscode-te2-diff` checkout does not contain the SCM module.
Use `worktrees/code-server/lib/vscode`, revision
`591199df409fbf59b4b52d5ad4ee0470152a9b31`. That checkout has unrelated local
patches, but the five SCM files below have no local diff against that revision.
Do not modify either nested checkout.

Source paths below are relative to that VS Code root:

| Full source file to copy | Purpose and planned adaptation |
| --- | --- |
| `src/vs/workbench/contrib/scm/browser/scmHistory.ts` | 607-line graph module. Retain the actual lane algorithm, SVG graph renderer, placeholder lanes, ref ordering and colors. Adapt imports/theme/DOM/localization dependencies; do not substitute a newly written graph algorithm. |
| `src/vs/workbench/contrib/scm/common/history.ts` | Original history DTO/provider/view-model definitions. Adapt provider types to our typed service boundary; preserve parent IDs, lane models and statistics semantics. |
| `src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts` | 2,248-line view source, copied in full before patching. Retain/adapt commit renderer, change renderer, graph placeholders, lazy children and open dispatch. Remove workbench registration, SCM provider picker, chat, drag-to-chat, mutations and other unsupported actions in explicit patches. Do not silently replace the file with a lookalike renderer. |
| `src/vs/workbench/contrib/scm/browser/media/scm.css` | Full original stylesheet as the provenance baseline. Scope the adapted history styles to the new tab; unrelated SCM styles must not leak into Explorer or the editor. |
| `src/vs/workbench/contrib/scm/test/browser/scmHistory.test.ts` | 963-line upstream algorithm suite. Keep cases and assertions; adapt only imports and test-runner/lifecycle glue where necessary. Add TE2 integration tests separately. |
| `LICENSE.txt` | Preserve the upstream MIT license and Microsoft source headers, plus our existing attribution convention. |

Proposed destination: `app/apps/code_te2/src/explorer/history/vscode_scm/`,
with original relative subpaths under `upstream/`, reviewable adaptations under
`adapted/`, a patch series, and `UPSTREAM.md` containing source revision, file
hashes, license, reproduction command and an import/dependency ledger. Exact
originals stay byte-identical. Only adapted runtime files enter the bundle.
Every adapted file must be reproducible from the originals and patch series.
This is literal upstream source reuse, not a behavioral reimplementation.

Important upstream seams:

- `toISCMHistoryItemViewModelArray` computes input/output lanes from parent IDs.
- `renderSCMHistoryItemGraph` renders commit nodes and edges.
- `renderSCMHistoryGraphPlaceholder` continues lanes through expanded file rows.
- `HistoryItemRenderer`, `HistoryItemChangeRenderer` and the data source in the
  view pane own the expandable structure. File children receive output lanes.
- `_onDidOpen` dispatches historical resources to a separate diff editor.
- Upstream's commit statistics exist in the DTO/hover; the inspected file-change
  DTO lacks per-file numstat. Visible commit/file +/- summaries are explicit TE2
  extensions, not a claim about unmodified upstream behavior.

Resolve the import closure before integrating the pane. Prefer existing vendored
Monaco primitives where accessible; otherwise record additional exact upstream
files or small typed platform adapters. Do not create fake workbench services or
an unbounded copy of the entire workbench. If preserving the pane's actual source
requires a materially larger dependency transplant, stop and review that scope.

## Framework And DTO Boundary

Existing source: `framework/rust/crates/te2-server/src/framework_services/`:
`git_ops.rs`, `scheduler.rs`, `pipe/git_pipe_ops.rs`, and filesystem/text-edit
services. Python entry adapter: `app/apps/code_te2/worker_services/git_service.py`.

Current `git.history` walks from HEAD, returns up to 500 rows, and has no parent
IDs, ref decorations or continuation cursor. Do not repurpose that bounded menu
contract incompatibly. Add versioned typed graph/read APIs on the existing Git
pipe service; method names are to be finalized during contract implementation.

Required data:

1. Bounded graph pages: immutable commit IDs, ordered parent IDs, metadata, refs,
   snapshot identity and continuation. Capture branch/tag tips once per graph
   generation; deterministic topological ordering must preserve merge topology.
2. Commit/file statistics: selected commit versus its pinned parent, statuses,
   old/new paths, additions/deletions, binary flag and explicit loading/error
   state. Unknown/binary counts are not zero. Load children on expansion.
3. Historical file pair: pinned original/modified blob IDs, paths, decoded text,
   language hint and size/encoding status. Root commits and added/deleted files
   use an explicitly absent side; renames use the correct old/new paths.

Proposed first-parent comparison for merge commits matches the inspected upstream
open path; label the parent explicitly. Alternative-parent selection is a later
extension unless requested. A root commit compares to the empty tree. Do not
compare these rows to disk or silently use the mutable Explorer comparison ref.

Entire history means progressively reachable history, not an unbounded initial
query. Proposed initial defaults: 100 commits/page, hard 500/page, bounded file
pages and byte budgets. Final limits require tests. Send graph metadata before
expensive statistics finish; statistics may arrive in bounded batches. No first
paint waiting on totals or every commit's changed files. Cancellation must stop
native traversal work cooperatively, not merely discard its final response.
Avoid an RPC per row; cache immutable commit/blob results within explicit budgets.
Preserve lanes across pagination; compare paged layout to a single upstream run.

Rust owns Git computation, traversal, stats and blob reads. Python owns project,
client, request generation, orchestration and projection. The browser renders
DTOs and computes the upstream graph geometry. Use existing websocket/MessagePack
lanes and framework pipe services, not WBA or a new HTTP/polling transport.
Ref changes refresh the graph through existing Git facts with coalescing and stale
result fences. Disk/draft changes do not invalidate immutable historical blobs.

## Phase 2 Investigation: Read Scheduling And Transport

The existing `git_history` in `framework_services/git_ops.rs` calls
`revwalk.push_head()`, collects at most 500 commits, and returns no parent IDs or
continuation state. Leave that menu API unchanged. New History metadata must not
call file diff/statistics computation before publishing its first graph page.

The current `scheduler.git_history` uses the ordinary `git_read` semaphore and
`spawn_blocking`. The latter keeps native work off Tokio, but does not prevent
long history/statistics work from occupying permits needed by editor baselines.
History admission therefore needs a bounded independent read budget. Cancellation
must be checked after admission as well as during traversal; dropping an async
wait alone does not stop a started blocking operation.

The progressive Changes job is the existing example for bounded event queues,
cooperative cancellation and job completion. Reuse those mechanisms where their
contracts fit, without pretending History is a content-search result or changing
the existing search DTOs. Keep History on `service.git` and the Explorer lane.

`worker_services/git_service.py` still calls synchronous `pipe_runtime.call`.
The new History adapter must instead use the existing `pipe_runtime.call_async`
pattern in `worker_services/text_edit_service.py`, validating typed replies at
the boundary. Python owns generation and client routing, not native traversal.

Implementation order: metadata/ref snapshot and pagination; cancellable stats and
lazy file summaries; bounded pinned blob pairs; then Python lifecycle/projection.
Tests must distinguish native traversal cost from queue wait and first-page
publication. In particular, verify topological-walk startup cost before claiming
that bounded page size alone provides bounded first-page latency. The internal
`history_graph.rs` reader implements pinned metadata and retained traversal.
`history_sessions.rs` now exposes metadata-only open/next/close through the Git
pipe with its own bounded worker admission and typed asynchronous Python adapter.
Statistics and Explorer event/projection integration remain subsequent work.

## Second Editor Source Map And Required Changes

Paths below are relative to the repository root.

| Existing owner | Required change |
| --- | --- |
| `app/apps/code_te2/main_page/frontend/secondary-editor-state.ts` | Separate presentation mode (docked/collapsed/detached) from content kind (working file/historical diff). |
| `app/apps/code_te2/main_page/frontend/secondary-editor-runtime.ts` | Currently always connects host UI IPC, boots `bootInlineEditorHost`, and opens through `hostFileOpen`. Add a content lifecycle dispatcher before normal editor boot; historical mode must not execute this working-file path. Gate title/menu/issue/save controls by capability. |
| `app/apps/code_te2/main_page/frontend/mobile-secondary-editor.ts` | Generalize path-only commands, pending acknowledgements and retained iframe state to typed content descriptors. Preserve exact origin/source checks, drawer fullscreen, collapse and mobile focus routing. |
| `app/apps/code_te2/main_page/frontend/connections/ui-ipc.ts` and `src/ui_ipc/rpc_contract.ts` | Carry validated exact-client historical-open notifications through the established host lane. Explorer intent enters Explorer backend, then host backend hook, not a cross-lane frontend call. |
| `app/apps/code_te2/ui_ipc/`, `host/recent_files_backend.py`, `open_state_backend.py` | Add backend-owned secondary content state and a guarded transition away from a working foreground. Reuse exact-client foreground release without removing shared membership or drafts. Prevent reconnect snapshots from reopening the old working file over a historical view. |
| `app/apps/code_te2/monaco_editor/inline_host.ts`, `m_editor_app.ts`, Monaco boot/tokenizer helpers | Audit reusable syntax/theme/Monaco boot versus WBA/editing wiring. Build a dedicated historical diff lifecycle using the existing Monaco distro; no fork rebuild unless investigation proves it necessary. |
| `desktop_client/electron/src/main/secondary-editor-registry.ts` | Currently stores a pending file path. Accept validated typed content descriptors, preserve the existing WebContentsView/window and docking lifecycle, and reject stale commands. |
| `desktop_client/electron/src/shared/app-view-contracts.ts`, `src/preload/app-view-preload.ts`, `src/main/index.ts` | Extend the exact-view IPC allowlist and serializers for content descriptors; maintain working-file compatibility and reject unsupported native capabilities explicitly. |

Historical identity includes project, both immutable commit/blob identities and
old/new path. Use a dedicated non-file URI namespace. Never reuse a live file URI
for historical text. Do not retain historical models in WBA's working set or
ProjectSidecar recents. They do not consume the 12 working-file slots.

Opening history replaces the secondary view, not the user's underlying file.
Before releasing a working view, preserve/flush its pending draft through existing
lifecycle guarantees; never implicitly save or discard it. Keep shared documents
retained for other clients. Fence late editor/WBA notifications and release only
the secondary facade. Leaving historical mode disposes both read-only models and
listeners before resuming ordinary editing. One latest request wins per client.

Both diff sides are read-only and original editing is disabled. Save, Save As,
draft discard, format, code actions, diagnostics, semantic tokens, inlay hints and
WBA registration are absent. Copy, selection, scrolling, Find and syntax
highlighting remain. Audit the tokenizer's standalone boot and provider URI
selectors: merely avoiding a WBA socket is not proof that intelligence is skipped.
Disable editing actions in the mobile translucent rail and special-key dispatch
without breaking read-only navigation or routing keys back to the primary editor.

Reconnect/collapse/detach restores the selected content kind and pinned descriptor,
not a legacy foreground path. Project changes clear incompatible content. Bound
snapshot lifetime/retention and refetch immutable blobs when required. Remote
Electron and both Android renderers must observe the same host contract.

## Future UI Extension Views

Use a small content-host lifecycle (mount, activate, suspend, dispose and typed
capabilities) to avoid permanently hardcoding a file path into the second window.
Only working-file and historical-diff kinds are implemented in this slice.
A future UI VSIX kind must reuse Sidebar ledger identity, sandboxing, native
surface ownership and extension lifecycle. It must not turn historical-view
commands into arbitrary URL/eval or duplicate an existing extension renderer.
Actual UI VSIX relocation needs a separate approved design and acceptance pass.

## Phases And Validation

1. Vendor exact upstream files and attribution; prove adapted graph output with
   upstream tests and document the minimal pane dependency closure.
2. Add bounded Rust graph/stat/blob DTOs and Python adapters, including streaming,
   cancellation, immutable snapshots, ref-change events and typing tests.
3. Add typed second-editor content lifecycle for mobile/Electron and syntax-only
   historical viewer; verify draft preservation, reconnect and disposal first.
4. Integrate History tab, lazy commit/file summaries, stats and historical-open
   actions using the vendored renderer. Keep all mutation actions absent.
5. Validate end-to-end, update CODE_TE2.md and condensed repo memory, obtain live
   acceptance, then commit/push only when requested.

Test graph merges/multiple roots/ref changes/page boundaries; root/merge commits;
renames/additions/deletions/binary/oversized/invalid-encoding files; working-file
replacement with unsaved drafts; fast repeated clicks, project switches and
reconnect; read-only enforcement on both sides; zero WBA intelligence traffic;
Gecko/Cefrium touch/keys/fullscreen and Electron dock/detach; existing search tabs.
Measure time to first graph page, stats arrival, file expansion and diff open on
mobile, alongside unaffected primary file-open latency and bounded memory.

Run changed Rust unit/contract tests and Cargo checks, strict Python/Basedpyright,
frontend tests and `npm run typecheck` plus `node build.mjs`, and Electron
contract/type tests. Native Android edits/builds, version bumps, asset publication
and shared framework restart each require explicit approval. No build is needed
for this planning-only turn.
