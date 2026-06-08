# File Editor CM6 WBA Project Switch And Language Intelligence Investigation

## Current Direction

The current project-switch and WBA readiness slice should treat the user's architecture direction as authoritative:

- WBA is a transport/orchestration adapter for code-server's extension-host/workbench protocol, not a language-specific policy engine.
- No language should be privileged or special-cased in WBA unless code-server itself requires that protocol shape.
- Monaco/editor model boot should not race ahead of WBA readiness if the target architecture requires WBA to be the model/language-intelligence authority boundary.
- Stale docs or memory must be updated to match the chosen architecture rather than used as a reason to preserve an unreliable compatibility shape.

## Findings So Far

Backend project switching currently flows through [`explorer/services/project_switch.py`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/explorer/services/project_switch.py). It emits project-switch begin state, calls the WBA stdio RPC method `adapter.switchWorkspace`, then marks the adapter workspace `ready` or `error` before replaying sidecar open state.

The adapter RPC method `adapter.switchWorkspace` is handled in [`request-dispatch.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/server/request-dispatch.ts). It delegates to `runtime.wb._switchWorkspace(folder)` and returns `{ ok: true, workspaceFolder }` after that method returns.

The WBA workspace switch implementation in [`workspace/lifecycle.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/workspace/lifecycle.ts) sends `$acceptWorkspaceData` to the extension host, clears local document/session maps, updates `runtime.state.workspaceFolder`, and resubscribes the watcher. The current inspection has not found a terminal extension-host acknowledgement that proves all extension-host workspace side effects and workspace activation have settled before the backend marks the adapter ready.

The current Monaco boot order conflicts with a strict WBA-first model boundary. [`editor_monaco_boot_runtime.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/monaco_editor/editor_monaco_boot_runtime.ts) loads Monaco, applies the boot snapshot, creates/ensures the editor with prefs, then connects `/rpc/editor` and `/wba`, then installs WBA language providers. This is a Monaco-first boot with later WBA catch-up, not a WBA-ready-first boot.

The editor runtime has defensive queues and project-switch gates in [`editor_workbench_runtime.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts), including pending `open_file`, document-backed provider open-ack gating, and adapter-project path checks. Those are useful, but they are still compensating for a boot/order model where Monaco can exist before WBA is authoritative.

## Source Investigation Rule

For the next deep dive, prefer the local code-server source over generic upstream VS Code source. The relevant source tree is expected under `/data/data/com.termux/files/home/code-server`. Upstream VS Code source can still be used when code-server carries the same file unchanged or when code-server local source points there, but code-server should be checked first.

## Questions For The Deep Dive

1. In code-server, when a file is opened, which main-thread path creates or resolves the text model, and when is the extension host notified of the document/editor delta?
2. Does code-server push model content to the extension host as part of open/change events, or merely notify that a model exists and let providers pull as needed?
3. Which language-intelligence families are event-driven from the extension host, and which are requested by Monaco/workbench provider calls?
4. What is the real completion condition for a workspace switch in code-server's extension-host/workbench protocol?
5. Does WBA currently contain language-specific assumptions that should be deleted or moved to generic provider metadata handling?
6. What hard readiness boundary should exist before Monaco creates or applies a model in Code TE2?

## Working Hypothesis

Code-server likely follows a split model:

- File open/document lifecycle pushes document/editor state into the extension host.
- Diagnostics and provider-registration changes are event-driven from extension host to main thread.
- Hover, completion, symbols, folding, semantic tokens, inlay hints, and inline completions are requested through registered providers when Monaco/workbench needs them.

If that is correct, WBA should mimic the document/editor lifecycle and provider RPC surfaces generically. It should not infer language-specific behavior beyond code-server's own language/provider metadata contracts.


## Code-Server Source Findings

