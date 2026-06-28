# File Editor CM6 WBA Ack And Decomposition Audit

## Scope

This note covers the Python completion startup race observed on large files and the related Workbench Adapter (WBA) decomposition direction. The immediate patch target is completions only. Semantic tokens, diagnostics, folding ranges, and hovers are compared to explain why they are currently more reliable or fail differently.

## Live Observation

The active large Python case used `editor_ws.py` with roughly 1,300 lines. Runtime inspection showed:

- Monaco had one active `file://` model for `editor_ws.py`, language `python`, with diagnostics markers applied.
- The live Monaco completion registry had two ordered groups for the Python model: the WBA completion bridge first, then `wordbasedCompletions` second.
- The WBA had a Python completion provider registered (`handle=8`) and could answer completion requests.
- A direct provider call at `im` returned extension-backed completions after roughly 1.3 seconds.
- When a normal suggest request returns empty/stale from the WBA bridge, Monaco falls through to the word provider and the current suggest session can remain word-only until the cursor moves or a new suggest session is created.

## Root Cause

The frontend completion provider captured a `LanguageContext` that included the Monaco model version. `callWorkbenchProviderGuarded(...)` rejected completion results when the active model version changed before the async WBA result returned.

That version change is normal during typing. On larger Python files, the WBA completion request can take long enough for the user to type another character before the result resolves. The exact-version guard then converts a valid extension result into an empty completion list. VS Code's suggest pipeline then tries the next provider group, which is the word-based provider.

The word provider therefore was not the root producer of the problem; it was the fallback that made the failure visible and sticky.

## VS Code Source Comparison

### Completion Provider Registration And Invocation

VS Code registers extension completions through `MainThreadLanguageFeatures.$registerCompletionsProvider(...)`, which registers a provider in `languageFeaturesService.completionProvider`. The provider's `provideCompletionItems(...)` is a Promise-returning call into the extension host.

References:

- `worktrees/vscode-te2-diff/src/vs/workbench/api/browser/mainThreadLanguageFeatures.ts`
- `worktrees/vscode-te2-diff/src/vs/workbench/api/common/extHostLanguageFeatures.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggest.ts`

### Suggest Provider Grouping

VS Code's `provideSuggestionItems(...)` asks providers in ordered groups. It stops when a group produces results. This explains the observed either/or behavior: once WBA is the first group, word completions only appear when the WBA group is absent or returns no items.

References:

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggest.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/languageFeatureRegistry.ts`

### Word-Based Completion Provider

VS Code registers the word provider as a `*` completion provider. It obeys the `editor.wordBasedSuggestions` setting. In Code TE2, leaving this enabled allows word completions to mask WBA readiness failures.

Reference:

- `worktrees/vscode-te2-diff/src/vs/editor/browser/services/editorWorkerService.ts`

### Diagnostics

Diagnostics are push-based. The extension host diagnostic collection calls `$changeMany(...)`, and Code TE2 applies markers by owner/path. The frontend path is not gated on exact Monaco model version; stale/mismatched paths are dropped by path instead.

References:

- `worktrees/vscode-te2-diff/src/vs/workbench/api/common/extHostDiagnostics.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`

### Semantic Tokens

VS Code's document semantic token feature schedules token fetches on provider changes, model content changes, model language changes, and theme changes. If content changes during a semantic token request, it records pending changes and schedules another pass. Code TE2's semantic token provider similarly avoids the exact-version guard used by completions.

References:

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/semanticTokens/browser/documentSemanticTokens.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/semanticTokens/common/getSemanticTokens.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`

### Folding Ranges And Symbols

Code TE2's guarded path already treats symbols and folding differently from completions/hover: it only requires the active URI to match, not the exact Monaco model version. That is closer to the stable behavior we want for provider requests whose results are tied to the active document, not the transient frontend version at request start.

References:

- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`

### Hovers

Hover still uses the exact-version guard. It is less visible because users usually hover after typing has settled, so the race is rarer. This should be revisited after completions prove stable.

## Immediate Completion Fix

The approved completion patch uses acknowledgements rather than retry/poll behavior:

1. Disable word-based suggestions in the Code TE2 Monaco option bag so failed WBA completion readiness cannot fall through into sticky word-only suggestions.
2. Keep the current WBA `open_file` Promise/ack in the frontend workbench runtime by path and generation.
3. Have completion requests await the matching `open_file` ack before calling WBA.
4. Have WBA completion preflight send `$acceptModelChanged` with the latest full text and await the ext-host terminal reply before `$provideCompletionItems`.
5. Change completion stale handling so completions are invalidated by cancellation token, request sequence, or document identity mismatch, not by exact Monaco model version mismatch.

This makes acks the primary synchronization model and avoids adding a retry loop.

## Diagnostics Boundary: `$acceptModelChanged` vs `$changeMany`

The VS Code source confirms two different directions:

- `ExtHostDocuments.$acceptModelChanged(...)` is the document sync lane. This is the correct single-document "didChange" equivalent for one active file.
- `MainThreadDiagnostics.$changeMany(owner, entries)` is the diagnostics publication lane. Each entry is a `[uri, markers]` pair, and VS Code applies it with `markerService.changeOne(owner, resource, markers)`.

So the correctness target is not to replace `$changeMany` with a single-file diagnostics request. The target is:

- send single-file edit state through `$acceptModelChanged`
- treat every `$changeMany` as owner/resource-scoped diagnostics output
- keep diagnostics cache and frontend marker ownership keyed by `(path, owner)`
- never collapse all diagnostics into one blanket owner/path update

This matters for workspace-enabled extensions. A workspace analyzer may produce diagnostics for multiple files after one active-file edit. That is valid, but the bridge must route those entries independently instead of treating the event as one active-file replacement.

## WBA Decomposition Feasibility

The WBA is currently concentrated in two large files:

- `workbench_client.mjs`: remote-agent protocol client, ext-host message decode/encode, provider registry, document/editor lifecycle, language feature calls, workspace switching, URI mechanics.
- `server.mjs`: stdin/stdout JSON-RPC server, request routing, push event translation, diagnostics normalization, process-level logging.

The correct path is a responsibility-sliced TypeScript cutover staged around stable seams and bundled back to the existing Node entrypoint shape.

## Slice 1 Progress

The first decomposition slice creates an adapter-local strict TypeScript build and extracts the binary protocol codec out of `workbench_client.mjs`:

- `node_workbench_adapter/tsconfig.json` enables a strict TS lane scoped to `src/**/*.ts`.
- `node_workbench_adapter/build.mjs` emits minified ESM helpers under `dist/`.
- `src/protocol/wire-encoding.ts` owns management-value encoding, ext-host request/reply encoding, terminal-reply detection, and ext-host RPC decoding.
- `workbench_client.mjs` imports the generated `dist/protocol/wire-encoding.mjs` instead of owning those helpers inline.
- The undefined `languageFromPath(path)` calls in WBA intelligence methods were replaced with the existing `_languageIdFromPath(path)` helper.

This is intentionally a leaf extraction. The active runtime entry remains `server.mjs`; the shellspec does not switch to a bundled server yet.

## Slice 2 Progress

The second decomposition slice moves request ownership out of the monolithic client and into the strict protocol layer:

- `src/protocol/rpc-ids.ts` owns the RPC nid defaults and `te2_rpc_config.json` override loading.
- `src/protocol/pending-requests.ts` owns extension-host request id allocation, pending timers, accept filters, sent-request metadata, terminal-ack filtering, and disconnect rejection.
- `workbench_client.mjs` now sends request/response families through `_sendExtPending(...)` rather than each feature method creating its own `Map` entry, timer, and cleanup path.
- Symbols, folding ranges, hovers, completions, semantic tokens, semantic-token ranges, text-document-content providers, and didChange acks now share the same pending-request owner.
- Reply metadata is only deleted after a pending request actually resolves, so progress/non-terminal reply types cannot consume the metadata needed by the final terminal ack.

The active runtime entry remains unchanged. This slice is still a strict helper extraction rather than a server bundle cutover.

## Slice 3 Progress

The third decomposition slice moves provider registry ownership out of `workbench_client.mjs` and into the strict extension layer:

- `src/extensions/provider-registry.ts` owns provider maps, text-document-content-provider handles, registration parsing, selector/language matching, provider snapshots, and resync event generation.
- `workbench_client.mjs` now keeps a `ProviderRegistry` instance instead of raw `_providers` and `_textContentProviders` maps.
- Provider registration events still enter through the same extension-host request stream and still emit the existing frontend-facing provider events.
- Symbols, folding, hovers, completions, semantic tokens, semantic-token range, content-provider reads/stats, provider snapshots, and provider resync now query the registry rather than scanning raw maps.
- The active runtime entry remains unchanged; this slice creates the ownership seam needed to split individual intelligence modules next.

## Slice 4 Progress

The fourth decomposition slice moves completions into the first strict intelligence module:

- `src/extensions/intelligence/completions.ts` owns completion request coercion, preflight didChange acknowledgement, provider handle fanout, pinned-handle requests, timeout options, result merging, and suggest-item inflation.
- `workbench_client.mjs` now keeps only `completions(...)`, `_completionsSingle(...)`, and `_inflateCompletionItems(...)` delegation wrappers for compatibility with existing call sites.
- Completion behavior intentionally remains unchanged: the module still waits for didChange ack when text is provided, calls all matching completion providers, uses the same timeout messages, preserves `isIncomplete`, `cacheId`, and inflated Monaco-compatible item fields, and returns the same public response shapes.
- This proves the provider registry and request-owner seams are usable for feature-family extraction. Semantic tokens are the next obvious intelligence-family candidate.

## Slice 5 Progress

The fifth decomposition slice moves semantic tokens into the next strict intelligence module:

- `src/extensions/intelligence/semantic-tokens.ts` owns document semantic tokens, range semantic tokens, reply parsing, DTO parsing, best-result selection, and legend lookup.
- `workbench_client.mjs` now keeps only `semanticTokens(...)`, `_semanticTokensSingle(...)`, `semanticTokensRange(...)`, `_parseSemanticTokensReply(...)`, `_parseSemanticTokensDto(...)`, and `getSemanticTokensLegend(...)` delegation wrappers for compatibility with existing call sites.
- Semantic-token behavior intentionally remains unchanged: the module still fans out to all matching providers, preserves the same timeout messages, keeps the existing range/full result shapes, preserves legend attachment, and still picks the richest successful provider reply.
- The provider registry plus request-owner seams are now proven for two intelligence families. The next likely extraction candidates are hover, symbols, and folding ranges.

## Slice 6 Progress

The sixth decomposition slice moves the remaining language-intelligence request family out of `workbench_client.mjs`:

- `src/extensions/intelligence/structure.ts` now owns document symbols and folding ranges, including document-open/generation checks, provider fanout, pinned-handle requests, merge rules, timeout behavior, and retry handling.
- `src/extensions/intelligence/hover.ts` now owns hover provider fanout, pinned-handle requests, merge rules, and timeout behavior.
- `workbench_client.mjs` now keeps only compatibility wrappers for `documentSymbols(...)`, `foldingRanges(...)`, `hover(...)`, and their single-provider helpers.
- This slice also corrects one latent bug in the old inline code: the document-symbols retry path now retries through the document-symbols function itself instead of calling a non-existent `this.symbols(...)`.
- With completions, semantic tokens, hover, symbols, and folding now extracted, the remaining major WBA work is the grammar/TextMate boundary or the workspace/document lifecycle and broader client/server ownership cutover.

## Slice 7 Progress

The seventh decomposition slice moves the workspace and document lifecycle cluster out of `workbench_client.mjs`:

- `src/workspace/lifecycle.ts` now owns `openFile`, `didChange`, workspace switching, watcher setup, and watcher resubscription.
- `workbench_client.mjs` now keeps only compatibility wrappers for `openFile(...)`, `didChange(...)`, `_switchWorkspace(...)`, `_setupFileWatcher(...)`, and `resubscribeWatcher(...)`.
- The lifecycle module keeps the existing open-file sequencing, same-file reopen path, didChange ack behavior, workspace-root switch semantics, and watcher subscription event shapes intact.
- This slice also removes a couple of latent client-local assumptions by routing active-URI reflection through the client’s safe URI-string helper instead of relying on the previously implicit `uriObjToString(...)` availability.
- With the intelligence families and the workspace/document lifecycle both extracted, the largest remaining WBA work is the grammar/TextMate boundary or the final client/server ownership cutover around ext-host inbound dispatch and startup orchestration.

## Slice 8 Progress

The eighth decomposition slice starts the `server.mjs` cutover by moving the JSON-RPC request ladder into a typed server dispatch module:

- `src/server/request-dispatch.ts` now owns request handling for `te2.*`, `adapter.*`, and `vscode.*` methods other than the TextMate grammar endpoints.
- `server.mjs` now keeps transport ownership, event push ownership, diagnostics normalization, and the TextMate grammar endpoints, but delegates the main JSON-RPC method ladder through the generated `dist/server/request-dispatch.mjs`.
- Open-file snapshot scheduling and heap-snapshot execution stay server-owned via injected callbacks, so the dispatch module can stay platform-agnostic while preserving the current instrumentation behavior.
- The TextMate grammar endpoints intentionally remain in `server.mjs` so the upcoming grammar/TextMate investigation can change that boundary directly instead of undoing a generic server split first.

## Slice 9 Progress

The ninth decomposition slice moves the remaining adapter protocol helpers out of `server.mjs`:

- `src/server/event-bridge.ts` now owns event-log truncation, diagnostics normalization for `$changeMany`, push-event translation for provider registration, TE2 event emission, and adapter status projection/logging.
- `src/server/stdio-protocol.ts` now owns the stdio framing contract: parsing inbound JSON lines, building JSON-RPC parse/error replies, and encoding `<<<RPC>>>`, `<<<PUSH>>>`, and startup-beacon output lines.
- `server.mjs` now keeps the HTTP/WebSocket shell, startup wiring, sync-trace/heap instrumentation, and top-level transport loop, but delegates bridge/protocol details through the generated typed modules.
- `server.mjs` is now effectively down to transport shell glue, but `workbench_client.mjs` still had large support clusters that needed extraction before a realistic strict entry-module conversion.

## Slice 10 Progress

The tenth decomposition slice resumes the client-side cutover by moving the broad connect-support clusters out of `workbench_client.mjs`:

- `src/extensions/catalog.ts` now owns extension identifier extraction, extension init sanitization, extension snapshot filtering, disk extension scanning, extension-host init data construction, workspace-folder init metadata, and language catalog construction from extension `contributes.languages`.
- `src/client/configuration.ts` now owns extension default extraction, settings schema bucket construction, virtual `vscode://schemas/*` content/stat/buffer handling, user/workspace settings parsing, and extension-host configuration init data.
- `workbench_client.mjs` keeps compatibility wrappers for the old helper names so the live `connect()` flow, `languageCatalog()`, `$readFile`, `$stat`, and extension-host bootstrap call sites stay stable.
- The normal WBA-local build and full `file_editor_cm6` app build now emit `dist/extensions/catalog.mjs` and `dist/client/configuration.mjs`.
- The client entry dropped from roughly 2,547 lines to roughly 1,861 lines after this slice. The remaining large client work is now mostly ext-host inbound message dispatch and the high-level connect/bootstrap orchestration shell.

