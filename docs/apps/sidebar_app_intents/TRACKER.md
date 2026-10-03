# Sidebar App Intents Tracker

Plan: [PLAN.md](PLAN.md). Branch: `feature/code-te2-native-services`.
Status: production pipe foundation, native document-open/app-open adapters and
Explorer File Explorer integration implemented and unit-validated. Remaining
other app UI integration pending. Guarded project intents and File Explorer item
context menus are now implemented and user live-accepted. Terminal intent and Explorer
menu implemented; validation recorded below. Shared framework
not restarted; compiled runtime group not rebuilt/activated for this slice.

Validation cadence: per user direction, use synthetic and regression tests during
incremental implementation. Defer live acceptance until a working end-to-end
model exists; do not request a live test for each transport/adapter checkpoint.
The mobile sticky-scope investigation still requires explicit advance notice
and joint debugging when its scheduled slice is reached.

## Production Pipe Foundation

- [x] Documentation checkpoint committed/pushed as `3acfa576`.
- [x] Approval obtained for broker/app-open foundation only, without UI/Android
  edits or shared-framework restart.
- [x] Reuse app lifecycle launch/query builder for worker-pipe `app.open`.
- [x] Register exact owned app pipes separately from runtime-debug routes.
- [x] Allowlist intent delivery; derive source from bridge ownership and reject
  non-current workers. Target backend remains responsible for client/presentation
  validation before effects.
- [x] Bound correlation/admission; clean up timeout, cancellation, writer failure,
  caller disconnect and target replacement; no automatic mutation replay.
- [x] Eight broker tests and two existing writer tests pass with
  `ferrous-framework-native` enabled.
- [x] Existing 24 framework-pipe tests and three app-lifecycle tests pass;
  formatting and diff whitespace checks pass (37 targeted tests total).
- [x] Bounded Code TE2 domain-loop admission and lifecycle cleanup, independent
  of runtime-debug; nonblocking pipe-reader scheduling and off-loop replies.
- [x] Shared document-open service for Sidebar socket and pipe callers; pipe
  context requires current client/slot/presentation and app ownership.
- [x] 24 targeted Python tests pass; five changed modules pass Mypy and mypyc
  code generation. This is not a compiled-group rebuild or live acceptance.
- [ ] Project intent services and remaining out-of-project routing policies.
- [x] Terminal directory intent service: exact-client drawer activation and
  Sidebar fresh-session seeds with retained FWS claim matching.
- [x] Shared app-tab launch service uses framework pipe `app.open`, validates
  live initiating client before and after launch, and preserves project-generation
  and source-presentation fences. Membership is shared; activation is client-scoped.
- [x] Pipe `sidebar.openApp` uses the same service with validated embedded context.
- [x] Explorer's Open in File Explorer uses its own RPC/backend and creates a
  distinct stateful Sidebar tab; no frontend framework fetch/page navigation.
- [x] App-tab slice: 51 Python and 16 Node regression tests, TypeScript typecheck,
  frontend build and six-module Mypy/mypyc validation. No live test or OTA.
- [ ] User-facing workflows and live acceptance (not supplied by the foundation).

## Direction And Plan Formation

- [x] Record all requested embedded/standalone behavior and framework-pipe versus
  query-string direction, including **all CM6 settings** persisted in localStorage.
- [x] Record initial source leads separately from verified end-to-end contracts.
- [x] First contract map: generic app-open URL/query builder, pipe DTO/correlation,
  current framework-service dispatcher, absent app broker/Code TE2 domain pipe
  handlers, existing Sidebar domain services and exact-client file-open guards.
- [x] Identify Terminal launch gaps: query CWD is not authoritative for new-session
  creation; supplied shell ID restores state rather than creating a new session.
- [x] Record proposed production broker plus reusable domain adapter direction,
  without treating runtime-debug routing as a production intent API.
- [x] Trace stateful versus fixed-base Sidebar slot creation and CM6's missing
  stateful manifest support; document shared app-state versus tab identity.
- [x] Trace project lookup/adoption and missing project-query consumption in the
  inspected boot path; normal draft/launch sequencing remains to be specified.
- [x] Trace drawer new-session owner: `shell.create` ignores params and selects
  project-root CWD; cross-client activation/socket-close effects need review.
- [x] Inventory CM6's five settings and identify missing host exit continuation,
  dirty-buffer reset, Save-success signalling and inconsistent action guards.
- [x] Verify File Explorer has a successful-load hidden-preference save path;
  actual persistence failure and sticky reveal cause remain unconfirmed.
- [ ] Map existing framework pipe methods and app launch/readiness/query handlers.
- [ ] Define reusable typed intents, source/target identity, correlation/error/
  cancellation semantics, and exact-client presentation routing.