Local code-server source confirms that opening a file is a document/editor lifecycle push into the extension host, not a provider pull. [`mainThreadDocumentsAndEditors.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/api/browser/mainThreadDocumentsAndEditors.ts) computes document/editor deltas from live models and calls `$acceptDocumentsAndEditorsDelta(...)`; the added-document DTO includes URI, version, full `lines`, EOL, `languageId`, dirty state, and encoding. [`extHostDocumentsAndEditors.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/api/common/extHostDocumentsAndEditors.ts) receives that delta and constructs `ExtHostDocumentData` before firing add/active/visible editor events.

Content changes are a separate model-change push. [`mainThreadDocuments.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/api/browser/mainThreadDocuments.ts) tracks synchronized models and sends `$acceptModelChanged(uri, evt, isDirty)` on model content changes; [`extHostDocuments.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/api/common/extHostDocuments.ts) applies those changes to extension-host document data and fires extension-host document change events.

Language intelligence is not purely event-based. Code-server registers main-thread provider adapters in [`mainThreadLanguageFeatures.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/api/browser/mainThreadLanguageFeatures.ts); provider methods such as hover, completions, document symbols, folding ranges, semantic tokens, inlay hints, and inline completions call back into extension-host provider methods with the active model URI. [`extHostLanguageFeatures.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/api/common/extHostLanguageFeatures.ts) owns provider registration and dispatches those provider calls to extension/provider adapters.

The event-driven pieces are provider registration, diagnostics publication, and selected provider refresh events. Diagnostics flow from extension-owned diagnostic collections back to the main thread through `$changeMany`. Semantic-token refresh is event-handle driven: provider registration can include an event handle, and extension-host `$emitDocumentSemanticTokensEvent(...)` / `$emitDocumentRangeSemanticTokensEvent(...)` asks the main-thread provider emitter to refresh. The actual token data is still requested through provider calls.

Code-server language identity comes from contributed language metadata and configuration, not from a hardcoded adapter extension table. [`languageService.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/services/language/common/languageService.ts) registers contributed languages, updates MIME/language associations, and activates rich language features with `onLanguage:${languageId}` / `onLanguage` when rich language features are requested.

Workspace activation also has a generic code-server source path. [`workspaceContains.ts`](/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/services/extensions/common/workspaceContains.ts) splits exact filenames and glob patterns from `workspaceContains:*` activation events, checks each workspace folder with existence/search semantics, and activates on the matching event. This aligns with WBA's generic `$checkExists` implementation, but it also means readiness for a switched workspace cannot be reduced to a static project-root assignment.

## WBA Comparison Findings

WBA currently approximates the document lifecycle in [`workspace/lifecycle.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/workspace/lifecycle.ts): `openFile(...)` reads file content, sends `$acceptDocumentsAndEditorsDelta(...)` with added document/editor data, sends editor tab/editor state notifications, then manually sends `$activateByEvent('onLanguage:${languageId}')`. `didChange(...)` sends `$acceptModelChanged(...)` for full-text updates. This is directionally close to code-server's document lifecycle model.

The project-switch readiness boundary is not directionally complete. `switchWorkspace(...)` closes active document/editor state, clears WBA local document maps, sends `$acceptWorkspaceData(...)`, updates `runtime.state.workspaceFolder`, and waits for watcher resubscription. It does not wait for a terminal extension-host acknowledgement that the workspace change, workspaceContains activation, provider re-registration, and language-specific workspace analysis have settled. [`request-dispatch.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/server/request-dispatch.ts) returns `adapter.switchWorkspace` success immediately after this method returns, so backend/UI `ready` can race ahead of extension-host/provider reality.

WBA currently contains real language policy. [`workbench-client.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/client/workbench-client.ts) contains `BOOTSTRAP_LANGUAGE_IDS`, a hand-maintained language-id universe, and `_EXT_TO_LANG`, a hardcoded file-extension-to-language map including Python, JavaScript, TypeScript, Rust, HTML, CSS, JSON, Kotlin, and others. That conflicts with the target model where WBA should be a transport/orchestration adapter and language identity should come from code-server's contributed language catalog and model metadata.

