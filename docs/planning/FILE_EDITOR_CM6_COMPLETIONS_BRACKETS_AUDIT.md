# File Editor CM6 Completions / Bracket Matching Audit

This note follows the TextMate/theme/semantic-token refactor.

At this point:

- TextMate loads quickly
- semantic tokens are working again and are materially healthier than before
- the remaining editor-intelligence issues are narrower:
  - semantic autocomplete is unreliable
  - bracket matching / highlighting is not working

This document covers three things:

1. current TE2 callers, providers, and usage for completions and brackets
2. the matching VS Code source flow from `worktrees/vscode-te2-diff`
3. a proposal for how TE2 should match that model

## Scope

Current TE2 files inspected:

- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_vscode_language_config_utils.js`
- `app/apps/file_editor_cm6/monaco_editor/editor_monaco_options_utils.js`
- `app/apps/file_editor_cm6/monaco_editor/editor_ui_editor_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/workbench_service.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`

VS Code files inspected:

- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggestModel.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggest.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/standalone/browser/standaloneLanguages.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/languages/languageConfigurationRegistry.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/textModelBracketPairs.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsImpl.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/standalone/browser/standaloneEditor.ts`

## Current TE2 Status

Observed current behavior:

- Python semantic autocomplete works sometimes, but not deterministically
- JavaScript / TypeScript semantic autocomplete is effectively absent
- bracket matching / highlighting is absent

That makes this a different problem from the previous TextMate/theme audit.

The remaining issues now point more directly at:

- completion provider ownership and scheduling
- language configuration and bracket-pairs ownership

## 1. Current TE2 Callers, Providers, And Usage

### 1.1 Completion Registration And Request Path

Current TE2 completion flow:

1. Monaco provider registration happens in:
   - `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`
2. That registration is installed from:
   - `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`
   - via `installVscodeApiLanguageBridgeProviders()`
3. Completion requests from the Monaco provider call:
   - `callVscodeApiGuarded('completions', 'vscode.completions', ...)`
   - in `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`
4. Python forwards the request through:
   - `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
   - `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/workbench_service.py`
5. The WBA handles:
   - `vscode.completions`
   - in `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
6. The adapter executes against extension-host providers in:
   - `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`

### 1.2 Completion Provider Discovery In TE2

The WBA already discovers completion providers.

Provider registration is captured in:

- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`
  - `$registerCompletionsProvider`
  - stored in `_providers.completions`
  - emits `provider/completions` events

Important current mismatch:

- semantic-token provider registration is explicitly pushed to the frontend from:
  - `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
- completion-provider registration is not pushed through an equivalent frontend
  ownership path
- the frontend currently does not consume a completion-provider event surface

So TE2 completion registration currently works like this:

- frontend eagerly registers Monaco completion providers per language
- backend WBA separately tracks actual extension-host completion providers
- the frontend does not directly mirror WBA completion-provider state

That is a split-brain design.

### 1.3 Completion Usage In TE2

Current TE2 completion provider behavior in the frontend:

- hard-coded `triggerCharacters` are used in:
  - `app/apps/file_editor_cm6/monaco_editor/editor_language_bridge_providers.ts`
- the provider flushes mirror debounce before making the RPC call
- the request is guarded by:
  - `callVscodeApiGuarded(...)`
  - sequence counters in `editor_workbench_runtime.ts`
  - current-language-context validation

Current backend usage in the WBA:

- `workbench_client.mjs` pre-flushes `didChange`
- finds all matching provider handles for the current language
- calls `$provideCompletionItems`
- merges completion results from multiple providers

So the backend side is already closer to a real provider-driven model than the
frontend side.

### 1.4 Bracket Matching And Highlighting In TE2

Bracket matching is not owned by TE2 TextMate code directly.

The important current TE2 bracket path is:

1. VS Code language metadata is loaded by:
   - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_runtime.ts`
2. Language configuration is applied via:
   - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_language_config_utils.js`
   - `monaco.languages.setLanguageConfiguration(langId, cfg)`
3. Active model language is set from:
   - `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`
   - and the TextMate/theme owner path
4. Editor options only control:
   - auto-closing behavior
   - not the underlying bracket-pairs model
   - from `app/apps/file_editor_cm6/monaco_editor/editor_monaco_options_utils.js`

Important current implication:

- bracket matching depends on Monaco having the right language configuration
- bracket matching also depends on Monaco tokenization/model state being in a
  coherent place
- semantic tokens are not the primary owner of bracket matching
- TextMate theme application is not the primary owner of bracket matching

### 1.5 What Looks Wrong In TE2 Today

#### Completion side

- TE2 eagerly registers completion providers for language IDs, but does not use
  WBA completion-provider discovery as the frontend source of truth
- trigger characters are hard-coded in the frontend instead of being derived
  from provider data
- request validity is guarded by TE2-specific sequence/context logic that can
  suppress otherwise-valid results
- the backend/provider side and the frontend registration side are not modeled
  as one ownership chain

#### Bracket side

- TE2 relies on language configuration arriving through the `vscode_api`
  language-list path, but the runtime does not yet treat that as an explicit,
  first-class boot prerequisite for the active model
- earlier bracket “fixes” were aimed at theme/options, but the real owner is
  language configuration plus Monaco bracket-pairs state
- there is no dedicated audit or owner seam for language configuration the way
  there now is for TextMate/theme

## 2. VS Code Discovery: The VS Code Way

### 2.1 Completion Ownership In VS Code

The relevant VS Code pieces are:

- `worktrees/vscode-te2-diff/src/vs/editor/standalone/browser/standaloneLanguages.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggestModel.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/contrib/suggest/browser/suggest.ts`

