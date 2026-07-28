# Multi-Model And Tab Intelligence Proposal

## Status

Planning complete. Implementation requires a separate approval.

This proposal preserves the current fast visible-file-open path while making
the sidecar-backed tab set the semantic open-document set seen by the
workbench adapter (WBA), extension host, and language servers.

## Primary Requirement

Visible frontend file opens must not become slower.

The implementation must preserve these structural rules:

1. The browser receives and installs the active file without waiting for WBA
   reconciliation.
2. `editor_open_complete` remains gated only by Monaco model installation and
   requested navigation verification.
3. Background model materialization, WBA retention, extension activation,
   diagnostics, and language-server work remain outside that completion path.
4. No new `await` may be added before visible open completion for background
   document work.
5. If a proposed model-lifecycle design cannot satisfy those rules, it must be
   replaced rather than compensated for with polling, longer timeouts, or
   frontend blocking.

## Goals

- Treat the sidecar-backed 12-file tab set as the logical open-document set.
- Keep exactly one active Monaco model in the browser.
- Keep every logically open background document open in the WBA extension
  host, including its materialized draft contents.
- Preserve LSP `didOpen` state across tab switches.
- Send LSP `didClose` only when a file leaves the canonical sidecar open set,
  the project changes, or the WBA session resets.
- Preserve URI-scoped diagnostics for background tabs and immediately restore
  their squiggles when they become active.
- Reconcile the complete logical open set after worker reload, WBA reconnect,
  and project switch.
- Reuse the existing Python -> Framework-Shells -> WBA pipe control path.
- Keep direct browser -> WBA language intelligence and active edit traffic on
  the existing hot path.

## Non-Goals

- Do not create 12 resident Monaco models in the browser.
- Do not reproduce the complete VS Code tab or editor-pane implementation.
- Do not route hover, completion, symbols, semantic tokens, inlay hints, or
  active document changes through Python.
- Do not add an HTTP endpoint, Socket.IO lane, or alternate WBA transport.
- Do not make the frontend wait for Python-to-WBA control-plane work.
- Do not make frontend localStorage authoritative for open membership.
- Do not use diagnostic clearing as a substitute for correct document
  lifecycle.
- Do not introduce a second background-document registry beside the existing
  WBA document lifecycle.

## Source-Backed Current State

### Canonical membership and active file

`ProjectSidecar.recent_files` is the bounded 12-entry tab membership set.
`ProjectSidecar.last_file` is the active file. The existing
`open_state_revision` is the monotonic membership/active-state revision.

Relevant source:

- `app/apps/file_editor_cm6/project_sidecar.py`
- `app/apps/file_editor_cm6/open_state_backend.py`
- `app/apps/file_editor_cm6/open_state_events.py`

The name `recent_files` is historical. The current file-tab implementation
already treats this list as canonical tab membership.

### Draft-aware active content

`editor_ws._read_file_payload()` already materializes the active file:

1. Read the sidecar session-cache entry.
2. Use cached draft text when the entry is unsaved.
3. Otherwise read disk text.
4. Return content, base hash, content hash, and dirty state.

This behavior should be extracted into a shared materializer rather than
duplicated for background documents.

Relevant source:

- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
- `app/apps/file_editor_cm6/history_store.py`
- `app/apps/file_editor_cm6/project_sidecar.py`

### Visible frontend open

`runEditorOpenTransaction()` currently:

1. Receives the Python-produced active-file payload.
2. Creates or replaces the one active Monaco model.
3. Applies language and navigation state.
4. Verifies visible open completion.
5. Starts WBA model hydration afterward without awaiting it.
6. Publishes `editor_open_complete`.

This boundary is correct and must remain intact.

Relevant source:

- `app/apps/file_editor_cm6/monaco_editor/editor_open_transaction_runner_main.ts`
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`

### Existing WBA document injection

WBA already injects documents directly into the VS Code extension host with:

- `ExtHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta`
- `ExtHostDocuments.$acceptModelChanged`

The extension-host implementation converts:

- `addedDocuments` into document-open events,
- `$acceptModelChanged` into document-change events,
- `removedDocuments` into document-close events.

This is sufficient for standard language clients to produce LSP
`didOpen`/`didChange`/`didClose` behavior. A real visible VS Code editor is not
required for a background document.

Relevant source:

- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/client/document-content.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/workspace/lifecycle.ts`
- `worktrees/code-server/lib/vscode/src/vs/workbench/api/common/extHostDocumentsAndEditors.ts`
- `worktrees/code-server/lib/vscode/src/vs/workbench/api/common/extHostDocuments.ts`

### Existing background-document gap

The existing WBA `backgroundDocuments: Set<string>` supports only a narrow
`$tryOpenDocument` case:

- it reads disk directly,
- opens version 1,
- marks the document clean,
- tracks only the URI,
- cannot update authoritative content,
- cannot release one document,
- cannot reconcile a logical open set,
- cannot transfer a document between active and background roles.

The active `openFile()` path also removes the previous document during a normal
tab switch. That behavior prevents multi-file LSP openness and must change.

### Existing reliable control path

Python already controls WBA through the Framework-Shells pipe:

```text
Python app worker
  -> workbench_adapter_shell_manager.adapter_rpc()
  -> Framework-Shells pipe stdin
  -> WBA JSON-RPC dispatcher
  -> correlated <<<RPC>>> response
```

The shell capability gate requires a pipe backend, stdin writes, and byte
stdout subscription. This is the correct path for open-set reconciliation.

Relevant source:

- `app/apps/file_editor_cm6/workbench_adapter_shell_manager.py`
- `app/apps/file_editor_cm6/shellspec/workbench_adapter.yaml`

## Authority Model

Authority is intentionally split by responsibility:

```text
ProjectSidecar.recent_files
  authority for logical open membership

ProjectSidecar.last_file
  authority for the active URI

Python draft materializer
  authority for cold/reconstructed disk-plus-draft text

Active Monaco model
  authority for live foreground edits

WBA document registry
  authoritative semantic mirror for the extension host and LSP session

Frontend localStorage
  visual tab order only
```

The required invariant is:

```text
WBA open document URIs
  ==
canonical sidecar tab URIs
```

For content:

```text
active URI:
  Monaco live text == WBA text

background URI:
  Python materialized text == WBA text
```

The browser does not need a background Monaco model.

## Proposed Runtime Topology

```text
                         ProjectSidecar
                    membership + active URI
                              |
                 OpenStateChanged revision fact
                              |
                +-------------+-------------+
                |                           |
        visible open projection      background reconciler
                |                           |
        Python active payload        Python materializer
                |                           |
        one Monaco model             Framework-Shells pipe
                |                           |
        direct WBA open/change       WBA document registry
                +-------------+-------------+
                              |
                    extension-host documents
                              |
                         language clients
```

The two paths converge in WBA but have different latency requirements:

- Active path: immediate and frontend-owned.
- Background path: eventual, revisioned, coalesced, and Python-orchestrated.

## WBA Document Registry

Replace the URI-only `backgroundDocuments` set with one registry used by both
active and background document operations.

Suggested internal shape:

```ts
interface RetainedDocument {
  path: string;
  uri: Record<string, unknown>;
  role: 'active' | 'background' | 'provisional-background';
  versionId: number;
  languageId: string;
  contentIdentity: string | null;
  openStateRevision: number;
  projectGeneration: number | null;
  dirty: boolean;
}
```

The registry owns these operations:

- `retain`: add a missing synthetic document exactly once.
- `replace`: full-text update an existing document without close/reopen.
- `promote`: attach the existing document to the synthetic active editor.
- `demote`: remove the synthetic editor facade but retain the document.
- `release`: remove the extension-host document and emit the actual close.
- `reconcile`: make background membership match a revisioned snapshot.
- `reset`: close and clear all documents for project/session teardown.

No operation may send `addedDocuments` for a URI already present. The VS Code
extension host rejects duplicate non-notebook documents.

## Active And Background Role Transfer

### Opening a new active tab

Assume A is active and B is selected.