## Slice 11 Progress

The eleventh decomposition slice moves the ext-host inbound dispatch body out of `workbench_client.mjs` and into the strict protocol layer:

- `src/protocol/ext-host-dispatch.ts` now owns decoded ext-host request handling, immediate RPC acks, main-thread reply construction, provider-registration side effects, diagnostics `$changeMany` fanout/logging, virtual/local/content-provider `$readFile` and `$stat` handling, `$tryOpenDocument`, workspace-trust follow-up, and terminal reply resolution for client-originated ext-host requests.
- `workbench_client.mjs` now keeps the decode/trace shell and listener registration, but delegates the request/reply behavior body through `handleExtHostRequest(...)` and `handleExtHostReply(...)`.
- The normal WBA-local build and full `file_editor_cm6` app build now emit `dist/protocol/ext-host-dispatch.mjs`.
- The client entry dropped again, from roughly 1,861 lines to roughly 1,610 lines after this slice.
- At this point the largest remaining client-owned area is the connect/bootstrap orchestration shell itself: ext-host handshake, bootstrap notifications, and remote-agent session wiring.

## Slice 12 Progress

The twelfth decomposition slice starts the connect/bootstrap shell split by moving the management-side orchestration out of `workbench_client.mjs`:

- `src/client/management.ts` now owns code-server root discovery, commit extraction, product-version loading, management remote-agent connect, management IPC bootstrap, environment fetch, extension scan/shape logging/sanitization, extension-ready wait, watcher setup, and ext-host init payload assembly.
- `workbench_client.mjs` now delegates the management half of `connect()` through `connectManagementSession(...)` and keeps only the runtime adapter wiring.
- The normal WBA-local build and full `file_editor_cm6` app build now emit `dist/client/management.mjs`.

