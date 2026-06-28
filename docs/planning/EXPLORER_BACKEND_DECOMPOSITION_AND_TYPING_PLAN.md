# Explorer Backend Decomposition and Typing Plan

## Intent

This document covers the backend half of the Explorer ask:

1. stop treating `explorer_ws.py` as the whole Explorer backend
2. split backend responsibilities into real modules under the existing `explorer/` package
3. move request parsing, dispatch, notifications, and domain handlers into typed Python files
4. make Explorer backend work realistic for `pyright` / `basedpyright` instead of raw `dict` flow everywhere

This plan is intentionally about **decomposition first**, not cosmetic cleanup.

## Current State Snapshot

The Explorer backend currently sprawls across:

- `app/apps/file_editor_cm6/explorer_ws.py`
- `app/apps/file_editor_cm6/explorer_socketio.py`
- `app/apps/file_editor_cm6/explorer_rpc_contract.py`
- `app/apps/file_editor_cm6/explorer_rpc_socketio.py`
- `app/apps/file_editor_cm6/explorer_rpc_emit.py`
- `app/apps/file_editor_cm6/diagnostics_bridge.py`
- `app/apps/file_editor_cm6/watchexec_shell_manager.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`

`explorer_ws.py` still mixes too many jobs:

- Socket.IO shim logic
- watcher debounce and batching
- project switch teardown
- draft notification forwarding
- payload coercion helpers
- dynamic message routing
- filesystem handlers
- git handlers
- project handlers
- review handlers
- search handlers
- extension-management handlers
- prefs / watcher / pulse / mention flows
- legacy namespace implementation

The existing backend package slot already exists:

- `app/apps/file_editor_cm6/explorer/`

Today it contains only:

- `search.py`
- `review.py`

That package should become the real Explorer backend home.

## Non-Goals

- deleting `/explorer` immediately
- merging all worker namespaces into one server right now
- rewriting helper libraries like `explorer_helper.py` and `git_helper.py` from scratch
- moving runtime-wide TE2 services out of their proper ownership territory

## Backend Rules For This Work

1. New Explorer backend modules should live under `app/apps/file_editor_cm6/explorer/`.
2. New Explorer backend modules should use `# pyright: strict` where realistic.
3. Request parsing happens once at the transport edge.
4. Handler modules should receive typed params, not raw `dict[str, Any]`.
5. Notification emission should flow through one typed helper path.
6. Dispatcher code should become orchestration only, not business logic storage.
7. Search/review stay in the Explorer package, but are pulled under a consistent handler layout.

## Target Backend Package Shape

The target package shape is:

```text
app/apps/file_editor_cm6/explorer/
  __init__.py
  contracts/
    requests.py
    results.py
    notifications.py
    errors.py
    payloads.py
  dispatch/
    router.py
    registry.py
    context.py
  handlers/
    filesystem.py
    git.py
    projects.py
    prefs.py
    watcher.py
    extensions.py
    search.py
    review.py
    mirror.py
    pulse.py
    mention.py
  services/
    project_session.py
    draft_notifications.py
    watcher_notifications.py
    git_notifications.py
    active_file_notifications.py
  socketio/
    legacy_namespace.py
    rpc_namespace.py
    socket_shims.py
  notifier.py
```

This does **not** require a big-bang rename on day one. It is the target split.

## Exact Extraction Map

### From `explorer_ws.py`

| Current concern | Target module |
| --- | --- |
| `SocketIOSocketShim` | `explorer/socketio/socket_shims.py` |
| watcher debounce / `_schedule_watcher_files_broadcast` / git broadcast helpers | `explorer/services/watcher_notifications.py` |
| project reset / adapter teardown / sidecar reset | `explorer/services/project_session.py` |
| draft forwarding and draft refresh | `explorer/services/draft_notifications.py` |
| `_payload_str`, `_payload_str_list` | `explorer/contracts/payloads.py` |
| dynamic `handle_message_json` routing | `explorer/dispatch/router.py`, `explorer/dispatch/registry.py` |
| filesystem handlers | `explorer/handlers/filesystem.py` |
| git handlers | `explorer/handlers/git.py` |
| project handlers | `explorer/handlers/projects.py` |
| watcher config / mode / raise handlers | `explorer/handlers/watcher.py` |
| prefs / agent icon handlers | `explorer/handlers/prefs.py` |
| extension handlers | `explorer/handlers/extensions.py` |
| pulse / mirror / mention handlers | `explorer/handlers/pulse.py`, `mirror.py`, `mention.py` |
| `ExplorerSocketIONamespace` | `explorer/socketio/legacy_namespace.py` |

### Existing RPC files

| Current file | Target |
| --- | --- |
| `explorer_rpc_contract.py` | `explorer/contracts/requests.py`, `results.py`, `notifications.py`, `errors.py` |
| `explorer_rpc_socketio.py` | `explorer/socketio/rpc_namespace.py` |
| `explorer_rpc_emit.py` | `explorer/notifier.py` |

## Handler Family Split

The backend should stop routing everything through one enormous dispatcher class. The split should follow stable domains.

### Filesystem / tree domain

Move these into `handlers/filesystem.py`:

- `handle_explorer_list`
- `handle_explorer_refresh`
- `handle_explorer_setOpenDirs`
- `handle_explorer_createFile`
- `handle_explorer_createDir`
- `handle_explorer_rename`
- `handle_explorer_delete`
- `handle_explorer_batchDelete`
- `handle_explorer_batchCopy`
- `handle_explorer_batchMove`
- `handle_explorer_move`
- `handle_explorer_copy`
- `handle_explorer_copyFrom`
- `handle_explorer_moveFrom`

### Git domain

Move into `handlers/git.py`:

- `handle_git_status`
- `handle_git_stage`
- `handle_git_unstage`
- `handle_git_stageAll`
- `handle_git_unstageAll`
- `handle_git_restore`
- `handle_git_commit`
- `handle_git_push`
- `handle_git_pull`
- `handle_git_reset`
- `handle_git_init`
- `handle_git_setDiffBase`
- `handle_git_listBranches`
- `handle_git_listCommits`
- `handle_git_clone`

### Project domain

Move into `handlers/projects.py`:

- `handle_project_open`
- `handle_project_create`
- `handle_project_list`
- `reset_project_session`

### Search / review domain

Normalize the existing package split instead of keeping it half-finished:

- `handle_search_run` routes into `handlers/search.py`
- `handle_review_list`
- `handle_review_save`
- `handle_review_discard`
  route into `handlers/review.py`

### Extensions / prefs / watcher domain

Move into:

- `handlers/extensions.py`
- `handlers/prefs.py`
- `handlers/watcher.py`

### Misc domain

Move into:

- `handlers/mirror.py`
- `handlers/pulse.py`
- `handlers/mention.py`

## Typed Backend Contracts

The backend split is not complete unless it removes the current open-ended payload pattern.

Required typed surfaces:

- request param `TypedDict`s per method family
- result `TypedDict`s per method family
- notification payload `TypedDict`s for all outbound Explorer notifications
- explicit error builders for contract failures
- typed dispatch context object
- typed notifier interface

Use:

- `TypedDict`
- `Literal`
- `Protocol`
- frozen dataclasses where useful for context objects

Do **not** keep introducing `dict[str, Any]` deep inside handlers.

## Dispatch Model Target

The dynamic `getattr(self, f"handle_{...}")` pattern should be replaced with an explicit registry.

Target structure:

1. transport layer parses the envelope
2. contract layer parses params into typed objects
3. registry resolves the method/type to a handler callable
4. handler callable receives a typed context and typed params
5. notifier builds typed outbound notifications

That makes the handler surface visible to static analysis and makes method coverage auditable.

## Notification Ownership

The Explorer backend has multiple outbound producers, not just the namespace handler:

- `diagnostics_bridge.py`
- `watchexec_shell_manager.py`
- `monaco_editor/editor_ws.py`
- draft / review broadcasts
- project-open broadcasts
- watcher-mode broadcasts

The target is:

1. one typed Explorer notification builder path
2. one typed emit helper
3. producer modules emit typed payloads only

That means `explorer/notifier.py` becomes the only place that knows the Socket.IO event name and namespace for Explorer RPC notifications.

## Phased Backend Execution Plan

### Phase 1 — Pull pure helpers out of `explorer_ws.py`

Extract first:

- payload coercion helpers
- watcher batching helpers
- project session reset helpers
- draft notification helpers
- socket shims

This reduces file size without changing behavior.

### Phase 2 — Create typed dispatch context and registry

Add:

- `dispatch/context.py`
- `dispatch/registry.py`
- `dispatch/router.py`

Goal:

- stop storing all logic directly on `ExplorerDispatcher`
- make domain handlers ordinary functions or small classes

### Phase 3 — Split handler families into modules

Move filesystem, git, project, watcher, prefs, extensions, review, and search into separate files under `handlers/`.

At the end of this phase, `ExplorerDispatcher` should mostly delegate.

### Phase 4 — Move Socket.IO namespace classes under `explorer/socketio/`

Move:

- legacy namespace
- RPC namespace
- shims

This makes transport ownership explicit and gets transport code out of the business-logic file.

### Phase 5 — Convert outbound producers to the typed notifier

Any Explorer notification producer outside the namespace should use the central notifier helper instead of rolling its own payload shape.

### Phase 6 — Tighten type coverage

After the module split lands:

1. add strict pyright pragmas where missing
2. reduce `cast(...)` usage
3. replace raw payload dict mutation with typed builders
4. make method coverage explicit in registry tables

## Exit Criteria

This backend plan is complete only when all of the following are true:

1. `explorer_ws.py` is no longer the Explorer backend dumping ground
2. transport, dispatch, notifications, and handlers are split into separate modules
3. the existing `explorer/` package becomes the real backend home
4. new backend Explorer code uses typed params/results instead of raw dict flow
5. external Explorer notification producers use the shared notifier path
6. handler coverage is visible through explicit registries instead of implicit naming tricks

## Relationship To The Other Two Explorer Docs

- frontend TS split lives in `EXPLORER_FRONTEND_TYPESCRIPT_DECOMPOSITION_PLAN.md`
- end-to-end JSON-RPC contract rollout lives in `EXPLORER_RPC_CONTRACT_AND_CUTOVER_PLAN.md`

This document is specifically about turning the Explorer backend into a decomposed, typed package.