```text
1. Python records B as last_file and keeps A and B in recent_files.
2. Python emits B's draft-aware active payload to the frontend.
3. Frontend installs B in Monaco and completes the visible open.
4. Frontend queues direct WBA open/change work without awaiting it.
5. WBA demotes A to provisional-background without removing its document.
6. WBA promotes B if already retained, otherwise adds B once and promotes it.
7. Python background reconciliation confirms A and all other background tabs.
8. Any provisional document absent from the authoritative revision is released.
```

The provisional role closes the race between the frontend hot path and the
Python control-plane snapshot. It prevents a normal tab switch from emitting a
premature `didClose` even when frontend activation reaches WBA first.

### Switching to an existing background tab

When B already exists in WBA:

- do not send `removedDocuments` for A,
- do not send `addedDocuments` for B,
- remove or replace only the synthetic active-editor facade,
- set B as active,
- apply the frontend's queued full-text change only if its text differs,
- preserve B's extension-host document identity and LSP open session.

### Closing a tab

Only sidecar membership removal authorizes release:

```text
sidecar removes URI
  -> open_state_revision increments
  -> Python reconciles background membership
  -> WBA releases URI
  -> extension host emits close
  -> language client emits didClose
```

Closing the active tab may select another recent tab through existing host
behavior. The replacement visible open remains independent of WBA release.

## Python Background Reconciler

The reconciler subscribes to backend facts but must not perform heavy work in
the serial event-bus handler.

The fact handler should:

1. Validate project generation.
2. Store the latest open-state snapshot by project.
3. Cancel or supersede an older pending snapshot.
4. Schedule one latest-wins reconciliation task.
5. Return immediately.

The task derives:

```python
background_paths = [
    recent["path"]
    for recent in open_state["recents"]
    if recent["path"] != open_state["openFile"]
]
```

This is filtering, not mutating or popping the sidecar list.

The reconciler must:

- process only the newest `open_state_revision`,
- carry project generation on every request,
- cap membership at the existing 12-file limit,
- materialize files outside the asyncio event-loop thread,
- hydrate one changed/missing document at a time,
- yield between large content sends,
- stop when superseded by a newer revision,
- never delay the existing editor/UI open-state fan-out.

## Reconciliation Protocol

Use the existing `adapter_rpc()` pipe path. The exact method names may change
during implementation, but the protocol should remain snapshot-based and
idempotent.

### Membership phase

```json
{
  "method": "vscode.logicalDocuments.reconcile",
  "params": {
    "projectPath": "/workspace",
    "projectGeneration": 8,
    "openStateRevision": 41,
    "activePath": "/workspace/b.py",
    "background": [
      {
        "path": "/workspace/a.py",
        "contentIdentity": "sha256:...",
        "languageId": "python",
        "dirty": true
      }
    ]
  }
}
```

WBA returns the paths that are missing or whose known content identity is
stale. This keeps ordinary tab switches metadata-only once the working set is
warm.

### Hydration phase

```json
{
  "method": "vscode.logicalDocuments.hydrate",
  "params": {
    "projectPath": "/workspace",
    "projectGeneration": 8,
    "openStateRevision": 41,
    "path": "/workspace/a.py",
    "text": "materialized disk plus draft text",
    "languageId": "python",
    "contentIdentity": "sha256:...",
    "baseSha256": "sha256:...",
    "dirty": true
  }
}
```

Hydration updates an existing background document through
`$acceptModelChanged`; it does not remove and re-add the document.

### Release behavior

The membership snapshot is authoritative. A separate release RPC is not
required for ordinary reconciliation. WBA releases background documents absent
from the newest accepted snapshot, except:

- the current active document,
- a newer active document not represented by the stale snapshot,
- a provisional document awaiting a newer revision.

Project generation and open-state revision guards reject late snapshots.

## Content Identity And Versions

Do not overload one version value with several meanings.

```text
open_state_revision
  sidecar membership and active-file revision

project_generation
  project/session stale-work guard

contentIdentity
  materialized content identity, normally content_sha256

WBA versionId
  monotonically increasing extension-host/LSP document version

Monaco versionId
  browser model-local edit version
```

The sidecar already stores `base_sha256` and `content_sha256` for drafts.
Clean-file identities may be calculated during materialization. A later
optimization may use a stat fingerprint to avoid clean-file reads during the
membership phase, but semantic hydration must still deliver exact text.

