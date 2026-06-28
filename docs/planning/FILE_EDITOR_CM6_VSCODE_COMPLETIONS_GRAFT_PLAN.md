# File Editor CM6 VS Code Completions Graft Plan

## Purpose

JavaScript/TypeScript completions are the one remaining broken language-intelligence surface after WBA provider discovery, draft sync, and semantic-token alignment were proven live. The next repair should stop extending the custom completion bridge and instead make Code TE2 use the same VS Code suggest/completion ownership model wherever practical.

The goal is not to invent a second suggest UI. The served Monaco/VS Code build already contains the real suggest controller, model, widget, filtering, and refiltering code. The graft should make our WBA-fed completion provider layer look like the provider layer VS Code expects.

## Current Implementation Status

- `app/apps/file_editor_cm6/monaco_editor/vscode_completion_vendor/languages.ts` vendors the full upstream `languages.ts` source as comments and exposes the small live completion-context/list surface needed by this graft.
- `app/apps/file_editor_cm6/monaco_editor/vscode_completion_vendor/mainThreadLanguageFeatures.ts` vendors the full upstream `mainThreadLanguageFeatures.ts` source as comments and exposes a live `_inflateSuggestDto(...)`-equivalent shim for `ISuggestResultDto`.
- `editor_language_bridge_providers.ts` now registers one Monaco completion provider per WBA provider handle and passes `providerHandle` into the request path.
- `workbench_service.py` now relays `providerHandle` and `timeoutMs` through Python without interpreting completion payloads.
- WBA `provideCompletionSingle(...)` now accepts numeric or numeric-string provider handles and returns the raw provider `ISuggestResultDto` under `result.dto`, while keeping the old readable `items` mirror for compatibility/debugging.
- The old merged WBA completion response remains as a compatibility/debug path when no `providerHandle` is supplied; the editor UI path should use the per-handle path.

## Current Failure Shape

- WBA can produce JS/TS completion results.
- Python completions work through a different provider source.
- JS/TS completions do not open on ordinary typing, and recent app-side DTO/inflater patching made the space-trigger behavior worse.
- The useful signal from prior instrumentation was that completion data reached the frontend, while the suggest lifecycle and filtering behavior still diverged from VS Code behavior.

## VS Code Modules That Own Suggestions