WBA already has a better generic source available for part of this: [`extensions/catalog.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/extensions/catalog.ts) builds a language catalog from extension `contributes.languages`, including extensions, filenames, MIME types, and configuration. The Monaco side already requests that catalog through `te2.language_catalog` in [`editor_workbench_language_catalog_runtime.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/monaco_editor/editor_workbench_language_catalog_runtime.ts). The remaining mismatch is that WBA still uses its static map for extension-host document deltas and provider request fallbacks.

The current Monaco boot order remains the other mismatch. [`editor_monaco_boot_runtime.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/monaco_editor/editor_monaco_boot_runtime.ts) imports Monaco, configures workers/defaults, applies boot snapshot, creates/ensures the editor, then connects editor/WBA sockets and installs WBA language catalog/providers. [`editor_workbench_runtime.ts`](/data/data/com.termux/files/home/mrselect6/app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts) has queues and open-ack gates that hold provider calls until WBA is ready, but those are compensating gates around an already-created model rather than a strict WBA-ready-first boot protocol.

## Updated Working Direction

The project-switch fix should not be another frontend retry or a page reload. It should introduce a real WBA workspace/readiness protocol:

- Treat `adapter.switchWorkspace` success as incomplete until the extension-host workspace update has been observed and workspace-triggered activation/provider registration has had a deterministic completion or quiescence point.
- Define a separate WBA-ready-for-document-open state after switch. The backend should not replay sidecar open state into the editor as if language intelligence is ready before that state exists.
- Move WBA language-id resolution away from `_EXT_TO_LANG` and `BOOTSTRAP_LANGUAGE_IDS` toward code-server-derived language catalog/configuration metadata. If a fallback remains temporarily, it should be classified as a compatibility debt, not architecture.
- Keep document lifecycle and provider calls separate: open/model sync pushes document/editor state; hover/completions/symbols/folding/semantic/inlay/inline calls are provider requests that must wait for document lifecycle readiness.
- If Monaco boot must become WBA-first, gate model creation/application on WBA socket readiness, adapter workspace readiness, language catalog availability, and the sidecar open-state target. Do not let a stale boot snapshot create a model before the WBA can accept the matching document open.

## Editor Runtime Reset Boundary

The plan should not treat the existing Monaco editor/model as a durable object across a real project switch. The code-server-like shape is a workbench-context replacement or reload for a different folder/workspace, so Code TE2 needs an equivalent clean editor-runtime boundary.

The preferred first implementation direction is an inline editor island reset rather than an immediate iframe rollback:

1. Project switch starts.
2. Host/editor marks the editor area suspended and invalidates the current editor epoch.
3. The inline editor runtime disposes its Monaco editor/diff editor instances, owned models, decorations, view zones, widgets, provider registrations, semantic/inlay/inline event emitters, editor RPC listeners or epoch-scoped handlers, editor-local globals, WBA open acknowledgements, queued didChange payloads, and provider queues.
4. WBA switches to the new workspace and reaches the new WBA-ready-for-document-open boundary.
5. Sidecar open-state replay selects either a valid file for the new project or a no-file state.
6. A fresh editor runtime is created only from that post-WBA-ready sidecar state.
7. Provider requests are allowed only after the new document/editor delta has been accepted by WBA.

This is stronger than calling `editor.dispose()` alone. The reset must be an epoch boundary for the editor runtime and WBA document lifecycle, not a cosmetic Monaco widget replacement.

Moving the editor back into an iframe remains a valid fallback if the inline editor runtime cannot be made deterministic. The iframe gives a hard browser teardown for Monaco, editor-local JavaScript state, event listeners, and stale globals. If that fallback is chosen, the design should explicitly include moving `fe-menubar` into the iframe/editor context and reshaping the desktop/landscape grid so the iframe remains a regular rectangular editor box while the sidebar gets the needed vertical height. That iframe path is a larger layout and ownership migration, not just a project-switch fix.