### Active-to-background rule

When an active WBA document is demoted, its current WBA contents are newer than
or equal to a concurrently materialized Python snapshot. Demotion therefore
preserves the existing WBA buffer. A late background hydration must not
overwrite a newer active edit merely because its open-state revision is newer.

The implementation needs an ownership/epoch guard:

- active direct changes advance the WBA document version and active epoch,
- a background hydration records the content identity it was based on,
- WBA rejects hydration prepared before the last active edit/demotion point,
- a rejected hydration requests a fresh Python materialization only when
  reconciliation still requires it.

## Draft Materialization

Extract the current draft-wins behavior from
`editor_ws._read_file_payload()` into a shared backend service.

The shared operation should return:

```python
class MaterializedDocument(TypedDict):
    path: str
    text: str
    content_sha256: str
    base_sha256: str
    unsaved: bool
```

Both consumers use the same implementation:

- active editor payload construction,
- background WBA hydration.

The initial extraction must preserve active-open behavior byte-for-byte. It
must not add another disk read or hash pass to the visible open route.

Language-ID resolution remains WBA-owned. Materialization returns content and
content identity; it does not add language detection to the Python active-open
path.

Background materialization uses `asyncio.to_thread()` or an equivalent worker
boundary because disk reads, hashing, and large JSON encoding must not occupy
the app worker's Socket.IO event loop.

## Diagnostics Semantics

### Current problem

`clearDiagnosticsForLeavingModel()` currently removes URI diagnostics from
`diagMarkerStore` on every file switch. That matches a one-document WBA model
but destroys the state needed for a logical multi-open set.

### Required behavior

- Keep diagnostics stored by URI and owner for all logical open documents.
- Disposing the outgoing Monaco model removes its visible squiggles naturally.
- Reset only the projected-owner bookkeeping when the active model changes.
- Call `syncDiagnosticsForCurrentModel()` after the new Monaco model is ready.
- Apply retained diagnostics matching the new active URI.
- Keep toolbar counts scoped to the active URI.
- Keep Explorer/Problems projections capable of showing all retained URIs.
- Clear one URI only when that logical tab is released.
- Clear all URIs on project switch, adapter session reset, or generation reset.

The direct WBA -> editor diagnostics path remains direct. Python remains
responsible only for the existing Explorer/Problems diagnostics projection.

## Startup, Reconnect, And Reset

### Worker/page startup

1. Python reads the sidecar snapshot.
2. The active payload is emitted to the frontend immediately.
3. The frontend renders the active Monaco model.
4. Python schedules background reconciliation independently.
5. WBA retains background models as their materialized content arrives.

### Browser reload

Browser reload must not close the WBA logical set. The active model is
re-established through the existing direct open/change path. Python's latest
snapshot repairs any drift.

### WBA restart

`AdapterWorkspaceReady` schedules a complete latest-sidecar reconciliation.
The active frontend model still replays through the existing WBA reconnect
path. Background documents are hydrated independently.

### Project switch

Project generation changes invalidate all old tasks. WBA closes the old
project's synthetic documents, clears the registry, switches workspace, and
accepts only the new generation's snapshot.

## Save And External Change Semantics

Save does not close/reopen a retained document.

```text
save
  -> disk and sidecar draft state update
  -> content identity/checkpoint changes
  -> WBA document remains open
  -> optional dirty-state/saved notification
```

An external file change for a background clean document should trigger a
revisioned re-materialization. An external change must not overwrite an unsaved
draft or a newer active WBA buffer.

## Failure Handling

- A failed background hydration is recorded and retryable.
- One failed document must not block other background documents.
- Reconciliation remains incomplete but never blocks visible editing.
- WBA disconnect cancels or fails pending pipe RPCs; workspace-ready retries
  from a complete snapshot.
- Missing/out-of-project files are omitted from the accepted logical set and
  released if previously retained.
- Late revisions and generations are rejected, not applied.
- No polling loop is introduced. Recovery is driven by open-state, draft,
  adapter, workspace, and filesystem facts.

## Performance Rules