## Slice 13 Progress

The thirteenth decomposition slice finishes the connect/bootstrap shell split by moving the extension-host-side orchestration out of `workbench_client.mjs`:

- `src/client/extension-host.ts` now owns extension-host remote-agent connect, handshake wait/init send, ext protocol listener registration, decode/trace shell, configuration bootstrap, language/provider bootstrap notifications, and workspace bootstrap.
- `workbench_client.mjs` now delegates the extension-host half of `connect()` through `connectExtensionHostSession(...)` and keeps only runtime adapters plus compatibility wrappers for the remaining helper clusters.
- The normal WBA-local build and full `file_editor_cm6` app build now emit `dist/client/extension-host.mjs`.
- After these two consecutive slices, the client entry dropped again, from roughly 1,610 lines to roughly 1,328 lines.
- The main client work left is no longer the big connect shell. What remains is the smaller cleanup around transport/session helper ownership, disconnect/session reset, and any later behavior-focused seams such as TextMate/bracket handling.

## Slice 14 Progress

The fourteenth decomposition slice moves the transport/session helper cluster out of `workbench_client.mjs`:

- `src/client/transport-session.ts` now owns request-id allocation wrappers, sent-request tracking, pending-request creation, JSON/mixed ext send helpers, terminal-ack send helpers, and disconnect/session reset behavior.
- `workbench_client.mjs` now delegates `_sendExt(...)`, `_sendExtPending(...)`, `_sendExtAwaitTerminalReply(...)`, `_sendExtMixed(...)`, and `disconnect()` through the typed transport/session module.
- The normal WBA-local build and full `file_editor_cm6` app build now emit `dist/client/transport-session.mjs`.