### Editor Suggest Runtime

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggestModel.ts`
  - Owns trigger-character handling, quick-suggestion scheduling, cancellation tokens, retriggering, incomplete-provider retriggering, and calling `provideSuggestionItems(...)`.
  - Key areas:
    - trigger-character provider map and `onDidType(...)`: lines 227-296
    - quick suggestions and `trigger({ auto: true })`: lines 382-434
    - provider request setup and cancellation token creation: lines 447-501
    - completion model construction and refilter entry: lines 530-540 and following

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggest.ts`
  - Owns provider fanout through `LanguageFeatureRegistry<CompletionItemProvider>`.
  - Computes default insert/replace ranges before async provider calls.
  - Calls each provider with the VS Code signature `provideCompletionItems(model, position, context, token)`.
  - Stops after the first provider group that returns results.
  - Key areas: lines 213-330.

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/completionModel.ts`
  - Owns fuzzy matching, word/refilter state, sorting, provider grouping for reuse, and incomplete-provider tracking.
  - Key areas:
    - line-context and provider item bookkeeping: lines 53-110
    - filter text / label fuzzy matching: lines 158-224
    - sorted filtered output: lines 235-282

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggestController.ts`
  - Owns controller/widget orchestration, focus behavior, accept/cancel commands, and command registration.
  - This should not be copied unless inspection proves the built VS Code source differs from what the runtime loads.

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggestWidget.ts`
  - Owns visible list rendering.
  - This should stay VS Code-owned.

### VS Code Completion Provider API Bridge

- `worktrees/vscode-te2-diff/src/vs/editor/common/languages.ts`
  - Defines the editor-facing completion contract.
  - Important contract: `provideCompletionItems(model, position, context, token)`, line 713.

- `worktrees/vscode-te2-diff/src/vs/workbench/api/browser/mainThreadLanguageFeatures.ts`
  - Registers one `languages.CompletionItemProvider` per extension-host completion-provider handle.
  - Calls ext-host with `$provideCompletionItems(handle, model.uri, position, context, token)`.
  - Inflates `ISuggestResultDto` into editor-facing `languages.CompletionItem`.
  - Key areas:
    - `_inflateSuggestDto(...)`: lines 571-608
    - `$registerCompletionsProvider(...)`: lines 611-645

- `worktrees/vscode-te2-diff/src/vs/workbench/api/common/extHostLanguageFeatures.ts`
  - Converts extension API completion items into `ISuggestResultDto`.
  - Computes default insert/replace ranges before provider async work.
  - Caches completion items for resolve support.
  - Key areas: `CompletionsAdapter.provideCompletionItems(...)`, lines 1166-1215.

- `worktrees/vscode-te2-diff/src/vs/workbench/api/common/extHost.protocol.ts`
  - Defines the compact DTO fields:
    - `ISuggestDataDtoField`: `a` label, `b` kind, `c` detail, `d` documentation, `e` sortText, `f` filterText, `g` preselect, `h` insertText, `i` insertTextRules, `j` range, `k` commitCharacters, `l` additionalTextEdits, `m` kindModifier, `n/o/p` command.
    - `ISuggestResultDtoField`: `a` defaultRanges, `b` completions, `c` isIncomplete, `d` duration.

## Code TE2 Modules That Currently Own Completions

### Frontend

- `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`
  - Currently caches WBA provider registrations by language/handle.
  - Currently registers a single Monaco completion provider per language.
  - Current provider calls `vscode.completions` and lets WBA fan out across all provider handles for that language.
  - Current provider also owns DTO/app-shape inflation logic. This is the main code to remove or replace.
  - Key areas:
    - completion registration cache and trigger-character aggregation: lines 430-473
    - current provider registration closure: lines 474-518

- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`
  - Owns guarded workbench provider calls, open-ack waiting, cancellation checks, and stale-context checks.
  - Completion-specific logic should become minimal once VS Code's suggest model owns cancellation and provider filtering.
  - Key area: `callWorkbenchProviderGuarded(...)`, lines 610-640.

- `app/apps/file_editor_cm6/monaco_editor/editor_socket_completion_registered_handler_utils.ts`
  - Handles WBA provider registration pushes from the socket and passes provider metadata into the frontend cache.
  - This can stay, but the consumer should register per provider handle instead of merging into one language provider.

### Python Relay

- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/workbench_service.py`
  - Relays `editor_workbench_completions` to WBA method `vscode.completions`.
  - Already passes `triggerKind`, `triggerCharacter`, and `text`.
  - It should remain transport-neutral and should not inflate or interpret completion items.
  - It should pass through `providerHandle` for per-handle requests.

### WBA

- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/extensions/provider-registry.ts`
  - Captures `$registerCompletionsProvider(handle, selector, triggerCharacters, supportsResolve, extensionId)`.
  - Already stores provider handle, selector, trigger characters, and resolve capability.
  - Key area: `registerCompletionsProvider(...)`, lines 313-335.

- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/completions.ts`
  - Currently calls ext-host `$provideCompletionItems`.
  - Current multi-provider path fans out and merges results inside WBA.
  - Current single-provider path exists and is closer to VS Code semantics.
  - Key areas:
    - document sync preflight: lines 137-150
    - multi-provider fanout/merge: lines 165-214
    - single-provider request: lines 217-245

- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/server/request-dispatch.ts`
  - Routes `vscode.completions` to WBA completions.
  - Must preserve and forward `providerHandle`.

## Remove Our Implementation

The custom completion implementation to remove is the merged language-level provider path, not the whole language bridge module.

Remove or replace:

- One-provider-per-language completion registration in `editor_language_bridge_providers.ts`.
- Frontend-side completion DTO inflation that is not directly copied from VS Code's `MainThreadLanguageFeatures._inflateSuggestDto(...)`.
- WBA multi-provider fanout for the editor UI path.
- Completion-specific global sequence or exact-version stale checks in the frontend. VS Code uses cancellation tokens plus suggest context/refiltering.