1. Visible open receives no new background-model awaits.
2. Open-state UI/editor projection runs before background reconciliation.
3. The event-bus handler only schedules/coalesces work.
4. Materialization and large serialization run off the Python asyncio loop.
5. Warm tab switches send membership metadata, not all file contents.
6. WBA applies one document lifecycle operation at a time on its existing
   event loop to preserve ordering.
7. Background hydration is bounded by the 12-tab membership limit.
8. No diagnostics payload is copied into the membership protocol.
9. No browser background model or undo stack is allocated.

## Implementation Phases

### Phase 1: Shared materializer

- Extract the active draft-wins read into a reusable service.
- Preserve current active-open payload and timing.
- Add draft, clean disk, missing file, encoding-replacement, and hash tests.

### Phase 2: Unified WBA document registry

- Replace the background URI set with a typed registry.
- Add retain, update, promote, demote, release, reconcile, and reset methods.
- Preserve synthetic extension-host document identity across role changes.
- Add unit tests against emitted extension-host RPC deltas.

### Phase 3: Pipe reconciliation DTOs

- Add revisioned membership and hydration methods to the WBA JSON-RPC
  dispatcher.
- Route them only through `adapter_rpc()`.
- Add stale generation/revision and duplicate-document tests.

### Phase 4: Python reconciler

- Subscribe to open-state, draft-state, adapter-ready, and project-reset facts.
- Coalesce latest-wins outside the serial event-bus handler.
- Hydrate only missing/stale documents.
- Keep the active file filtered from the background list.

### Phase 5: Active/background adoption

- Change WBA `openFile()` so normal tab switching demotes rather than closes.
- Promote an existing background document without duplicate `addedDocuments`.
- Preserve the current frontend open scheduler and completion boundary.

### Phase 6: Diagnostics retention

- Stop deleting URI diagnostics on normal model switches.
- Reapply retained URI diagnostics to the newly active Monaco model.
- Clear diagnostics on canonical release/reset only.

### Phase 7: End-to-end validation

- Validate draft-aware diagnostics across multiple open files.
- Validate open-files-only language-server behavior.
- Validate tab switching without `didClose`/`didOpen` churn.
- Validate WBA restart, browser reload, project switch, close, save, and
  external-change recovery.
- Compare visible-open latency against the pre-change baseline.

## Acceptance Criteria

- The 12-entry sidecar tab set and WBA open-document set converge.
- The active browser still owns one Monaco model.
- A normal tab switch emits no LSP close/open churn for retained tabs.
- Closing a tab emits exactly one document close.
- Unsaved background drafts affect diagnostics in other open files.
- Returning to a background tab restores its retained diagnostics immediately.
- Browser reload and WBA restart reconstruct the semantic open set.
- Project switch cannot leak old documents or late hydration.
- Existing direct language-feature RPCs remain direct.
- Existing frontend visible-open completion contains no new background await.
- Measured visible-open latency shows no material regression.

## Contingency: WBA As The Stronger Model Owner

If active/background adoption cannot be made reliable while Python repeatedly
ships full materialized snapshots, WBA may become the stronger semantic buffer
owner:

- Python still owns sidecar membership and orchestration.
- Python supplies cold disk-plus-draft reconstruction and durable checkpoints.
- WBA owns retained live buffers and their extension-host versions.
- The active Monaco model remains the live foreground edit source.
- Frontend visible opens still do not await WBA.

This is an allowed architectural adjustment. Moving more semantic ownership
into WBA is preferable to slowing the active frontend path or adding
close/reopen churn.

## Files Expected To Change During Implementation

Python orchestration and materialization:

- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/`
- `app/apps/file_editor_cm6/open_state_events.py`
- `app/apps/file_editor_cm6/workbench_adapter_shell_manager.py`
- a new focused WBA document-reconciliation projector/service

WBA lifecycle:

- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/client/document-content.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/client/workbench-client.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/client/runtime-adapters.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/workspace/lifecycle.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/server/request-dispatch.ts`

Editor diagnostics:

- `app/apps/file_editor_cm6/monaco_editor/editor_open_transaction_runner_main.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`

Tests should be added beside the owning Python, TypeScript, and WBA modules.