## Slice 15 Progress

The fifteenth decomposition slice moves the URI and local document/content-provider helper cluster out of `workbench_client.mjs`:

- `src/client/document-content.ts` now owns `vscode-remote`/`file` URI shaping, safe URI stringification, fs-path extraction, local stat payload normalization, local file reads/stats, ext-host content-provider round trips, and background `$acceptDocumentsAndEditorsDelta` document opens for virtual document support.
- `workbench_client.mjs` now delegates `_uriForPath(...)`, `_uriObjToStringSafe(...)`, `_fsPathFromUri(...)`, `_statPayloadFromFsStats(...)`, `_readLocalUriBuffer(...)`, `_statLocalUri(...)`, `_provideTextDocumentContent(...)`, and `_tryOpenDocument(...)` through the typed document-content module.
- The normal WBA-local build and full `file_editor_cm6` app build now emit `dist/client/document-content.mjs`.

## Slice 16 Progress

The sixteenth decomposition slice consolidates the remaining runtime-assembly builders out of `workbench_client.mjs`:

- `src/client/runtime-adapters.ts` now owns the runtime-assembly shapes for completions, semantic tokens, document features, workspace lifecycle, extension catalog/configuration, management bootstrap, extension-host bootstrap, ext-host dispatch, transport/session, and document-content helpers.
- `workbench_client.mjs` now mostly supplies state/callback wiring into those typed runtime builders rather than owning the runtime-object assembly bodies inline.
- The normal WBA-local build and full `file_editor_cm6` app build now emit `dist/client/runtime-adapters.mjs`.
- After these three consecutive slices, the client entry dropped again, from roughly 1,328 lines to roughly 1,231 lines.
- At this point the remaining WBA client work is mostly final shell cleanup and, separately, any behavior investigations like the TextMate/bracket boundary.

