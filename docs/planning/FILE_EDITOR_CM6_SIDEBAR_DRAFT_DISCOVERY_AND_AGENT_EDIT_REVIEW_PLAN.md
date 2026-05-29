# File Editor CM6 Sidebar Draft Discovery And Agent Edit Review Plan

## Purpose

Separate two related but different sidebar/MCP concerns:

1. Draft discovery: let agent harnesses ask whether the user has draft-mode work on files they may modify, and expose only the draft diff when richer state is requested.
2. Agent edit review: let TE2 request ALS-owned edit state by document URI, then let ALS push event-based updates so the editor can display inline accept/reject affordances and send user decision intents back to ALS.

The inline accept/reject affordance is not a draft feature. ALS authors the canonical contract and owns restore data, edit state, accept semantics, and reject/revert behavior. TE2 only asks for document-scoped edit intelligence, displays the current edit projection, and sends accept/reject decision intents back to ALS.

This plan is intentionally separate from Explorer review UI. Explorer may reuse draft discovery services, but sidebar/MCP harness clients should enter through typed `/sidebar_ipc` JSON-RPC.

## Ownership

Draft discovery ownership:

- Sidebar and MCP harness draft-discovery actions enter through `/sidebar_ipc` JSON-RPC.
- `/sidebar_ipc` is a transport edge only; it should delegate draft reads to backend draft services.
- Draft authority remains sidecar-backed through `ProjectSidecar.session_cache` and `HistoryStore` draft helpers.
- Draft document content must not be returned through the sidebar RPC surface. The default harness-facing draft call is only a dirty-file list, and richer state returns the draft diff payload.
- Draft mutation endpoints are deferred and optional. They should not be treated as a prerequisite for inline agent edit review.

Agent edit review ownership:

- ALS owns the canonical edit session, restore data, accept/reject semantics, per-edit/per-hunk state, monotonic revisions, and the document-state RPC contract.
- TE2 owns only an open-document set and an in-memory render cache for inline affordances and hunk metadata received from ALS. This cache is a projection, not authority.
- The editor owns rendering inline affordances for edit objects whose `uri` matches the active model.
- On file open, file focus, or socket reconnect, TE2 asks ALS for the current agent-edit state for the document URI instead of relying on durable TE2 state.
- Accept means the editor sends a decision intent to ALS. ALS marks the hunk/edit as accepting, applies the semantic accept, clears or marks accepted state in the canonical ledger, then republishes the updated projection.
- Reject means the editor sends a decision intent to ALS. ALS marks the hunk/edit as rejecting, performs restore/revert from ALS-owned data, then republishes accepted/rejected/error/stale state.
- TE2 may optimistically disable controls while a decision is pending, but it must not treat accept/reject as final until ALS publishes the resulting state.
- Project switching should not require durable TE2 state. The render cache can be process-memory scoped and filtered by URI/project/thread/session on display. TE2 can rehydrate opened documents by URI after reconnect; ALS can also republish current state after reconnect or TE2 restart.
- ALS and TE2 are semantic peers for this feature even though the transport shape is client-like. Neither side should treat the other side's absence as a hard editor/app error.

## Peer Availability And Failure Semantics

ALS and TE2 should both tolerate the other side being absent, disconnected, or restarted.

TE2 behavior when ALS is absent:

- file open/focus/reconnect hydration should return an empty/not-available document state, not an editor error;
- no inline agent-edit widgets should be shown until ALS state is available;
- accept/reject controls should not render without an ALS-owned edit projection;
- sidebar/backend logs may record debug-level unavailability, but user-visible editor surfaces should remain normal.

ALS behavior when TE2 is absent:

- ALS should continue tracking its canonical edit ledger and Project modal accept/reject state;
- TE2 publication failures should not clear ALS state or mark edits accepted/rejected;
- ALS may retry, republish on reconnect, or simply wait for TE2's next `documentState.get` request;
- decision intents from stale TE2 clients should be guarded by `knownRevision` and rejected with `stale` / `error` projection state rather than crashing either side.

The preferred failure contract is neutral absence: empty state, disabled affordances, or stale/error state in the ALS projection. Missing peer availability should not throw modal/editor-breaking exceptions.

