# Sidebar App Intents Tracker

Plan: [PLAN.md](PLAN.md). Branch: `feature/code-te2-native-services`.
Status: documentation baseline only; runtime implementation not started.

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

- [ ] Open directory in File Explorer as a new Sidebar tab; never leave Code TE2.
- [ ] Place Open in Terminal immediately below Open in File Explorer.
- [ ] Reuse shared Sidebar/drawer choice dialog; every invocation creates a new session.
- [ ] Investigate and fix mobile-only sticky scopes missing after the Explorer
  drawer stays closed for some time and reopens without user motion; keep
  accepted scrolling behavior unchanged. Desktop/initial reveal are regression checks.
  **Notify the user explicitly before starting this bug's live investigation;
  reproduce/debug it together when its scheduled slice is reached.**

## File Explorer

- [ ] Long-press/right-click menu reuses applicable File/Edit actions and guards.
- [ ] Directory Open as project: existing sidecar/history open or normal project
  creation; embedded pipe intent versus standalone Code TE2 launch query.
- [ ] Directory Open in Terminal: embedded shared choice; standalone Terminal
  navigation; always a new session at the selected CWD.
- [ ] Embedded in-project text open reaches initiating client's Code TE2 editor.
- [ ] Embedded outside-project text open creates a new CM6 Sidebar tab.
- [ ] Standalone text open retains existing CM6 behavior.
- [ ] Generalize outside-project routing at the shared Code TE2 open boundary.
- [ ] Diagnose Show hidden persistence through the existing saved-state mechanism.
- [ ] Verify generalized app launch/query intents across all applicable apps.

## CM6 File Editor

- [ ] Persist and restore **every configurable/menu setting** in localStorage;
  inventory table proves complete coverage, with safe defaults/error handling.
- [ ] Discard resumes the originally requested navigation exactly once; Cancel
  and failed Save remain guarded, across file/app navigation and supported close.
- [ ] Add Sidebar statefulness/query launch and existing backend state publication;
  multiple tabs/clients restore their own file identity without cross-client leakage.
- [ ] Keep preferences distinct from unsaved document data and routing credentials.

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
- [ ] User live acceptance recorded per slice; commit/release only when requested.