Keep:

- WBA provider discovery and provider-registration push events.
- WBA draft-text preflight via acknowledged `$acceptModelChanged`, because our ext-host document must see the live draft.
- Python relay, but only as a pass-through for `providerHandle`, position, trigger context, text, and DTO result.
- Existing hover/symbols/folding/semantic-token bridge behavior.

## Graft In VS Code Behavior

### Preferred Shape

Register one frontend completion provider per WBA provider handle, matching VS Code's `MainThreadLanguageFeatures.$registerCompletionsProvider(...)`.

That means:

- When WBA emits `provider/completions` for handle `H`, selector `S`, triggers `T`, and resolve capability `R`, the frontend registers a Monaco/VS Code `CompletionItemProvider` for that exact provider handle.
- That provider calls WBA with `providerHandle: H`.
- WBA calls exactly one ext-host provider via `$provideCompletionItems(handle, uri, position, context, token)`.
- WBA returns the raw `ISuggestResultDto` for that provider.
- The frontend provider returns:
  - `suggestions: result.b.map(d => inflateSuggestDto(result.a, d, extensionIdLike))`
  - `incomplete: result.c || false`
  - `duration: result.d`
  - `dispose()` if WBA exposes release semantics later

This lets the existing VS Code `suggest.ts` provider grouping, incomplete-provider handling, cancellation, refiltering, and widget behavior operate normally.

### Why Per-Handle Matters

Current Code TE2 merges all JS/TS providers in WBA before VS Code's suggest model sees the data. That bypasses part of VS Code's normal ownership:

- VS Code's `LanguageFeatureRegistry` sees individual providers.
- `suggest.ts` asks provider groups in order and stops after the first group with results.
- `CompletionModel.getItemsByProvider()` tracks provider ownership for reuse and incomplete retrigger.
- `suggestModel.ts` uses provider filters for trigger-character retrigger and incomplete retrigger.

A single merged language provider makes the VS Code suggest model think there is only one provider. That is not equivalent.

## Bend Decisions

### Preferred: Bend The Data We Feed It

Most practical target: make WBA emit the exact VS Code DTO shape and provider metadata, then keep VS Code's consumer logic as-is.

Reasons:

- WBA already receives the ext-host `ISuggestResultDto` from `$provideCompletionItems`.
- The compact DTO fields are already the VS Code protocol shape.
- Python can relay it verbatim.
- A future WBA sideband Socket.IO websocket can also relay the same DTO without another semantic rewrite.
- This avoids modifying `suggestModel.ts`, `suggest.ts`, `completionModel.ts`, or `suggestWidget.ts`, which are the highest-risk files to fork.

### Avoid: Bending VS Code Suggest To Our App-Shaped Data

Do not teach VS Code's suggest model about `{ items, isIncomplete }` or Code TE2's custom completion object shape. That keeps a parallel semantic layer alive and preserves the current failure class.

### Acceptable TE2-Specific Bend

The only TE2-specific behavior that should stay in the completion path is document synchronization:

- frontend sends current draft text to WBA for completion requests;
- WBA normalizes text consistently with document lifecycle;
- WBA waits for acknowledged didChange before calling the provider.

This is not a suggest behavior fork. It is the TE2 equivalent of VS Code's invariant that provider calls observe the current text model.

## Implementation Slices

### Slice 1: Stabilize And Remove Regressing App Patch

- Remove the recent app-side DTO-inflater experiment unless it is replaced directly by a copied VS Code inflater.
- Keep any proven provider signature correction only if it matches `languages.ts`.
- Build and version after the cleanup.

### Slice 2: WBA Raw DTO Single-Provider Contract

- Make WBA `provideCompletionSingle(...)` return the raw `ISuggestResultDto` under a stable field such as `dto`.
- Preserve the old merged `vscode.completions` response only for compatibility/debug callers, or add a separate explicit method such as `vscode.completionsProvider`.
- Ensure `request-dispatch.ts` forwards `providerHandle`.
- Ensure Python relay forwards `providerHandle` without interpreting it.