Observed VS Code shape:

1. Providers register into the language-feature registry:
   - `languageFeaturesService.completionProvider.register(...)`
2. `SuggestModel` owns:
   - trigger-character listening
   - model/editor gating
   - retrigger behavior
   - provider filtering and reuse
3. `provideSuggestionItems(...)` owns:
   - provider collection
   - request fanout
   - result normalization
   - default range handling
   - completion-item shaping

Key point:

- provider discovery and request scheduling are part of one coherent model
- the editor suggestion system is provider-driven
- the bridge/provider layer is thin; it does not invent separate ad hoc
  scheduling semantics in parallel

### 2.2 Bracket Ownership In VS Code

The relevant VS Code pieces are:

- `worktrees/vscode-te2-diff/src/vs/editor/common/languages/languageConfigurationRegistry.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/textModelBracketPairs.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsImpl.ts`

Observed VS Code shape:

1. Language configuration is owned by:
   - `ILanguageConfigurationService`
2. Bracket definitions come from language configuration:
   - `brackets`
   - `colorizedBracketPairs`
   - `autoClosingPairs`
   - related language config state
3. `BracketPairsTextModelPart` owns:
   - bracket-pairs state for the model
   - rebuilds on:
     - language configuration changes
     - model option changes
     - language changes
     - content changes
     - token changes
4. The text model exposes bracket matching through:
   - `matchBracket(...)`
   - `findPrevBracket(...)`
   - `findNextBracket(...)`
   - and related APIs in `textModelBracketPairs.ts`

Key point:

- bracket matching is a text-model service concern fed by language
  configuration and tokenization state
- it is not a theme hack
- it is not a semantic-token feature

### 2.3 Tokenization Bootstrap In VS Code

`worktrees/vscode-te2-diff/src/vs/editor/standalone/browser/standaloneEditor.ts`
shows another important piece:

- standalone tokenization is explicitly realized via:
  - `TokenizationRegistry.getOrCreate(languageId)`

That matters because it reinforces the VS Code pattern:

- language configuration
- tokenization support
- bracket-pairs model

all belong to editor/model services, not to ad hoc theme or request glue.

## 3. Proposal For TE2 To Match This Model

### 3.1 Completion Proposal

TE2 should move toward this ownership split:

1. WBA provider discovery becomes the source of truth for completion-provider
   availability
2. the frontend completion bridge becomes a thin Monaco-facing provider surface
3. request scheduling stays Monaco/editor-driven, not TE2-custom-driven
4. WBA metadata should drive:
   - which languages actually have completion providers
   - trigger characters
   - provider availability changes

Concrete TE2 direction:

- create an explicit completion-provider state/cache in the frontend runtime
  that mirrors WBA provider events
- stop treating “installed VS Code language” as equivalent to “has completion
  provider”
- make `editor_language_bridge_providers.ts` consult provider availability from
  that state instead of blind per-language registration
- remove or reduce hard-coded trigger-character assumptions where provider data
  exists
- keep `callVscodeApiGuarded(...)` only as a stale/cancel boundary, not as the
  primary owner of completion scheduling semantics

In other words:

- Monaco should remain the suggestion scheduler
- WBA should remain the provider authority
- TE2 should be the bridge, not a second suggestion engine

### 3.2 Bracket Proposal

TE2 should stop framing bracket matching as a TextMate or semantic-token issue.

The right TE2 direction is:

1. introduce a clearer language-configuration ownership seam
2. make active-model language configuration part of the boot/open contract
3. ensure bracket-relevant config is present before or with active-model
   language application
4. treat bracket matching failures as:
   - missing language configuration
   - late language configuration
   - tokenization/model churn
   - or model-language mismatch

Concrete TE2 direction:

- create a lightweight language-configuration owner adjacent to the current
  TextMate/theme owner
- have that owner guarantee:
  - VS Code language list loaded
  - `configuration_raw` parsed/applied
  - active model language configured before post-boot reconcile work
- keep editor options limited to actual editor options
- do not try to repair bracket matching via theme patches

### 3.3 Matching The VS Code Shape More Closely

The target model for TE2 should be:

- TextMate/theme owner:
  - grammar/theme/color-map concerns
- language-configuration owner:
  - brackets, auto-closing pairs, on-enter rules, word patterns
- completion bridge owner:
  - provider availability mirror
  - Monaco registration
  - transport calls to WBA
- semantic-token bridge owner:
  - provider legend mirror
  - Monaco semantic-token provider registration
  - transport calls to WBA

That is much closer to the VS Code separation of concerns:

- theme/tokenization services
- language configuration service
- suggest model / provider registry
- semantic-token services

## Most Likely Immediate Follow-Ups

### 1. Completion follow-up

First audit target:

- prove whether JS/TS completion failure is because:
  - no WBA completion provider is actually present
  - TE2 never mirrors provider availability to the frontend
  - trigger characters are wrong
  - `callVscodeApiGuarded(...)` is canceling valid requests

### 2. Bracket follow-up

First audit target:

- prove whether bracket matching failure is because:
  - `configuration_raw` is missing or malformed
  - `setLanguageConfiguration(...)` is not landing in time for the active model
  - current file opens are swapping model language before config is ready
  - tokenization churn is leaving Monaco bracket-pairs state stale

## Short Conclusion

The current TE2 architecture is now in a better place than it was before the
TextMate/theme cleanup.

The remaining gaps are no longer “tokenization is broadly broken.”

They are much more specific:

- completions need a provider-driven ownership model that mirrors VS Code more
  closely
- bracket matching needs a language-configuration-first ownership model that
  mirrors VS Code more closely
