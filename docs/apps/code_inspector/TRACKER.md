# Code Inspector Tracker

## Status

Current phase: implementation complete; live validation pending

## Decisions

- [x] Use `Code Inspector` as the drawer and feature name.
- [x] Use one shared bottom-drawer tab for all initial operations.
- [x] Initiate inspections only from explicit editor context actions.
- [x] Keep language-provider traffic direct between editor and WBA.
- [x] Retain the normalized current projection in Python worker memory.
- [x] Rehydrate the projection through the existing host boot snapshot.
- [x] Keep call hierarchy lazy and session-based.
- [x] Use existing editor RPC and UI IPC lanes.
- [x] Do not add an HTTP endpoint, new socket, or semantic grep fallback.
- [x] Preserve Inspector state when result navigation opens another file.
- [x] Present code navigation on touch and desktop context menus.
- [x] Keep selection-adjustment controls touch-only.

## Phase 1: WBA Provider Support

- [x] Add `references`, `implementations`, and `callHierarchy` provider kinds.
- [x] Parse `$registerReferenceSupport`.
- [x] Parse `$registerImplementationSupport`.
- [x] Parse `$registerCallHierarchyProvider`.
- [x] Remove or correct obsolete registration method aliases if source proves
      they are unused.
- [x] Add document-selector-aware ordered provider lookup.
- [x] Add `vscode.references`.
- [x] Add `vscode.implementations`.
- [x] Add `vscode.callHierarchy.prepare`.
- [x] Add `vscode.callHierarchy.incoming`.
- [x] Add `vscode.callHierarchy.outgoing`.
- [x] Add `vscode.callHierarchy.release`.
- [x] Activate matching language extensions before provider lookup.
- [x] Merge, sort, and deduplicate references.
- [x] Merge, sort, and deduplicate implementations.
- [x] Retain call-hierarchy provider/session identifiers.
- [x] Release replaced or invalid sessions.
- [x] Clear provider and session state on adapter reset.
- [x] Add WBA unit tests.

## Phase 2: Backend Projection

- [x] Define typed Python Code Inspector projection contracts.
- [x] Add one in-memory current-projection store.
- [x] Add request, revision, model, and project generation guards.
- [x] Add reliable `editor.codeInspector.publish`.
- [x] Add backend `CodeInspectorChanged` fact.
- [x] Project changes to `ui.codeInspector.changed`.
- [x] Add `ui.host.codeInspector.command` expansion routing.
- [x] Add `editor.codeInspector.command` backend notification.
- [x] Add hierarchy release command routing.
- [x] Include `code_inspector` in the host boot snapshot.
- [x] Preserve the local projection across transient UI IPC reconnects and
      rehydrate full page reloads from the boot snapshot.
- [x] Clear invalid state on project switch and adapter reset.
- [x] Add Python state, stale-update, replacement, and release tests.

## Phase 3: Editor Controller

- [x] Capture the exact context-menu path and position.
- [x] Derive a bounded visible symbol label from the Monaco model.
- [x] Publish `loading` before waiting on WBA.
- [x] Execute direct references requests.
- [x] Execute direct implementations requests.
- [x] Prepare direct call-hierarchy sessions.
- [x] Handle backend-mediated hierarchy expansion commands.
- [x] Handle backend-mediated hierarchy release commands.
- [x] Normalize WBA responses for publication.
- [x] Reject stale top-level and expansion results.
- [x] Publish results through reliable editor RPC requests.
- [x] Surface unsupported providers without fallback.
- [x] Rehydrate hierarchy expansion state from the backend projection after a
      browser reload without releasing the WBA session.
- [x] Add editor controller tests.

## Phase 4: Drawer UI

- [x] Add the `Code Inspector` tab.
- [x] Add Inspector header and content containers.
- [x] Register the panel with the shared drawer controller.
- [x] Hydrate from the host boot snapshot.
- [x] Subscribe to `ui.codeInspector.changed`.
- [x] Render loading, empty, unsupported, and error states.
- [x] Group references by file.
- [x] Group implementations by file.
- [x] Render incoming and outgoing hierarchy branches.
- [x] Resolve hierarchy children progressively on expansion.
- [x] Keep loaded and failed node state visible.
- [x] Open locations through existing host file-open behavior.
- [x] Preserve the current Inspector projection after navigation.
- [x] Add accessible tree and live-region semantics.
- [x] Cover the editor-side projection and expansion controller with focused
      tests; host DOM behavior remains a live-validation item.

## Phase 5: Context Menu

- [x] Add a dedicated code-navigation island to touch-selection source.
- [x] Add Call Hierarchy with the phone icon.
- [x] Add Find All References with the pages icon.
- [x] Add Find All Implementations with the target icon.
- [x] Add textual titles and ARIA labels through the existing menu-tool
      contract.
- [x] Make the navigation island visible for touch and desktop context menus.
- [x] Keep the existing selection-adjustment island touch-only.
- [x] Preserve current menu layering and no-gap touch behavior.
- [x] Expose callbacks without coupling the generic extension to Code TE2 RPC.
- [x] Wire callbacks in the Code TE2 editor runtime.
- [x] Build the touch-selection package.
- [x] Publish generated UMD and CSS into Code TE2 vendor assets.

## Phase 6: Validation And Publication

- [x] Run targeted WBA tests.
- [x] Run targeted Python tests.
- [x] Run Code TE2 `npm run typecheck`.
- [x] Run Code TE2 `node build.mjs`.
- [x] Verify generated bundle changes are limited to approved outputs.
- [x] Run authored-source `git diff --check`; the generated host bundle retains
      its pre-existing trailing-whitespace baseline.
- [x] Inspect final repository status without altering unrelated changes.
- [x] Update `.repo_memory.md` with verified Code Inspector architecture.
- [ ] Perform live desktop context-menu validation.
- [ ] Perform live mobile context-menu validation.
- [ ] Validate references with an LSP-backed extension.
- [ ] Validate implementations with a supported provider.
- [ ] Validate incoming and outgoing lazy call hierarchy.
- [ ] Validate browser reload rehydration while the app worker remains alive.
- [ ] Validate explicit empty/unsupported behavior without fallback.

## Deferred

- [ ] Type hierarchy.
- [ ] Definitions and declarations as additional Inspector lenses.
- [ ] Inspector root history and breadcrumbs.
- [ ] Pinning an Inspector root.
- [ ] Workspace mode and scoped symbol search.
- [ ] Optional desktop side-dock geometry.