### Slice 3: Frontend Per-Handle Provider Registration

- Replace language-level completion provider registration with handle-level registration.
- Use a registration key like `${langId}:${handle}`.
- Each registered provider has:
  - `triggerCharacters` from that handle only;
  - `_debugDisplayName` equivalent if available;
  - `provideCompletionItems(model, position, context, token)`.
- Each provider call passes `providerHandle`.
- Do not aggregate trigger characters across providers except where VS Code itself does through `suggestModel.ts`.

### Slice 4: Copy VS Code Completion Adapter Logic

- Copy the relevant `MainThreadLanguageFeatures._inflateSuggestDto(...)` logic into a local completion adapter module, or modify the VS Code source build if the bootstrap bundle exposes the right class/service boundary.
- Keep the field mapping identical to VS Code protocol names.
- Do not add custom filter/range behavior outside the copied VS Code logic.

Candidate local module if copying into app source:

- `app/apps/file_editor_cm6/monaco_editor/editor_vscode_completion_adapter.ts`

Candidate VS Code fork target if modifying folded source:

- `worktrees/vscode-te2-diff/src/vs/workbench/api/browser/mainThreadLanguageFeatures.ts`

Decision point: use the VS Code fork target only if the built TE2 Monaco/bootstrap runtime actually instantiates that workbench API bridge in the editor. If it does not, copy the small adapter logic locally and keep a citation/comment pointing to the source file and line range.

### Slice 5: Runtime Proof

Use fresh runtime tests after rebuild/version:

- Verify provider registry shape from the live editor:
  - JS/TS should show one registered provider per WBA handle.
  - The provider list should not collapse to a single merged Code TE2 completion provider.
- Verify WBA single-provider DTO:
  - `dto.a` default ranges;
  - `dto.b.length > 0`;
  - `dto.c` incomplete when applicable;
  - `dto.d` duration if present.
- Verify JS `fun`:
  - suggestions open while typing, not only after space;
  - list filters by `f`, `fu`, `fun`;
  - no broad unfiltered list after a stale space request.
- Verify `// @ts-`:
  - stop-at-dash behavior should be classified separately unless a real provider trigger exists for `-`.
- Verify Python still works.

## Build And Publication Notes

- Editing `app/apps/file_editor_cm6/monaco_editor/**` requires:
  - `cd app/apps/file_editor_cm6`
  - `node build.mjs`
  - synced version surfaces in `pyproject.toml`, `app/apps/file_editor_cm6/manifest.json`, and `app/apps/file_editor_cm6/static/version.txt`

- Editing `worktrees/vscode-te2-diff/**` requires the VS Code/Monaco build path:
  - `cd worktrees/vscode-te2-diff`
  - `./build_monaco_te2.sh`
  - then verify the built outputs under `app/static/vendor/monaco-editor-core/`

- Do not directly edit `app/static/vendor/monaco-editor-core/esm/**` as source. Those files are build outputs.

## Open Questions Before Implementation

- Does the TE2 bootstrap bundle instantiate `MainThreadLanguageFeatures`, or does our app source have to copy the completion adapter logic locally?
- Does WBA need `$releaseCompletionItems` support before resolve support matters for JS/TS?
- Should the existing `vscode.completions` method be kept as a merged debug method while adding a new per-handle method, or should it switch behavior when `providerHandle` is present?
- Can the live provider registration push include extension id/display name so `_debugDisplayName` and `extensionId` match VS Code more closely?

## Preferred Final Direction

The most practical graft is:

1. Do not fork VS Code's suggest model, completion model, controller, or widget.
2. Register one frontend provider per WBA provider handle.
3. Make WBA return raw `ISuggestResultDto` for that exact handle.
4. Inflate DTOs with copied VS Code `MainThreadLanguageFeatures` logic.
5. Keep Python as a pass-through relay.

That bends the data we feed into VS Code, not VS Code's suggest machinery.