## Current Authority Points

- Backend sidebar RPC contract: `app/apps/file_editor_cm6/ui_ipc/sidebar_rpc_contract.py`
- Sidebar dispatch edge: `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py`
- Sidecar draft store: `app/apps/file_editor_cm6/project_sidecar.py`
- History draft facade: `app/apps/file_editor_cm6/history_store.py`
- Existing Explorer review service: `app/apps/file_editor_cm6/explorer/review.py`
- Disk-vs-draft hunk helper: `app/apps/file_editor_cm6/draft_diff_helper.py`

## Draft Discovery RPCs

### `sidebar.drafts.list`

Plain dirty-file list for agent clobber-avoidance. It must not return draft content.

Params:

```json
{
  "projectPath": "/abs/project",
  "includeSha": true,
  "includeUpdatedAt": true
}
```

Result:

```json
{
  "ok": true,
  "projectPath": "/abs/project",
  "draftCount": 2,
  "drafts": [
    {
      "path": "/abs/project/src/foo.py",
      "rel": "src/foo.py",
      "unsaved": true,
      "contentLength": 123,
      "contentSha256": "...",
      "baseSha256": "...",
      "updatedAt": "..."
    }
  ]
}
```

### `sidebar.draftState.get`

Structured draft state in project form or target-file form. This returns the draft diff payload produced from disk-vs-draft comparison, not the full draft document or the full disk document.

Params:

```json
{
  "scope": "project",
  "projectPath": "/abs/project",
  "targetFile": "src/foo.py"
}
```

Project result:

```json
{
  "ok": true,
  "scope": "project",
  "projectPath": "/abs/project",
  "draftCount": 2,
  "drafts": []
}
```

File result:

```json
{
  "ok": true,
  "scope": "file",
  "projectPath": "/abs/project",
  "targetFile": "/abs/project/src/foo.py",
  "rel": "src/foo.py",
  "hasDraft": true,
  "draft": {
    "unsaved": true,
    "contentLength": 123,
    "contentSha256": "...",
    "baseSha256": "...",
    "diff": {
      "hunks": [],
      "summary": {
        "added": 0,
        "deleted": 0,
        "tracked": true
      }
    },
    "hunks": [],
    "summary": {
      "added": 0,
      "deleted": 0,
      "tracked": true
    }
  }
}
```

## Draft Clear RPC

### `sidebar.draft.clear`

Clear one targeted draft. This is separate from inline agent edit accept/reject. If the target is active in the editor, the backend routes through the editor-owned reload hook so Monaco returns to disk content.

Params:

```json
{
  "projectPath": "/abs/project",
  "target": {
    "path": "/abs/project/src/foo.py"
  },
  "requestId": "optional-request-id"
}
```

The target may also be supplied as `targetFile`, `path`, `file`, `rel`, or a `file://` URI.

Result:

```json
{
  "ok": true,
  "projectPath": "/abs/project",
  "target": {
    "path": "/abs/project/src/foo.py",
    "rel": "src/foo.py",
    "uri": "file:///abs/project/src/foo.py"
  },
  "cleared": true,
  "reloaded": true,
  "requestId": "optional-request-id",
  "source": "sidebar_ipc_rpc"
}
```

## Deferred Draft Mutation Ideas

The following endpoints may be useful later, but they are not part of the inline accept/reject affordance system and should not block it:

- `sidebar.draft.save`
- `sidebar.draft.diff.get`
- `sidebar.draft.patch.apply`

If implemented, they should route through a shared backend draft service and editor-owned reload hooks when active editor content changes. The draft patching path is a separate feature from agent edit review because drafts are user editor state, while agent edit review is ALS-owned external harness session state.

## Backend Shape For Draft Discovery

Preferred shared draft read service module:

```text
app/apps/file_editor_cm6/host/draft_state_backend.py
```

The module should own:

- project/path normalization and containment checks;
- content-free draft summary building;
- target-file draft lookup;
- disk-vs-draft hunk/diff computation for `sidebar.draftState.get`.

The sidebar edge should remain thin:

```text
ui_ipc/sidebar_ws.py -> host/draft_state_backend.py
```