- [ ] Trace backend path containment, project history/sidecar lookup and guarded
  open/create, including shared project-switch publication.
- [ ] Inventory File Explorer/File Editor/Terminal context detection and state
  publication; verify generic launch behavior beyond File Explorer.
- [ ] Inventory all CM6 settings and File/Edit item actions before selecting edits.
- [ ] Finalize shared Terminal dialog/remembered-choice/reset policy.
- [ ] Trace source-tree hidden/reveal geometry callbacks and dock gesture/layout owners.
- [ ] Update plan with source-backed contract matrix and concrete edit/test slices.
- [ ] Obtain cohesive implementation-plan approval.

## Code TE2 Explorer

- [x] Open directory in File Explorer as a new Sidebar tab; never leave Code TE2
  (synthetic acceptance; live acceptance deferred until the working model milestone).
- [x] Place Open in Terminal immediately below Open in File Explorer.
- [x] User live accepted File Explorer and Terminal menu launch behavior.
- [x] Successful app-intent activation explicitly requests sidebar reveal on
  desktop/mobile and closes the Explorer drawer only in mobile layout. Existing
  restore activation does not reveal; cancelled/failed launches publish no reveal.
  Terminal bottom-drawer behavior remains unchanged. 48 Python and 10 Node
  regression tests pass; updated compiled group and client OTA are needed before
  live acceptance of this additional layout behavior.
- [x] User rebuilt the compiled group and live accepted the sidebar reveal /
  mobile Explorer-close behavior. File Explorer and Terminal menu workflows
  now have live acceptance; remaining workflows retain their separate gates.
- [x] Shared Sidebar/drawer choice dialog and fresh-session directory intent;
  Cancel has no effects. Remembered choice remains pending.
- [x] Drawer exact-client activation avoids global rebind/shared selection changes.
- [x] Terminal consumes launch CWD/new-session seed on its own lifecycle lane;
  FWS metadata claims prevent duplicates while their shell records remain retained.
- [x] 92 targeted Python tests and 41 Node tests pass; both app frontend
  typechecks and bundle builds pass. Five Code TE2 Python modules pass Mypy.
  The same five modules pass isolated mypyc code generation; this does not
  rebuild or activate the installed compiled runtime group.
  Standalone Terminal's broader Mypy check still reports its unchanged existing
  `connections.pop(conn_id, None)` typing error; not silently waived as passing.
- [ ] Investigate and fix mobile-only sticky scopes missing after the Explorer
  drawer stays closed for some time and reopens without user motion; keep
  accepted scrolling behavior unchanged. Desktop/initial reveal are regression checks.
  **Notify the user explicitly before starting this bug's live investigation;
  reproduce/debug it together when its scheduled slice is reached.**
- Joint reproduction completed on local Electron's mobile breakpoint and Android:
  root-only sticky projection survived despite intact nested tree ancestry. One
  existing `update()` restored scopes on both clients without scrolling. The fix
  explicitly refreshes on mobile drawer open, settled transform and visibility
  reveal, with cleanup. Twelve tree/result-scope tests, typecheck and bundle build
  pass; force-OTA live acceptance of this source remains pending.

## File Explorer

- [x] Long-press/right-click and keyboard menu reuse enabled File/Edit actions
  and existing guards in both list/grid; unrelated batch selection is cleared.
- [x] Directory Open as Project: known sidecar/history restoration or adoption of
  an existing directory, embedded pipe intent versus one-shot standalone launch
  query. Backend-owned, expiring single-use consent tickets fence the exact
  client/presentation, current project generation and directory identity.
- [x] User live acceptance of project opening and File Explorer context menus.
- Live preparation failure identified at the frontend HTTP adapter: app-shell
  `api.post` already returns `body.data`; the project helper must not unwrap it
  again. Corrected the helper and added a regression using the actual template's
  `teFetch` function, not an independently shaped response mock. User subsequently
  confirmed the updated snapshot works live.
- Project/context slice validation: 54 Python tests plus three subtests, 20 Node
  tests, TypeScript checking, frontend build, five-module Mypy and mypyc C
  generation. This is not a full compiled-group rebuild/activation or native OTA.
- [x] Directory Open in Terminal: embedded shared choice; standalone Terminal
  navigation; always a new session at the selected CWD.
- [x] Embedded in-project text open reaches initiating client's Code TE2 editor.
- [x] Embedded outside-project text open creates a new CM6 Sidebar tab.
- [x] Standalone text open retains existing CM6 behavior.
- [x] Generalize outside-project routing at the shared Code TE2 open boundary:
  canonical paths (including symlink escapes) route to exact-client CM6 Sidebar
  tabs before model/recents/WBA effects. Sidebar caller identity fences remain.
- [x] Show hidden uses the existing saved-state mechanism: both controls update
  the effective listing flag and persist immediately, including before a failed list.
