# File Editor CM6 WBA Hot Switch Readiness Plan

Date: 2026-06-08

## Purpose

Supersede the prior editor-epoch-heavy project switch tracker with a smaller
WBA-centered approach:

1. Keep the editor on the normal model/open path.
2. Hot-switch the WBA workspace path in place.
3. Delay the editor model switch until WBA is ready for the target project/file.
4. Fence or clear old-project WBA runtime memory so stale responses cannot affect
   the new project.

The deprecated editor epoch tracker is no longer the primary implementation
direction.

## Current WBA Hot-Switch Seam

WBA already has a hot-switch seam:

- `adapter.switchWorkspace` -> `WorkbenchClient._switchWorkspace(...)`
- `_switchWorkspace(...)` -> `workspace/lifecycle.switchWorkspace(...)`

That path already performs most of the correct project reset:

- closes the active document/editor through `$acceptDocumentsAndEditorsDelta`
- clears active editor/tab/URI state
- clears document version/line/char/open-generation maps
- sends `$acceptWorkspaceData`
- updates `state.workspaceFolder`
- clears active path/language state
- disposes and recreates the file watcher for the new root
- emits `workspace/switched`

The gap is readiness. Today "switch complete" means "workspace data and watcher
setup were sent," not "WBA is ready for the next document/model open."

## WBA Runtime Memory

Project-scoped state that must reset or be fenced on project switch:

- `state.workspaceFolder`
- `state.activePath`
- `state.activeUri`
- `state.activeLanguageId`
- `_activeEditorId`
- `_activeUriObj`
- `_activeTab`
- `_docVersions`
- `_docLineCount`
- `_docCharCount`
- `_docLastLineLength`
- `_docOpenGeneration`
- `_fsWatcherSub`
- `_backgroundDocuments`
- pending document/provider requests in `_extRequests`, or at least a generation
  fence around them

State that is probably safe to keep across a hot switch:

- management and extension-host protocol connections
- `_extensions`
- `_rawExtensionConfigs`
- `_providerRegistry`
- `_languageCatalogCache`
- `_productVersion`
- `_authority`
- `_useRemote`
- `_signService`

Suspicious gaps:

- `_backgroundDocuments` is project/document memory but does not appear to be
  cleared by the current switch path.
- `_extRequests` can still contain old-project provider/document requests unless
  cancelled or generation-fenced.
- provider registry can stay global, but frontend code must not treat "providers
  registered" as "target project document is ready."
- TextMate readiness is still frontend async and can race the model switch unless
  the model switch waits for a WBA/project/document readiness boundary.

## Target Shape

Use the existing WBA `adapter.switchWorkspace` operation instead of destroying the
editor or adding a second prepare RPC.

1. Backend asks WBA to switch workspace with `adapter.switchWorkspace`.
2. WBA hot-switches workspace in the running adapter process.
3. WBA clears or fences old project document state, including background docs and
   pending project-scoped requests.
4. WBA emits a direct `workspace/switched` event with `readyForDocumentOpen: true`.
5. The editor keeps intelligence calls gated while project switch is in progress.
6. The editor unblocks intelligence only after receiving that WBA ack event.
7. Normal `wba.openFile` and provider calls remain gated on the matching open ack.

This preserves the normal open path and avoids iframe reload/editor epoch
complexity unless the WBA hot-switch path proves impossible.

## Implementation Tracker

| Step | Status | Outcome |
| --- | --- | --- |
| 1. Audit current WBA project-scoped runtime memory | DONE | Runtime project state is active editor/tab/URI, document maps/open generations, background documents, watcher subscription, and pending extension requests |
| 2. Clear/fence `_backgroundDocuments` on workspace switch | DONE | WBA switch cleanup clears background document tracking when the workspace changes |
| 3. Generation-fence or reject old `_extRequests` on workspace switch | DONE | WBA switch cleanup rejects pending extension requests before accepting the new workspace |
| 4. Add WBA switch ack | DONE | Existing `adapter.switchWorkspace` returns and emits `readyForDocumentOpen: true` through the WBA `workspace/switched` event |
| 5. Define WBA ack payload | DONE | Ack payload includes workspace folder, watcher status, cleanup counts, and `readyForDocumentOpen: true` |
| 6. Validate backend ack before adapter ready | DONE | Backend project switch keeps the existing sequence but requires the `adapter.switchWorkspace` ack before marking adapter ready |
| 7. Gate all editor intelligence calls on WBA ack | DONE | Direct and guarded intelligence calls wait on an event-driven promise resolved by the WBA `workspace/switched` ack; provider open-ack gating remains intact |
| 8. Validate with smoke/typecheck/syntax only before live testing | DONE | `python -m py_compile`, strict `basedpyright`, WBA `tsgo`, and `node build.mjs` passed; no live runtime test or shared framework restart performed |