Explorer review can eventually call the same service for draft state reads, but Explorer review should not route through sidebar IPC.

## Agent Edit Review Model

ALS tracks agent edits per conversation/session, thread, project, and document URI. ALS also owns restore data, state transitions, and the file mutations needed for reject/revert. TE2 should therefore keep only enough in memory to know which document URIs are open, render the affordance, send decision intents, and reconcile newer ALS projections by revision.

ALS-authored canonical DTO responsibilities:

- stable `editId` / `hunkId` identity;
- `conversationId`, optional provider/thread/session ids, `projectPath`, `uri`, and `rel`;
- `revision` or `ledgerRevision` for stale-update rejection;
- per-edit/per-hunk `state` values such as `pending`, `accepting`, `accepted`, `rejecting`, `rejected`, `stale`, and `error`;
- hash/version guard fields such as `baseSha256`, `modifiedSha256`, and optional current-file checks;
- enough hunk/range metadata for TE2 to render inline controls without owning restore data.

TE2-authored editor projection responsibilities:

- CM6/Monaco/editor range mapping;
- active-model URI filtering;
- widget placement and lifecycle;
- disabled/pending visual state while ALS processes a decision;
- forwarding editor decision intents to ALS and applying the next ALS projection.
- maintaining a process-local opened-document set for reconnect/file-open hydration.

## Document-Scoped Pull Model

The primary TE2 entry point for inline agent-edit state should be URI hydration, similar to an LSP/document-intelligence request:

```text
editor opens URI or reconnects -> TE2 asks ALS for sidebar.agentEdits.documentState.get(uri)
ALS returns current document-scoped edit projection
TE2 renders inline widgets from that projection
```

ALS event notifications keep TE2 live while connected, but TE2 must be able to rebuild its inline widget cache by asking for the current state of each open document URI. That makes TE2 stateless for semantic edit review while still allowing it to keep local editor/runtime state such as open documents, active editor, and last seen ledger revisions.

TE2 reconnect behavior:

- keep or reconstruct the set of open editor URIs in the TE2 backend;
- for each open URI, call `sidebar.agentEdits.documentState.get`;
- pass `knownLedgerRevision` when available so ALS can return `notModified`;
- discard local widgets for URIs whose response contains no current edits;
- keep accept/reject controls disabled until the hydrated state is known.

Recommended TE2 in-memory render-cache module:

```text
app/apps/file_editor_cm6/host/agent_edit_review_backend.py
```

This module should own:

- ephemeral display cache in Python process memory;
- URI/project/thread/session filtering for the ALS projection;
- mapping edit objects to active editor notifications;
- decision-intent fanout from editor clients back to ALS;
- cleanup by session/thread/project/URI and by TTL if needed.

A process-memory render cache is acceptable because canonical edit state lives in ALS. On restart, ALS can republish current edit objects if it still wants TE2 to show them.

## Agent Edit Review RPCs

### `sidebar.agentEdits.documentState.get`

TE2 requests the current ALS-owned inline edit state for one document URI. This is the preferred file-open, file-focus, and reconnect hydration path. The method returns the semantic edit projection for the URI; it does not expose restore data.

Params:

```json
{
  "uri": "file:///abs/project/src/foo.py",
  "projectPath": "/abs/project",
  "conversationId": "optional-active-conversation",
  "knownLedgerRevision": 42,
  "documentVersion": 17,
  "contentSha256": "optional-current-editor-content-sha"
}
```

Result:

```json
{
  "ok": true,
  "uri": "file:///abs/project/src/foo.py",
  "projectPath": "/abs/project",
  "ledgerRevision": 43,
  "notModified": false,
  "sources": [
    {
      "conversationId": "conv_123",
      "sessionId": "agent-run-123",
      "threadId": "thread-abc",
      "edits": [
        {
          "editId": "edit-1",
          "revision": 7,
          "state": "pending",
          "uri": "file:///abs/project/src/foo.py",
          "rel": "src/foo.py",
          "label": "Agent edit",
          "description": "Updated parser error handling",
          "baseSha256": "...",
          "modifiedSha256": "...",
          "hunks": []
        }
      ]
    }
  ]
}
```