## Proposed Future Module Layout

```text
workbench_protocol_proxy/node_workbench_adapter/
  src/
    server.ts
    client/
      configuration.ts
      document-content.ts
      extension-host.ts
      management.ts
      runtime-adapters.ts
      transport-session.ts
      workbench-client.ts
      lifecycle.ts
      state.ts
      logging.ts
    protocol/
      rpc-ids.ts
      wire-encoding.ts
      ext-host-dispatch.ts
      ext-host-router.ts
      pending-requests.ts
      ack.ts
    extensions/
      catalog.ts
      registry.ts
      activation.ts
      intelligence/
        completions.ts
        diagnostics.ts
        folding-ranges.ts
        hovers.ts
        semantic-tokens.ts
        symbols.ts
    uri/
      uri-codec.ts
      remote-authority.ts
      http-uri.ts
      schema-uri.ts
    workspace/
      document-sync.ts
      editor-tabs.ts
      open-file.ts
      workspace-switch.ts
      watcher-events.ts
  dist/
    server.mjs
```

## Responsibility Boundaries

- Client: owns remote-agent connection lifecycle, state, and high-level orchestration.
- Protocol: owns VS Code RPC ids, binary wire encoding, pending requests, terminal ack handling, and ext-host inbound dispatch.
- Extensions: owns extension metadata, activation, provider registration, and language intelligence modules.
- Intelligence modules: own one feature family each and should share provider lookup, document identity, generation, and ack helpers.
- URI mechanics: owns `vscode-remote`, `file`, `http`, `https`, and `vscode://` URI conversion/resolution helpers. TextMate grammar and JSON schema behavior likely belongs here or in extension metadata helpers depending on final ownership.
- Workspace IPC: owns workspace root switching, active file/document lifecycle, editor tab deltas, project/file URI normalization, and watcher path publication.

## TypeScript Cutover Strategy

1. Keep extracting strict leaf modules first because they are deterministic and easy to validate with `node --check` plus targeted RPC smoke tests.
2. Move `rpc-ids`, pending request ownership, and ack handling next so all feature calls share one typed protocol layer.
3. Move provider registry and language intelligence into typed modules without changing the public JSON-RPC method names.
4. Move document sync/open-file/workspace switching after the protocol layer is typed, because those paths define the correctness boundary for `$acceptDocumentsAndEditorsDelta` and `$acceptModelChanged`.
5. Switch the shellspec to a bundled `dist/server.mjs` only after `server.mjs` and `workbench_client.mjs` have been reduced to typed source modules.

## Validation Targets For Future Decomposition

- Python: open large file, type `im`, verify extension completions appear without word fallback.
- Python: verify diagnostics remain path/owner correct after typing.
- Python: verify folding and symbols work after first open and after file switch.
- JS/TS: verify multi-provider completions still call all matching provider handles.
- JSON: verify schema-backed completions still work through the WBA/URI path.
- Workspace switch: verify active document is closed/reopened with the expected workspace root and no stale generation updates.
