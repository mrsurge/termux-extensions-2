# File Editor CM6 TextMate / Theme / Semantic Tokens Audit

This note maps the current `file_editor_cm6` flow against the VS Code source in
`worktrees/vscode-te2-diff`.

Goal:

- identify where TE2 requests and applies TextMate tokenization
- identify where TE2 requests and applies semantic tokens
- identify where TE2 applies themes / token color maps
- compare that to the VS Code architecture we build against
- isolate likely mismatch points behind the current regressions

## Progress Since The Last Refactor Slice

Current state after the recent TextMate/theme/semantic-token cleanup:

- TextMate/theme ownership is now more centralized through:
  - `app/apps/file_editor_cm6/monaco_editor/editor_textmate_theme_owner_runtime.ts`
- Boot and open are materially faster because duplicate TextMate/theme apply paths
  were reduced.
- Semantic tokens are now working again in the current TE2 flow and no longer
  thrash the editor during boot the way they did before the ownership cleanup.
- Remaining problems are now narrower:
  - semantic autocomplete is still unreliable
    - Python: hit and miss
    - JavaScript / TypeScript: effectively not working
  - bracket matching / highlighting is still not working

That means this note is no longer describing a broad broken tokenization stack.
It is now mainly a progress marker showing that:

- the TextMate/theme centralization direction was correct
- the semantic-token path is healthier than before
- the next architecture targets should move to:
  - completion-provider ownership / request scheduling
  - language-configuration / bracket-pairs ownership

## Scope

Current TE2 files inspected:

- `app/apps/file_editor_cm6/monaco_editor/inline_host.js`
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_monaco_boot_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_model_language_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_textmate_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_socket_semantic_registered_handler_utils.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_ui_editor_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_socket_connection_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_textmate_theme_owner_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/workbench_service.py`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`

VS Code files inspected:

- `worktrees/vscode-te2-diff/src/vs/workbench/services/textMate/browser/textMateTokenizationFeatureImpl.ts`
- `worktrees/vscode-te2-diff/src/vs/workbench/services/textMate/browser/tokenizationSupport/textMateTokenizationSupport.ts`
- `worktrees/vscode-te2-diff/src/vs/workbench/services/textMate/common/TMGrammarFactory.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/tokenizationRegistry.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/standalone/browser/standaloneThemeService.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/semanticTokens/browser/documentSemanticTokens.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/semanticTokens/browser/viewportSemanticTokens.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/semanticTokens/common/getSemanticTokens.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/services/semanticTokensStylingService.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/services/semanticTokensProviderStyling.ts`
- `worktrees/vscode-te2-diff/src/vs/platform/theme/common/tokenClassificationRegistry.ts`

Note:

- some VS Code textMate files were inspected via `git show` because the worktree
  is sparse and not every source file is present on disk

## Current TE2 Flow

### 1. TextMate Assets

Static TextMate runtime assets are loaded by:

- `app/apps/file_editor_cm6/monaco_editor/inline_host.js`

That host injects:

- `vscode-oniguruma.umd.js`
- `vscode-textmate.umd.js`
- bootstrap CSS / breadcrumbs CSS

So TE2 currently owns TextMate as a browser-side runtime, not a backend-side
tokenization service.

### 2. Theme Load / Theme Apply

Theme loading and theme application are now centered primarily in:

- `app/apps/file_editor_cm6/monaco_editor/editor_textmate_theme_owner_runtime.ts`

with helper implementations in:

- `app/apps/file_editor_cm6/monaco_editor/editor_theme_loader_runtime_utils.js`
- `app/apps/file_editor_cm6/monaco_editor/editor_theme_apply_runtime_utils.js`

Current TE2 pattern:

1. load theme JSON into a local cache
2. convert theme JSON to a Monaco theme
3. call Monaco theme application
4. call `applyThemeToTextmateRegistry(...)`
5. still force `semanticHighlighting` by mutating the theme service object in:
   - `app/apps/file_editor_cm6/monaco_editor/editor_ui_editor_runtime.ts`
6. reset tokenization on all models after theme apply

TextMate theme application itself happens in:

- `app/apps/file_editor_cm6/monaco_editor/editor_textmate_runtime.ts`

That code:

1. converts VS Code theme JSON into a TextMate registry theme payload
2. calls `tmRegistry.setTheme(...)`
3. reads the TextMate color map from `tmRegistry.getColorMap()`
4. pushes that color map into Monaco via `monaco.languages.setColorMap(...)`

This is the TE2 equivalent of VS Code’s token color map bridge.

### 3. TextMate Grammar Discovery / Load / Install

Current grammar discovery and install path lives in:

- `app/apps/file_editor_cm6/monaco_editor/editor_textmate_runtime.ts`

Current TE2 pattern:

1. `ensureTextmateTokenization(languageId, filePath)` is called
2. it asks the workbench layer for grammar metadata:
   - `grammars_list`
   - `grammars_load`