If `conversationId` is omitted and multiple ALS conversations have current edits for the same URI, ALS should return grouped `sources[]`. TE2 may render all sources, pick the active conversation when known, or ask the user only if there is an actual ambiguity in the visible affordance.

### `sidebar.agentEdits.publish`

ALS publishes or replaces the current edit affordance projection for a conversation/session/thread/project. This is not a decision endpoint. It is the event-based push path that keeps TE2's disposable render cache live while connected; file-open and reconnect hydration should still use `sidebar.agentEdits.documentState.get`.

Params:

```json
{
  "conversationId": "conv_123",
  "sessionId": "agent-run-123",
  "threadId": "thread-abc",
  "projectPath": "/abs/project",
  "source": "als",
  "replace": true,
  "ledgerRevision": 42,
  "edits": [
    {
      "editId": "edit-1",
      "revision": 7,
      "state": "pending",
      "uri": "file:///abs/project/src/foo.py",
      "rel": "src/foo.py",
      "label": "Agent edit",
      "description": "Updated parser error handling",
      "baseSha256": "...",
      "modifiedSha256": "...",
      "hunks": [
        {
          "hunkId": "hunk-1",
          "kind": "modified",
          "state": "pending",
          "originalRange": {
            "startLineNumber": 10,
            "startColumn": 1,
            "endLineNumber": 13,
            "endColumn": 1
          },
          "modifiedRange": {
            "startLineNumber": 10,
            "startColumn": 1,
            "endLineNumber": 15,
            "endColumn": 1
          },
          "summary": "Changed error branch"
        }
      ]
    }
  ]
}
```

Result:

```json
{
  "ok": true,
  "conversationId": "conv_123",
  "sessionId": "agent-run-123",
  "threadId": "thread-abc",
  "projectPath": "/abs/project",
  "ledgerRevision": 42,
  "acceptedCount": 1,
  "visibleCount": 1,
  "droppedStaleCount": 0
}
```

The backend should notify editor clients with only edits relevant to the active URI, or with a project/session payload the editor filters by URI.

### `sidebar.agentEdits.clear`

Clear affordances without implying accept/reject. This is useful when an ALS session ends, a thread closes, or ALS decides TE2 display state is stale.

Params:

```json
{
  "conversationId": "conv_123",
  "sessionId": "agent-run-123",
  "threadId": "thread-abc",
  "projectPath": "/abs/project",
  "ledgerRevision": 43,
  "uris": ["file:///abs/project/src/foo.py"]
}
```

### `sidebar.agentEdits.list`

Debug/discovery endpoint for currently registered in-memory affordances. It should not expose restore data because TE2 does not own restore data.

Params:

```json
{
  "conversationId": "conv_123",
  "sessionId": "agent-run-123",
  "projectPath": "/abs/project",
  "uri": "file:///abs/project/src/foo.py"
}
```

## Agent Edit Decision Flow

Editor UI affordance clicks are decision intents, not final state changes. TE2 should forward the intent to ALS, disable the clicked affordance locally, and wait for ALS to publish the resulting edit/hunk state. ALS is the only authority that can mark a hunk/edit accepted, rejected, stale, or errored.

Accept decision intent:

```json
{
  "method": "sidebar.agentEdits.decide",
  "params": {
    "decision": "accept",
    "conversationId": "conv_123",
    "sessionId": "agent-run-123",
    "threadId": "thread-abc",
    "projectPath": "/abs/project",
    "uri": "file:///abs/project/src/foo.py",
    "editId": "edit-1",
    "hunkId": "hunk-1",
    "decisionId": "decision-...",
    "knownRevision": 7,
    "ts": 1710000000.0
  }
}
```

Reject decision intent:

```json
{
  "method": "sidebar.agentEdits.decide",
  "params": {
    "decision": "reject",
    "conversationId": "conv_123",
    "sessionId": "agent-run-123",
    "threadId": "thread-abc",
    "projectPath": "/abs/project",
    "uri": "file:///abs/project/src/foo.py",
    "editId": "edit-1",
    "hunkId": "hunk-1",
    "decisionId": "decision-...",
    "knownRevision": 7,
    "ts": 1710000000.0
  }
}
```

