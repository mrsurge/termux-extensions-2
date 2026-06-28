# File Editor CM6 `vscode_api` Removal Audit

Goal:

- remove `vscode_api` as a real runtime concept
- stop routing any live editor behavior through the deprecated `vscode_api` lane
- straighten naming anywhere old `vscode_api` labels now actually mean WBA-owned behavior

This note treats the workbench adapter as the only legitimate live language
intelligence surface.

## Conclusion

`vscode_api` is currently split across three different realities:

1. truly dead transport/shell surfaces
2. still-live frontend/runtime code that incorrectly depends on those dead surfaces
3. misleading labels and names that no longer describe the real ownership

The main architectural problem is not only that `vscode_api` is deprecated.
It is that the codebase still uses that name for:

- dead websocket harness code
- project-scoped extension-enablement state
- frontend language/theme bootstrap utilities
- diagnostics marker owner/log strings

Those are different responsibilities and must be separated before removal is
clean.

## Classification

### Remove Outright

These are dead harness surfaces and should be deleted, not migrated:

- `app/apps/file_editor_cm6/services/vscode_api_transport.py`
- `app/apps/file_editor_cm6/vscode_api_shell_manager.py`
- `app/apps/file_editor_cm6/shellspec/vscode_api.yaml`
- `app/apps/file_editor_cm6/manifest.json`
  - service entry `vscode_api_transport`
- deprecated worker endpoints in `app/apps/file_editor_cm6/main.py`
  - `/vscode_api/discover`
  - `/vscode_api/start`
  - `/vscode_api/resolve`
- Monaco frontend websocket-harness helpers that exist only for that dead lane:
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_start_utils.js`
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_discover_utils.js`
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_ws_url_utils.js`
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_message_utils.js`
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_close_utils.js`
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_call_request_utils.js`
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_notify_utils.js`
  - `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_payload_utils.js`
- host-side dead websocket client code in `app/apps/file_editor_cm6/main.js`
  - `ensureVscodeApiWs()`
  - `vscodeApiCall()`
  - `vscodeApiPending`
  - `vscodeApiWs`

These are dead because they still target:

- `/api/app/file_editor_cm6/vscode_api/start`
- `/api/app/file_editor_cm6/vscode_api/discover`
- `/vscode_api_ws`

and those surfaces are already explicitly deprecated.

### Migrate To WBA

These are still live responsibilities, but they are wrongly coupled to the old
`vscode_api` naming or transport:

- `app/apps/file_editor_cm6/monaco_editor/editor_vscode_api_runtime.ts`
  - websocket transport pieces are dead
  - language catalog / config install state is still live
  - theme cache / theme application helper state is still live
- `app/apps/file_editor_cm6/monaco_editor/editor_vscode_languages_source_utils.js`
  - currently calls `vscode.languages.list` through `vscodeApiCall(...)`
- `app/apps/file_editor_cm6/monaco_editor/editor_monaco_boot_runtime.ts`
  - still calls `vscode.bootstrap.snapshot`
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`
  - still assembles a `vscodeApiRuntime`
  - still exposes `vscodeApiCall(...)`
  - still uses `ensureVscodeLanguagesInstalled()`
- `app/apps/file_editor_cm6/project_sidecar.py`
  - `vscode_api.enabled_extensions`
- `app/apps/file_editor_cm6/main.py`
  - `/vscode_api/extensions/enabled`

These are not dead because they still represent real product concerns:

- language ids, extensions, filename maps, and language configuration
- project-scoped enabled-extension preferences
- theme/bootstrap metadata

But the owner is no longer `vscode_api`. These concerns must move to WBA-owned
or extension-host-owned naming and APIs.

### Rename Only

These paths are already effectively WBA-owned, but they still carry stale
`vscode_api` names:

- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`
  - hardcoded marker owner clear: `'vscode_api'`
  - diagnostic log prefixes: `[vscode_api] ...`
- comments in:
  - `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`
  - other editor runtime files that describe live behavior as `vscode_api`

These should not keep the old name because they obscure the real architecture.

## Detailed Inventory

### 1. Dead Transport / Shell Harness

#### `manifest.json`

`app/apps/file_editor_cm6/manifest.json` still mounts:

- `vscode_api_transport`

That service exists only to proxy `/vscode_api_ws`, which is the deprecated
browser-facing websocket harness.

#### Worker endpoints

`app/apps/file_editor_cm6/main.py` still exposes deprecated endpoints for:

- discover
- start
- resolve

They already return deprecation failures. That means their remaining purpose is
only to keep stale callers limping along.

#### Main-process proxy

`app/apps/file_editor_cm6/services/vscode_api_transport.py` is a pure proxy for
the deprecated shell websocket. It should be deleted once callers are removed.

#### Shell manager / shellspec

`app/apps/file_editor_cm6/vscode_api_shell_manager.py` and
`app/apps/file_editor_cm6/shellspec/vscode_api.yaml` are old harness
infrastructure. They should not survive the removal.

### 2. Live Frontend Runtime Still Coupled To Dead `vscode_api`

#### `editor_vscode_api_runtime.ts`

This file currently mixes two unrelated concerns:

1. dead websocket harness state
2. live language/theme bootstrap state

That is the main naming and ownership problem.

The websocket half is removable.

The language/theme half must remain, but under a different name and a different
source of truth:

- WBA bootstrap
- worker-served theme registry / theme JSON
- worker/WBA-provided language catalog

#### `ensureVscodeLanguagesInstalled()`

This is still a live gate in the Monaco frontend.

It currently does:

- `getVscodeLanguagesList(...)`
- which calls `vscodeApiCall('vscode.languages.list', {})`
- which routes into the dead `vscode_api` transport

This is the exact class of bug that kept breaking completion registration.

This function needs to become a WBA/bootstrap language-catalog install path,
not a `vscode_api` websocket call.

#### `vscode.bootstrap.snapshot`

`editor_monaco_boot_runtime.ts` still calls:

- `vscode.bootstrap.snapshot`

That is a stale transport/name and should become one of:

- a WBA bootstrap request
- or a worker-composed bootstrap response that itself queries the WBA

### 3. Project-Sidecar Naming Is Wrong

`project_sidecar.py` still persists:

- `vscode_api.enabled_extensions`

That setting is still legitimate.
The name is not.

These are not “vscode_api websocket extensions”.
They are project-scoped extension-host enablement choices.

A better name is something like:

- `workbench_extensions.enabled_extensions`
- or `extension_host.enabled_extensions`

The matching HTTP endpoints in `main.py` should be renamed to match.

### 4. Diagnostics Naming Is Wrong

`editor_workbench_runtime.ts` still uses:

- `monacoRef.editor.setModelMarkers(model, 'vscode_api', [])`
- `[vscode_api] ...` log prefixes

That is now a false name.

Diagnostics are flowing through:

- WBA
- Python bridge
- Monaco marker application

So the owner/log labels should become something like:

- `workbench`
- `adapter`
- or `diagnostics_bridge`

## Naming Cleanup Proposal

### Remove These Names Entirely

- `vscode_api_transport`
- `vscode_api_shell_manager`
- `/vscode_api_ws`
- `/vscode_api/discover`
- `/vscode_api/start`
- `/vscode_api/resolve`
- `ensureVscodeApiWs`
- `vscodeApiWs`
- `vscodeApiPending`
- `vscodeApiCall`

### Rename These Runtime Concepts

#### `editor_vscode_api_runtime.ts`

Split and rename into explicit concerns:

- `editor_workbench_language_catalog_runtime.ts`
  - language ids
  - extension map
  - filename map
  - language configuration apply
- `editor_theme_catalog_runtime.ts`
  - theme json cache
  - theme registry load
  - theme apply coordination

Do not keep one runtime named `vscode_api` after the websocket harness is gone.

#### Sidecar extension state

Rename:

- `vscode_api.enabled_extensions`

to:

- `workbench_extensions.enabled_extensions`

or:

- `extension_host.enabled_extensions`

#### Diagnostics owner/log strings

Rename:

- marker owner `'vscode_api'`
- log prefix `[vscode_api]`

to WBA/bridge-owned names.

## Removal Order

## Progress

### Phase 1 Status

Completed in the live Monaco boot/runtime path:

1. `m_editor_app.ts` no longer constructs `createEditorVscodeApiRuntime(...)`
   for active language/bootstrap ownership.
2. Monaco boot no longer calls `vscode.bootstrap.snapshot`.
3. The live frontend language catalog now comes from a WBA-owned RPC:
   - frontend `editorWorkbenchCall('language_catalog', ...)`
   - Python bridge `handle_workbench_language_catalog(...)`
   - adapter RPC `te2.language_catalog`
4. `bootMonacoRuntime(...)` now connects the editor socket before forcing the
   language-catalog install, so language bootstrap is no longer gated on the
   deprecated websocket harness.

Remaining after Phase 1:

1. the dead `editor_vscode_api_runtime.ts` and websocket helper files still
   exist on disk
2. several helper/function names still say `Vscode` / `vscode_api`
3. project sidecar extension-state naming is unchanged

Meaning:

- the live editor boot path is off the dead `vscode_api` transport
- the repository still contains the old files and names, so full removal is not
  finished yet

### Phase 2 Status

Completed in the live Monaco runtime:

1. active language/bootstrap seam names were renamed away from the deprecated
   transport wording
   - `ensureWorkbenchLanguageCatalogInstalled(...)`
   - `installWorkbenchLanguageBridgeProviders(...)`
   - `callWorkbenchProviderGuarded(...)`
2. diagnostics owner/log labeling in the live workbench runtime now uses
   `workbench` instead of `vscode_api`
3. active comments/import wiring in `m_editor_app.ts` now describe the runtime
   as workbench-owned instead of `vscode_api`-owned

Remaining after Phase 2:

1. dead files on disk still carry the old `vscode_api` names
2. compatibility debug alias `__debugVscodeApiDiag` still exists alongside the
   new `__debugWorkbenchDiag`
3. project sidecar / HTTP extension-state naming is still unchanged

Meaning:

- no active Monaco runtime seam still presents itself as the old
  `vscode_api` transport
- the remaining work is now file deletion and project-scoped naming cleanup,
  not live runtime ownership confusion

### Phase 3 Status

Completed:

1. project sidecar extension enablement moved from
   `vscode_api.enabled_extensions` to
   `workbench_extensions.enabled_extensions`
2. existing sidecar data is migrated in-place the next time the sidecar schema
   is normalized
3. the worker HTTP surface moved from `/vscode_api/extensions/enabled` to
   `/workbench/extensions/enabled`

Remaining after Phase 3:

1. old sidecar files on disk may still contain the legacy key until loaded and
   saved
2. the adapter-side `vscode.*` provider method names remain because those are
   VS Code workbench protocol method names, not the removed transport

Meaning:

- project-scoped extension enablement now uses workbench-owned naming
- the legacy sidecar key is read only as migration input

### Phase 4 Status

Completed:

1. deleted the dead main-process websocket proxy service
2. deleted the old shell manager and shellspec
3. removed deprecated worker endpoints for discover/start/resolve
4. deleted dead Monaco websocket helper files and the old runtime wrapper
5. removed the host-side websocket client from `main.js`
6. removed the dead service module from `manifest.json`
7. removed the stale diagnostics debug compatibility alias

Remaining after Phase 4:

1. source references to the old name should now be limited to this audit,
   migration shims, or unrelated VS Code protocol method names
2. broader docs such as `CODE_TE2.md` may still need cleanup in Phase 5

Meaning:

- the old runtime transport/service has been removed from the live app
- new work should not add dependencies on the deleted harness

### Phase 1. Cut Remaining Live Frontend Gates Off The Dead Harness

1. replace `ensureVscodeLanguagesInstalled()` source
2. remove `vscode.bootstrap.snapshot` dependency
3. stop constructing `createEditorVscodeApiRuntime(...)` as a websocket client

Outcome:

- no live editor boot path depends on `/vscode_api/*`

### Phase 2. Rename Live Bootstrap/Theme/Language Runtime Pieces

1. split `editor_vscode_api_runtime.ts`
2. rename its surviving responsibilities to WBA/bootstrap/theme-specific names
3. rename imports and comments in `m_editor_app.ts` and related helpers

Outcome:

- no live runtime component still claims to be `vscode_api`

### Phase 3. Migrate Project Extension State Naming

1. rename sidecar schema from `vscode_api.enabled_extensions`
2. rename matching HTTP endpoints
3. update any extension-manager UI or RPC surfaces that still say `vscode_api`

Outcome:

- extension enablement naming matches actual extension-host ownership

### Phase 4. Delete Dead Harness Surfaces

1. remove `services/vscode_api_transport.py`
2. remove `vscode_api_shell_manager.py`
3. remove `shellspec/vscode_api.yaml`
4. remove deprecated endpoints from `main.py`
5. remove dead frontend websocket helper files
6. remove host-side dead `main.js` websocket client code
7. remove `vscode_api_transport` from `manifest.json`

Outcome:

- `vscode_api` no longer exists as a runtime transport/service

### Phase 5. Clean Docs And Remaining Labels

1. update `CODE_TE2.md`
2. archive or rewrite old `VSCODE_API_*` docs
3. rename diagnostics owner/log labels

Outcome:

- docs and logs match the real architecture

## Immediate High-Confidence Deletion Candidates

Completed in Phase 4:

- `app/apps/file_editor_cm6/services/vscode_api_transport.py`
- `app/apps/file_editor_cm6/vscode_api_shell_manager.py`
- `app/apps/file_editor_cm6/shellspec/vscode_api.yaml`
- deprecated `/vscode_api/discover`, `/vscode_api/start`, `/vscode_api/resolve`
- host-side dead websocket client in `app/apps/file_editor_cm6/main.js`

## Main Risk

The main risk is not transport breakage.

The main risk is keeping bootstrap/theme/language logic under the old
`vscode_api` name and accidentally reintroducing dead-lane dependencies later.

That is why the removal must include naming cleanup, not just file deletion.