3. it resolves a scope name for the language/path
4. it loads the grammar through a browser-side `vscode-textmate.Registry`
5. it installs a Monaco token provider via `monaco.languages.setTokensProvider(...)`
6. it marks the language as installed in a local `tmInstalled` map

Current trigger points were reduced, but the path still ultimately depends on:

- `app/apps/file_editor_cm6/monaco_editor/editor_textmate_theme_owner_runtime.ts`
- boot/open callers that delegate into that owner
- model creation / reconciliation in `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`

Important current characteristic:

- TE2 now has a clearer TextMate/theme owner than it did previously
- but some low-level responsibilities are still split across:
  - `editor_textmate_theme_owner_runtime.ts`
  - `editor_textmate_runtime.ts`
  - `editor_vscode_api_runtime.ts`
- so the architecture is improved, but not fully VS Code-shaped yet

### 4. Semantic Tokens Provider Registration

Current TE2 semantic token provider registration is push-driven.

Path:

1. WBA provider registration happens in:
   - `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`
2. adapter emits a push event from:
   - `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
3. frontend receives provider-registration payload and handles it in:
   - `app/apps/file_editor_cm6/monaco_editor/editor_socket_semantic_registered_handler_utils.ts`
4. frontend caches the legend and registers a Monaco semantic-tokens provider in:
   - `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`

So TE2 currently treats semantic token capability discovery as:

- adapter push
- frontend cache
- frontend provider registration

Recent improvement:

- TE2 also now proactively ensures semantic-token registration for the immediate
  active language from:
  - `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`

That reduced the “initial load works, next file open breaks” behavior.

### 5. Semantic Tokens Request Path

Current TE2 semantic token request path:

1. Monaco provider callback in:
   - `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`
2. guarded request through:
   - `callVscodeApiGuarded(...)`
   - `editorWorkbenchCall(...)`
3. Python bridge in:
   - `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/workbench_service.py`
4. WBA RPC methods:
   - `vscode.semanticTokens`
   - `vscode.semanticTokensLegend`
   - `vscode.semanticTokensRange`
5. adapter-side execution in:
   - `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
   - `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`

Current TE2 semantic token styling/application:

- frontend converts returned token data to Monaco semantic token results
- frontend forces `semanticHighlighting` in `editor_ui_editor_runtime.ts`
- TE2 does not currently mirror VS Code’s dedicated semantic token styling
  service boundary

## VS Code Source Flow

### 1. TextMate Ownership

VS Code owns TextMate tokenization in:

- `src/vs/workbench/services/textMate/browser/textMateTokenizationFeatureImpl.ts`

This file is the central owner for:

- grammar extension-point intake
- tokenization support factory registration
- grammar factory creation
- theme updates for TextMate tokenization
- color map propagation to Monaco/editor tokenization infrastructure

### 2. Grammar Factory

Grammar loading happens in:

- `src/vs/workbench/services/textMate/common/TMGrammarFactory.ts`

Important behaviors:

1. owns a `vscode-textmate.Registry`
2. loads grammars by scope name
3. resolves injections / embedded languages
4. applies theme by `setTheme(theme, colorMap)`
5. creates grammars by language through `createGrammar(...)`

This is a stable service boundary. The editor itself does not manually juggle
scope-name lookup, grammar caching, and token provider install across several
boot paths.

### 3. TextMate Tokenization Support Registration

VS Code registers tokenization lazily in:

- `textMateTokenizationFeatureImpl.ts`

Important behaviors:

1. grammar extension point is validated once
2. `TokenizationRegistry.registerFactory(languageId, lazySupport)` is used
3. `TokenizationRegistry.getOrCreate(languageId)` resolves support when needed
4. tokenization support instances are created by:
   - `TextMateTokenizationSupport`
   - `TokenizationSupportWithLineLimit`

This means VS Code’s tokenization install point is centralized and lazy.

TE2 currently does not mirror that architecture. It installs Monaco token
providers directly inside ad hoc frontend runtime code.

### 4. Theme / Color Map Application

TextMate theme updates in VS Code happen in:

- `textMateTokenizationFeatureImpl.ts::_updateTheme(...)`

That function:

1. builds current TextMate theme payload from the current workbench theme
2. calls `grammarFactory.setTheme(...)`
3. converts token color map to editor colors
4. generates token CSS
5. calls `TokenizationRegistry.setColorMap(...)`

For standalone Monaco, the matching editor-side apply point is:

- `src/vs/editor/standalone/browser/standaloneThemeService.ts`

There, `_updateThemeOrColorMap()`:

1. computes the current theme CSS
2. computes token CSS from the theme token color map
3. calls `TokenizationRegistry.setColorMap(colorMap)`
4. fires theme-change events

Important takeaway:

- VS Code does not force TextMate via repeated `setTokensProvider(...)` calls on
  open/boot/SSOT paths
- it updates the token color map at the theme-service / tokenization-service
  boundary

### 5. Semantic Tokens Request / Apply

Semantic token request orchestration in VS Code lives in:

- `src/vs/editor/contrib/semanticTokens/browser/documentSemanticTokens.ts`
- `src/vs/editor/contrib/semanticTokens/browser/viewportSemanticTokens.ts`
- request helpers:
  - `src/vs/editor/contrib/semanticTokens/common/getSemanticTokens.ts`

Important behaviors:

1. document semantic tokens are fetched only when:
   - semantic coloring is enabled
   - a provider exists
   - the model is attached to an editor
2. viewport semantic tokens are fetched separately for visible ranges
3. theme changes and content changes reschedule semantic token fetches
4. results are applied into model tokenization by:
   - `model.tokenization.setSemanticTokens(...)`
   - `model.tokenization.setPartialSemanticTokens(...)`

VS Code semantic token styling lives in:

- `src/vs/editor/common/services/semanticTokensStylingService.ts`
- `src/vs/editor/common/services/semanticTokensProviderStyling.ts`

That styling is theme-derived through:

- `src/vs/platform/theme/common/tokenClassificationRegistry.ts`
- theme service `getTokenStyleMetadata(...)`

Important takeaway:

- semantic token styling is a theme-service concern
- semantic token request scheduling is an editor/model feature concern
- provider legends are not the primary styling source; theme token metadata is
  the styling source

## Comparison

### TE2 TextMate vs VS Code TextMate

VS Code:

- one owning service
- one grammar factory
- one tokenization registry integration point
- one theme/color-map bridge

TE2:

- browser-side runtime owns TextMate directly
- grammar metadata comes from WBA
- grammar installation is done by frontend runtime code
- multiple boot/open/language paths can trigger TextMate install
- theme apply and grammar apply are coupled loosely rather than through one
  tokenization service owner

### TE2 Semantic Tokens vs VS Code Semantic Tokens

VS Code:

- request scheduling is model/editor driven
- semantic tokens are applied into model tokenization
- styling comes from theme token metadata

TE2:

- provider discovery is push-driven from WBA
- provider registration is cached in the frontend
- semantic token requests are routed through custom Monaco providers
- semantic highlighting is forced by mutating the theme service object
- token styling boundary is not clearly separated from boot/runtime glue

## Likely Mismatch Points

### 1. TextMate Is Installed Too Opportunistically

Current likely problem:

- TE2 can attempt TextMate install from boot, model-language application, and
  SSOT/open reconciliation

Expected direction:

- one authoritative tokenization owner
- one lazy install path per language/model

### 2. Theme Apply and Tokenization Apply Are Too Tightly Coupled In The Frontend

Current likely problem:

- TE2 theme application resets model tokenization and pushes color maps directly
  while TextMate installation may still be occurring in parallel

Expected direction:

- a clearer service boundary between:
  - theme load
  - token color map apply
  - grammar install

### 3. Semantic Tokens Styling Is Not Modeled Like VS Code

Current likely problem:

- TE2 forces `semanticHighlighting` directly on the theme object
- semantic token styling does not clearly flow through token classification /
  theme metadata

Expected direction:

- semantic token styling should be derived from theme/token classification data,
  not only from a forced flag

### 4. TE2 Frontend Owns Too Much Tokenization Coordination

Current likely problem:

- frontend runtime directly coordinates grammar lookup, grammar load, token
  provider registration, theme apply, semantic provider registration, and
  semantic token requests

Expected direction:

- fewer cross-cutting runtime triggers
- more centralized ownership boundaries

## Refactor Targets

### Target A: Centralize TextMate Ownership

Candidate direction:

- create one TE2 tokenization owner responsible for:
  - language -> scope resolution
  - grammar load cache
  - `setTokensProvider(...)`
  - `setColorMap(...)`
  - theme-to-TextMate theme application

### Target B: Separate Theme Apply From Grammar Install

Candidate direction:

- explicit phases:
  1. theme JSON load/cache
  2. Monaco theme apply
  3. token color map apply
  4. model tokenization refresh

### Target C: Revisit Semantic Tokens Styling

Candidate direction:

- stop treating forced semantic highlighting as the primary mechanism
- map current theme/token-classification inputs more explicitly
- compare TE2 theme JSON conversion against what VS Code expects

### Target D: Reduce Boot/Open Re-application Paths

Candidate direction:

- keep boot snapshot for initial construction
- keep SSOT/open for reconciliation
- avoid duplicate language/tokenization/theme work when nothing materially
  changed

## What This Audit No Longer Needs To Prove

The earlier highest-risk hypothesis was that the entire TextMate/theme/semantic
token setup was broadly unstable.

That is no longer the best framing.

The current state suggests:

- TextMate/theme centralization improved the system
- semantic tokens are largely back on the correct path
- the next work should split into two separate audits:
  - completion ownership / provider flow
  - bracket matching / language configuration flow

## Immediate Use

This note is a mapping document.

It should be used as the reference for:

- fixing bracket highlighting / matching
- fixing semantic token regressions
- deciding whether TextMate/theme/semantic token ownership should be moved into
  a more centralized frontend service or split across backend/frontend seams