ALS responds by publishing a newer `sidebar.agentEdits.publish` projection. If the file hash/version no longer matches ALS expectations, ALS should publish `state: "stale"` or `state: "error"` with a short `message` instead of letting TE2 infer failure. TE2 does not restore content on reject.

## Editor Notification Shape

The editor does not need restore data. It needs enough to render affordances, show pending/final state, reconcile by revision, and decide whether a URI needs rehydration.

Server-to-editor notification:

```json
{
  "method": "editor.agentEdits.changed",
  "params": {
    "conversationId": "conv_123",
    "sessionId": "agent-run-123",
    "threadId": "thread-abc",
    "projectPath": "/abs/project",
    "ledgerRevision": 42,
    "edits": [
      {
        "editId": "edit-1",
        "revision": 7,
        "state": "pending",
        "uri": "file:///abs/project/src/foo.py",
        "rel": "src/foo.py",
        "label": "Agent edit",
        "description": "Updated parser error handling",
        "hunks": []
      }
    ]
  }
}
```

This notification may carry a full replacement projection for the URI or a lightweight invalidation. If TE2 receives an invalidation for an open URI and the payload does not include enough edit detail to render directly, it should call `sidebar.agentEdits.documentState.get` for that URI.

Editor-to-backend decision request:

```json
{
  "method": "editor.agentEdits.decide",
  "params": {
    "decision": "accept",
    "conversationId": "conv_123",
    "sessionId": "agent-run-123",
    "threadId": "thread-abc",
    "projectPath": "/abs/project",
    "uri": "file:///abs/project/src/foo.py",
    "editId": "edit-1",
    "hunkId": "hunk-1",
    "decisionId": "decision-...",
    "knownRevision": 7
  }
}
```

The editor backend forwards the decision intent to ALS and marks the local widget pending/disabled. It clears or changes the widget only after the next ALS-owned projection arrives, or after ALS explicitly clears the affordance.

## URI And Project Switching

Project switching should not be a hard blocker because the agent edit registry is not durable project state.

Filtering rules:

- Always include `uri` on edit objects and decisions.
- Include `projectPath` when known, but do not rely on it as the only display filter.
- Editor display should primarily filter by active model URI.
- TE2 should maintain a process-local open URI set so reconnect can rehydrate document state from ALS.
- Sidebar/ALS state may filter by `conversationId`, `sessionId`, `threadId`, and `projectPath`.
- When project switches, TE2 can keep memory entries and simply stop displaying entries whose URI does not match the active editor/project.
- On file open/focus/reconnect, TE2 should call `sidebar.agentEdits.documentState.get` for the active or open URI before showing controls.
- `sidebar.agentEdits.clear` lets ALS explicitly prune old sessions or stale render projections.

## VS Code Chat Editing Research

Local `~/code-server` inspection shows two related but separate mechanisms.

Chat response edit blocks are DTO-shaped:

- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/common/model/chatModel.ts:90` defines `IChatTextEditGroupState` with `sha1` and `applied`.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/common/model/chatModel.ts:95` defines `IChatTextEditGroup` as `{ uri, edits: TextEdit[][], state?, kind: "textEditGroup", done, isExternalEdit? }`.
- `~/code-server/lib/vscode/src/vs/workbench/api/common/extHostChatAgents2.ts:264` exposes this through `ChatResponseStream.textEdit(target, edits)`.

Those DTOs are useful for representing chat response edit groups, but they are not the whole inline editor accept/reject widget contract.

Inline editor hunk accept/reject is session/model-driven:

- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/common/editing/chatEditingService.ts:314` defines `IModifiedFileEntryChangeHunk` as an opaque object with `accept()` and `reject()`.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/common/editing/chatEditingService.ts:319` defines `IModifiedFileEntryEditorIntegration`, including `acceptNearestChange(...)`, `rejectNearestChange(...)`, and `toggleDiff(...)`.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingCodeEditorIntegration.ts:50` defines the hunk renderer's diff contract as `IDocumentDiff2`, which carries `originalModel`, `modifiedModel`, `keep(...)`, and `undo(...)`.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingCodeEditorIntegration.ts:738` implements `DiffHunkWidget`, an overlay widget that implements `IModifiedFileEntryChangeHunk`.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingCodeEditorIntegration.ts:760` wires the widget toolbar to `MenuId.ChatEditingEditorHunk`.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingEditorActions.ts:242` registers the hunk action ids `chatEditor.action.acceptHunk` and `chatEditor.action.undoHunk`.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingEditorActions.ts:273` calls `ctrl.acceptNearestChange(...)` or `ctrl.rejectNearestChange(...)`.

The actual hunk mutation semantics happen against original and modified text models:

- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingTextModelChangeService.ts:408` keeps a hunk by copying modified text ranges into the original model.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingTextModelChangeService.ts:427` undoes a hunk by copying original text ranges back into the modified model.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingCodeEditorIntegration.ts:858` rejects through `this._diffInfo.undo(this._change)` after checking the editor model version.
- `~/code-server/lib/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingCodeEditorIntegration.ts:865` accepts through `this._diffInfo.keep(this._change)` after the same version check.

External edits enter the chat editing session separately:

- `~/code-server/lib/vscode/src/vs/workbench/api/browser/mainThreadChatAgents2.ts:272` handles `progress.kind === "externalEdits"`.
- `~/code-server/lib/vscode/src/vs/workbench/api/browser/mainThreadChatAgents2.ts:275` requires an existing `editingSession` and response handle, then starts or stops external edits.

Conclusion: a sidebar/MCP harness should not try to make `IChatTextEditGroup` the accept/reject widget API. The DTO is a transcript/edit-group representation. The TE2 editor affordance still needs a session-like object with URI-scoped edits, hunk identity, and accept/reject callbacks, but those callbacks report decision intents to ALS rather than mutating drafts or restoring content inside TE2.

## TE2 Agent Edit Review Direction

Use a TE2-native agent-edit affordance layer, not the draft review system and not VS Code's whole `IChatEditingService` stack. The canonical semantic contract is ALS-authored; TE2 provides document URI hydration, editor projection, and decision transport.

Document hydration should be request/response:

```text
editor URI open/focus/reconnect -> sidebar.agentEdits.documentState.get -> ALS edit ledger
ALS edit ledger -> document-scoped projection -> TE2 inline widgets
```

ALS live updates should flow through sidebar IPC:

```text
ALS edit ledger -> sidebar.agentEdits.publish -> host/agent_edit_review_backend.py -> /rpc/editor editor.agentEdits.changed
```

Editor decisions should flow back as intents:

```text
editor widget -> editor.agentEdits.decide -> host/agent_edit_review_backend.py -> sidebar.agentEdits.decide -> ALS
ALS -> sidebar.agentEdits.publish -> TE2/editor updated state
```

The editor owns:

- reporting open/focused document URIs to the TE2 backend;
- requesting URI hydration on open/focus/reconnect;
- filtering published edit affordances by active URI;
- rendering inline hunk widgets or adapting existing editor diff/deletion-zone primitives;
- marking local widgets disabled/pending after a decision click;
- sending accept/reject decision intent payloads to the backend;
- reconciling widgets from the next ALS-owned projection.

The backend owns:

- ephemeral process-memory render cache;
- process-local open URI tracking for reconnect hydration;
- conversation/session/thread/project/URI filtering;
- fanout to editor clients;
- URI hydration request/response forwarding to ALS;
- decision-intent fanout to sidebar IPC clients.

ALS owns:

- the canonical `sidebar.agentEdits.documentState.get` contract and response shape;
- actual edit session authority and monotonic ledger revisions;
- restore/revert data;
- applying accept/reject behavior;
- publishing accepted/rejected/stale/error state;
- deciding whether to republish affordances after process reconnect or TE2 restart.

## Implementation Order