- [x] Verify first-party launch/query contracts: File Explorer `path`, CM6 `file`,
  Code TE2 one-shot `project`, Terminal `cwd`/`new_session` followed by `shell_id`.
  No additional generic launcher or frontend-to-frontend transport introduced.
- [x] Ordinary app presentations carry exact client/presentation context, just
  like extension views. Incomplete embedded context rejects rather than navigating.
- [x] File Explorer routes existing text-file opens through its own backend and
  the framework pipe; shared Terminal destination dialog has no Cancel effects.
- [x] Canonical resolved paths distinguish project files from outside files,
  including symlink escapes and similarly prefixed sibling directories.
- [x] Routing slice: 101 Python regression tests pass; shared frontend helper
  tests, Code TE2 typecheck/build and targeted Python Mypy checks pass. Global
  static modules are included by the existing native asset tree and package graft.
  No live acceptance, OTA, Android edits, runtime restart or compiled-group activation.
- [x] Subsequent live attempt exposed an old compiled `sidebar_ws` without the
  new routing exports. Rebuilt `mypyc-sidebar-intents-20261002`: all 135 compiled
  imports and both routing exports verified; 21 isolated native-worker/reader
  tests passed. Switched `mypyc-active` to the new group, preserving
  `mypyc-domain-gather-fix-1`. No shared runtime restart: existing workers retain
  old imports until restarted. Live routing acceptance remains pending.

## CM6 File Editor

- [x] Persist and restore **every configurable/menu setting** in localStorage;
  inventory table proves complete coverage, with safe defaults/error handling.
- [x] Discard resumes the originally requested navigation exactly once; Cancel
  and failed Save remain guarded, across file/app navigation and supported close.
- [x] Add Sidebar statefulness/query launch and existing backend state publication;
  multiple tabs/clients restore their own file identity without cross-client leakage.
- [x] Keep preferences distinct from unsaved document data and routing credentials.
- Embedded CM6 query state owns its file; app-global last-file/draft restoration
  is suppressed for that tab, without deleting the existing shared saved state.
  All five preferences persist immediately in a dedicated localStorage record.
  Supported shell exits await the original guarded callback; browser unload uses
  a separate synchronous dirty check. Failed/cancelled Save retains the dialog,
  Discard restores saved text, and duplicate pending navigation is ignored.
  This combined slice and the cached local build entrypoint have user live
  acceptance. The agent did not restart the runtime.
  Validation: 80 Python tests plus three subtests, 19 Node tests (including
  actual CM6 modal/app-shell continuation handlers and both hidden controls),
  four-module Mypy, isolated mypyc C generation, Code TE2 TypeScript checking
  and frontend build all pass. C generation is not a rebuilt active domain group.

- [x] Mobile Sidebar-to-editor document opens close the sidebar and toast
  "Opening in code editor" through exact-client backend notification after
  successful open dispatch. Desktop and external CM6 opens are unchanged.
  Corrected a dropped cross-lane notification: explicit `ui.sidebar.drawer.close`
  is parsed by the host and mapped to the local Sidebar event.
  Additional validation: 17 Python and 48 transport/host Sidebar UI tests, TypeScript
  check and frontend build pass. User rebuilt and verified this feedback working
  live; acceptance is complete.

## Dock

- [ ] Bound horizontal overflow; wheel and touch-drag scrolling like the tab bar.
- [ ] Preserve activation/context/long-press/reorder gestures and unclipped menus.
- [ ] Agree on and implement useful minimum title/label geometry.

## Acceptance Matrix

- [ ] Electron embedded app workflows, warm and cold worker launch.
- [ ] Mobile embedded app workflows after verified force OTA.
- [ ] Standalone File Explorer -> Code TE2/Terminal/CM6 launch intent behavior.
- [ ] Two clients plus multiple tabs: effects target the initiating client;
  project changes still follow the shared runtime project contract.
- [ ] In/out-of-project paths, symlinks, similarly prefixed siblings and stale targets.
- [ ] Existing/new project, draft guard acceptance/cancellation and switch publication.
- [ ] Fresh terminal session per invocation in Sidebar/drawer/standalone; no replay
  duplicates, accidental reuse, wrong CWD, or eager unrelated PTY creation.
- [ ] File Explorer Show hidden and CM6 settings survive reload/reopen.
- [ ] CM6 dirty navigation: Save, Discard, Cancel, failed Save and pending intent.
- [ ] Mobile source-tree sticky scopes render after delayed drawer close/reopen
  without scrolling; desktop and initial reveal remain correct.
- [ ] Dock overflow on desktop/mobile retains controls and popup visibility.
- [ ] Targeted backend/frontend tests, applicable typechecks and builds pass.
- [ ] User live acceptance at working end-to-end milestones; commit/release only
  when requested.