1. Add draft discovery RPC `sidebar.drafts.list` first if the immediate MCP need is clobber avoidance.
2. Add `sidebar.draftState.get` only if the harness needs richer per-file draft metadata; return the draft diff, not full draft or disk content.
3. Add `sidebar.draft.clear` for targeted draft removal if the harness needs to remove a known user draft.
4. Define the ALS-authored canonical document-state DTO, including `uri`, optional `conversationId`, `ledgerRevision`, `sources[]`, per-edit/per-hunk `revision`, `state`, hash guards, and hunk range metadata.
5. Add `sidebar.agentEdits.documentState.get` as the primary URI hydration method for file open/focus/reconnect.
6. Add the in-memory `host/agent_edit_review_backend.py` render cache and sidebar RPC methods for `sidebar.agentEdits.publish`, `sidebar.agentEdits.clear`, `sidebar.agentEdits.list`, and `sidebar.agentEdits.decide`.
7. Add TE2 backend open URI tracking so socket reconnects can rehydrate all open documents through `sidebar.agentEdits.documentState.get`.
8. Add editor RPC notifications/requests for `editor.agentEdits.changed` and `editor.agentEdits.decide`.
9. Render a first inline affordance layer in the editor, filtered by active URI.
10. Forward editor decision intents to ALS, mark local controls pending/disabled, and clear/update widgets only from the next ALS projection.
11. Add ALS-side decision handling so accept clears ledger state, reject applies ALS-owned reverse patch/restore, and stale/error states republish with messages.
12. Only revisit draft save/patch RPCs if a concrete harness workflow needs TE2 to mutate more draft state.

## MCP / Sidebar DTO

Draft discovery DTO:

```json
{
  "projectPath": "/abs/project",
  "drafts": [
    {
      "rel": "src/foo.py",
      "path": "/abs/project/src/foo.py",
      "contentLength": 123,
      "baseSha256": "...",
      "contentSha256": "...",
      "updatedAt": "..."
    }
  ]
}
```

ALS-owned agent edit affordance DTO:

```json
{
  "uri": "file:///abs/project/src/foo.py",
  "notModified": false,
  "conversationId": "conv_123",
  "sessionId": "agent-run-123",
  "threadId": "thread-abc",
  "projectPath": "/abs/project",
  "ledgerRevision": 42,
  "sources": [
    {
      "conversationId": "conv_123",
      "sessionId": "agent-run-123",
      "threadId": "thread-abc",
      "edits": []
    }
  ],
  "edits": [
    {
      "editId": "edit-1",
      "revision": 7,
      "state": "pending",
      "uri": "file:///abs/project/src/foo.py",
      "rel": "src/foo.py",
      "label": "Agent edit",
      "description": "Updated parser error handling",
      "baseSha256": "...",
      "modifiedSha256": "...",
      "hunks": [
        {
          "hunkId": "hunk-1",
          "kind": "modified",
          "state": "pending",
          "originalRange": {
            "startLineNumber": 10,
            "startColumn": 1,
            "endLineNumber": 13,
            "endColumn": 1
          },
          "modifiedRange": {
            "startLineNumber": 10,
            "startColumn": 1,
            "endLineNumber": 15,
            "endColumn": 1
          },
          "summary": "Changed error branch",
          "message": null
        }
      ]
    }
  ]
}
```

`edits[]` is a convenient single-source projection when the active conversation/session is known. `sources[]` is the grouped multi-source shape for URI hydration when multiple ALS conversations may have current edits for the same document.

VS Code `IChatTextEditGroup` compatibility can remain an export/projection if needed later, but it should not be the TE2 internal agent-edit affordance authority.

## Open Questions

- Whether the first TE2 agent-edit affordance UI should adapt existing editor diff/deletion-zone rendering primitives or build a separate hunk-widget layer closer to VS Code's `DiffHunkWidget`.
- Whether edit hunks should always be supplied by ALS or whether TE2 may compute editor-only hunk decorations from optional before/after text while ALS remains semantic authority.
- Whether sidebar decision intents should target only the ALS publishing connection or broadcast to all sidebar IPC clients with `conversationId` / `sessionId` filtering.
- Whether ALS should expose full-edit and per-hunk decisions in the first DTO, or start with hunk-only decisions and let full-edit accept/reject fan out to all hunks later.
- Whether `documentState.get` should return only `sources[]`, only a flattened active `edits[]`, or both as shown above for first implementation ergonomics.
