# Sidebar App Intents And Unified App Behavior

Status: intended direction recorded; end-to-end contract investigation pending.
Working branch: `feature/code-te2-native-services`. No new branch, release,
runtime restart, or implementation is authorized by this documentation pass.
Execution checklist: [TRACKER.md](TRACKER.md).

## Goal And Scope

Unify Code TE2 Explorer, File Explorer, Terminal, and the standalone CM6 File
Editor when used inside Code TE2's Sidebar. Unless explicitly described as
standalone, the behavior below is in-Code-TE2 behavior. Preserve standalone apps
and reuse their existing editor-context detection, launch intents, state stores,
framework pipe, and backend hooks rather than inventing parallel transports.

This document records desired behavior, not a claim that it is implemented.
Investigate in bounded chunks, update this plan with source-backed findings,
then approve a cohesive end-to-end contract before implementing bounded slices.

## Desired Behavior

### Code TE2 Explorer

1. **Open in File Explorer:** open the selected directory in a **new Sidebar
   tab**, leaving Code TE2 and its current editor in place. Do not navigate the
   whole page away from the editor.
2. **Open in Terminal:** add a directory menu entry immediately below Open in
   File Explorer. Show a standard app-owned dialog offering **Sidebar** or
   **drawer**, with a possible **Don't ask again** checkbox. Both choices always
   create a **new session**, rooted at the selected directory. Reuse the same
   dialog and remembered-choice policy from File Explorer; exact preference
   ownership/reset affordance and checkbox inclusion remain contract decisions.
3. **Sticky scopes on reveal:** the user clarified this occurs **only on mobile**,
   after the Explorer drawer is closed for some time and then reopened. Diagnose
   missing source-tree sticky scopes on that delayed reveal without scrolling.
   Investigate hidden-layout
   measurement and reveal/resize/update callbacks; the reported motion-only or
   callback race is a hypothesis, not a confirmed cause. Correct initial/reveal
   projection without requiring a user scroll or altering accepted scroll behavior.

### File Explorer

1. **Item context menu:** right-click/long-press exposes the applicable existing
   File and Edit menu actions for that item. Reuse action handlers and their
   enabled/disabled rules. Directory-specific actions below are additional;
   do not duplicate file operations with a second implementation.
2. **Open directory as project:** when embedded, request Code TE2 to open that
   directory. Reuse its existing project if history/sidecar exists; otherwise
   create the project using normal backend project semantics. When standalone,
   navigate to Code TE2 carrying the selected directory as launch intent.
   Preserve normal draft guards and shared project-switch publication; an
   exact-client initiating intent does not make the runtime project client-local.
3. **Open in Terminal:** embedded behavior matches Code TE2 Explorer's shared
   Sidebar/drawer choice and always-new-session rule. Standalone behavior
   navigates to Terminal with the selected directory and a new-session intent;
   it does not offer a nonexistent Code TE2 drawer.
4. **Open text document:**
   - Embedded and inside the active project tree: request Code TE2 to open it
     through normal document/open-state services for the initiating client.
   - Embedded and outside that tree: open CM6 File Editor in a **new Sidebar
     tab**, without switching the Code TE2 project or disturbing its foreground.
   - Standalone: retain existing CM6 File Editor behavior.
   - Apply the same outside-project routing rule to other requests that ask an
     already-running, visible Code TE2 client to open an out-of-project file.
     Identify the common backend boundary before changing individual callers.
5. **Show hidden:** persist through File Explorer's existing preference/state
   mechanism, alongside list/grid and other view settings. Investigate the
   existing path rather than introducing a new store.

### CM6 File Editor (`app/apps/file_editor`, not Code TE2's legacy alias)

1. **All settings persist in localStorage:** inventory every configurable File
   Editor/menu option, restore it before applying editor configuration, and
   persist subsequent changes. This includes all settings, not just a selected
   subset. One-shot commands are actions, not persistent preferences. Keep
   document contents, unsaved buffers, credentials, and routing authority out of
   this preference store. Verify storage-denied/malformed-value handling and
   note the existing native-origin lifetime constraints rather than silently
   substituting another persistence policy.
2. **Discard/navigation guard:** when navigation was blocked by unsaved edits,
   choosing Discard must discard through the existing flow and then resume the
   **original pending navigation exactly once**. Cancellation stays put; Save
   failure stays guarded. Test app/file navigation and supported close actions,
   not just explicit Discard on the current document.
3. **Sidebar statefulness:** add the same class of launch/query-state and
   backend state publication support already used by File Explorer and Terminal.
   Restore the correct file/tab identity across refresh/reopen without stealing
   another client's state. Specify whether view state belongs in the URL or the
   existing Sidebar ledger; settings remain localStorage preferences. Do not
   assume unsaved document contents should be encoded in query strings.

### Sidebar Dock

- When entries exceed available width, contain them within the dock and allow
  horizontal overflow scrolling, mouse wheel movement, and touch dragging like
  Code TE2's tab bar. Preserve click, long-press, context menu, and ordering
  gestures; distinguish dragging from activation. Do not clip popup menus.
- Give dock titles/labels a useful minimum size, slightly larger if necessary.
  Determine the current constraint and exact minimum during UI investigation;
  no arbitrary pixel value is approved yet.

## Execution Direction: Framework Pipe And Launch Queries

### Context And Transport Split

- Embedded apps send user intent to their **own backend** using their existing
  frontend lane. Their backend sends typed app-to-app intent through the
  **framework pipe**, with the framework brokering it to the target app/backend.
  The target backend uses existing services/hooks and publishes to its own UI.
- Code TE2 launches Sidebar app surfaces with query-string intent. Full-page
  standalone transitions likewise carry launch intent in query strings.
- Query parameters express launch/context/state seeds, not trusted authority.
  Pipe routing must validate origin, target, client/presentation association,
  project/path, and supported action using existing contracts.
- Reuse current capabilities before adding a broker method. Do not route a
  frontend directly into another surface's private RPC/socket or add HTTP
  round trips where the existing pipe can express the intent.
- Extend the generic app-launch intent behavior to other supported apps, rather
  than preserving a File-Explorer-only special case. Verify worker launch,
  readiness, returned URL/query application, and routing in the native clients.

### Contract Investigation Deliverable

For each intent (open app/tab, open project, open document, create terminal
session), record the current source method and proposed typed payload; caller
authentication/context; exact target; backend owner; launch/readiness ordering;
reply/error semantics; and applicable standalone query equivalent.

Resolve these before implementation:

- How the existing framework pipe supports routed calls/notifications and app
  startup, and whether a small generic broker addition is actually required.
- How an embedded app proves its initiating client and live Sidebar membership;
  no global-active-client or broadcast fallback for presentation/document effects.
- Correlation, duplicate delivery, disconnect, timeout, and cancellation behavior.
  Never replay an uncertain project switch or session creation blindly. Each
  explicit terminal invocation must create one new session, not reuse a prior
  one or create two through duplicate launch handling.
- Active-project containment using backend path semantics (including path
  separators, symlinks, and sibling-prefix traps), not frontend string prefixes.
- Existing project open/create guards and cross-client project publication.
- Stateful app/tab query identity and launch/readiness behavior, including
  launching a stopped worker versus a warm worker and distinct new Sidebar tabs.
- Shared Terminal choice persistence and reset; drawer CWD initialization without
  altering unrelated sessions or eagerly spawning a shell merely to open a drawer.
- Handling unavailable apps/targets and stale presentation identities explicitly.
- File Editor setting inventory, localStorage scope, safe defaults and state
  restoration; File Explorer hidden-state write/restore timing.

## Preliminary Source Leads (Not Completed Investigation)

- `app/apps/code_te2/src/explorer/tree/menu-controller.ts`, `openExternal`:
  posts to `/api/apps/file_explorer/open` and then assigns `window.location.href`.
  This is a concrete current whole-page navigation path to replace.
- `app/apps/file_explorer/main.js`: existing preferences read `savedState.showHidden`;
  `persistState()` includes it in `host.saveState()`. The reported loss needs
  tracing through toggle/save/restore and embedded-state handling.
- The same File Explorer entry point contains stateful host/token query handling
  and Sidebar window state publication. Compare Terminal before defining CM6's
  equivalent; do not copy credentials or stale routing state into localStorage.
- `app/apps/file_editor/main.js` is the CM6 app entry; its template and backend
  must be included when tracing settings, navigation guard, and launch intents.
- Source-tree sticky behavior is in
  `app/apps/code_te2/src/explorer/chrome/sticky-scopes.ts`; accepted Contents/
  Changes sticky CSS is separate and must remain unaffected.
- Code TE2's ownership, Sidebar ledger, exact-client routing and project/terminal
  contracts are in `docs/apps/code_te2/CODE_TE2.md`. Source remains authority.

## Contract Map: First Read-Only Investigation

Verified from the current branch source; no runtime changes or live behavioral
claims are implied by this map.

### Existing Launch And Query Contract

`framework/rust/crates/te2-server/src/apps_lifecycle.rs::open_app` handles
`POST /api/apps/{app_id}/open` generically. It calls `start_app_inner`, publishes
running state, and returns `/app/<canonical_id>` with supplied non-null `params`
URL-encoded as query parameters. File Explorer is not special in this endpoint.
This transports launch parameters; it does not guarantee the target app consumes
them or that a requested project/session action has finished. Trace the existing
launch versus HTTP/pipe readiness barrier before sharing this helper with a pipe
broker. Do not add a second worker lifecycle implementation.

### Framework Pipe Transport Is Not Yet An App Broker

- `app/libs/pipe_dto.py::PipeEnvelope` already carries request/response/error kinds,
  request ID, origin/target names and NIDs, workspace/generation, correlation ID
  and operation ID. It does not carry a dedicated client/presentation identity.
- `app/libs/pipe_runtime.py::call` / `call_async` provide outbound calls and response
  correlation; transport close releases pending waiters. Reuse the contract.
- `framework/rust/crates/te2-server/src/app_worker_pipe_bridge.rs` owns each worker
  stream. `app.readiness` is consumed with app/shell identity derived from the
  owned pipe. Other requests reach `framework_services/pipe/mod.rs::dispatch_request`.
- That dispatcher currently handles FS, Git, search and run-target services.
  It does **not** route arbitrary target names to another app worker. Target
  fields alone are not an app-routing implementation or authenticated source.
- Response/error frames in the worker bridge currently feed the runtime-debug
  route. That opt-in debug route is not a production app-intent broker; do not
  expose or require runtime-debug for this work. Production correlation/route
  registration needs explicit lifecycle ownership and bounded cleanup.
- Code TE2's `main.py::te2_pipe_dispatch` currently returns `None` for every
  method. `native_worker.py::control` already feeds the inbound envelope router,
  so a domain adapter can reuse this entry path, subject to async loop scheduling
  and preserving existing service/debug delivery. File Explorer's dispatcher
  currently only handles its `fs.listDirectory` contract.

### Existing Domain Services To Reuse

`ui_ipc/sidebar_ws.py::_dispatch_sidebar_rpc_request` already exposes file open,
project lookup/open/create, window create/open URL/state update, and launcher
catalog operations. Project operations call `host/project_backend.py`; window
operations call `sidebar_window_state.py` and publish client-scoped activation/
presentation notifications. Keep these domain owners, not a second state ledger.

`ui_ipc/sidebar_file_open_routing.py::resolve_sidebar_file_open_target` requires
the target client to be live, its Sidebar window active, a registered presentation,
and ledger app membership matching the requesting app. It reconstructs the
presentation tuple from live backend state. The current caller supplies requester
app identity from Sidebar peer registration. A pipe adapter must instead derive
the source app from the owned worker pipe and preserve equivalent validation;
never trust a payload's claimed app/client or relax existing file-open checks.
Other intents need their own applicable validation, not an unreviewed copy of
the file-open active-window requirement.

File Explorer currently creates a short-lived Socket.IO backend client in
`file_explorer.py::_call_sidebar_rpc`: connect, register, call, disconnect.
Terminal has a similar backend helper. Their frontend still calls its own backend;
the proposed change replaces the backend-to-backend transport, not that ownership.

`host/file_ops_backend.py` currently rejects paths outside the active project and
checks containment with path objects and resolved candidates. Extend routing
before that rejection at the appropriate backend boundary; do not weaken the
editor's in-project invariant or replace it with a string-prefix check.

### Terminal Launch Gaps

`terminal/src/main.ts` reads `shell_id` and `cwd`. Its initial Sidebar state path
selects a requested live shell, or resets an unavailable shell; it does not imply
new-session creation. `resolveNewShellCwd()` returns `~` when standalone and
prefers `sidebar.cwd.get` over the query CWD when embedded. Therefore adding
`?cwd=<selected_directory>` alone does not satisfy the desired behavior.

Define an explicit one-shot new-session launch contract with selected CWD and
validated operation identity. Once fulfilled, publish/replace launch state with
the resulting shell identity so reload/reconnect restores it rather than spawning
again. Reuse the existing session creation owner. A supplied explicit CWD must
not be replaced by the active project CWD; unspecified/manual New behavior can
retain its current defaults. Confirm supported shell cleanup/error semantics.

### Proposed Boundary (Not Yet Implementation-Approved)

1. A small production framework pipe broker derives caller identity from its
   owned app pipe, validates an allowlisted intent, correlates the result, and
   delivers to the exact live target worker. No generic arbitrary-code/debug RPC.
2. A Code TE2 inbound adapter schedules work on its domain asyncio loop and calls
   reusable backend intent services. Separate connection-specific Socket.IO
   registration/notifications from the shared policy/service operations rather
   than fabricating a Socket.IO SID for pipe callers.
3. Exact client/Sidebar context lives in validated intent parameters and is
   resolved against the existing ledger/live presentation registry. Native relay
   origin or a worker app identity alone cannot select a client.
4. App launch URLs keep the existing generic lifecycle/query builder. Stateful
   app launches create the correct Sidebar tab through existing ledger services.
5. Production broker failures/disconnects terminate pending calls without replaying
   mutations. Concrete capacity, timeout, operation deduplication and worker-start
   policy remain decisions for the cohesive implementation plan.

Remaining investigation: standalone Code TE2 project-query consumption and draft
guard sequencing, new-tab stateful launch identifiers, drawer new-session/CWD
owner, source-peer proof across multiple presentations, and complete File
Explorer/CM6 menu/settings and navigation inventory. No broker edits begin until
those are incorporated into the approved end-to-end scope.

## Contract Map: App State, Sessions And Navigation

### Project Launch And Adoption

`main_page/frontend/boot/boot-sequence.ts` initializes authoritative session state
and requires an active existing project before consuming its `file` query.
The inspected boot path does not consume a project-launch query. Define a
one-shot project launch intent and backend handoff before model restoration;
do not assume a URL parameter itself switches projects or bypasses draft guards.

`main_page/backend/project_service.py::lookup_project` checks history membership,
directory existence and sidecar existence. Sidebar project open requires a known
sidecar; `create_project_from_path(adopt_existing=True)` can adopt an existing
directory and open it through the same project-switch service. For a selected
existing folder with no project sidecar, **adopt it**, not create a nested folder
or overwrite its contents. Preserve history/sidecar lookup distinctions and
normal project-switch publication. Draft confirmation and launch consumption
still need concrete sequencing in the implementation contract.

### Sidebar Tab Identity

`ui_ipc/sidebar_window_state.py::create_sidebar_window` creates a new instance ID
and console worker ID for stateful manifests, builds the app's query URL, and
stores a distinct host slot. Non-stateful app creation defaults to
`slot:<app_id>:base`, so repeated CM6 launches are not distinct file tabs under
the current non-stateful manifest. Add CM6's manifest/state publication support
through this generic mechanism instead of disguising it as unrelated URL slots.
The shared ledger is membership/state authority; each client's existing
presentation store still owns visibility/order/activation. Distinct slot identity
does not on its own prove the initiating client or live presentation.

### Drawer New Session And CWD

`terminal_backend.py::on_terminal_request` handles `shell.create` by calling
`_create_terminal_shell_data()` without its request parameters. That service
creates a new shell through `_create_editor_shell`, records its fact and project
sidecar membership, closes active terminal sockets, and broadcasts the shell list.
It chooses the active project root as CWD. Reuse this creation owner, but define
validated explicit-directory input and inspect activation/socket-close effects
across clients before routing new actions into it. Do not reuse the separate
ensure-existing-shell helper for an action that promises a new session.

### CM6 Preference And Guard Inventory

The current configurable menu settings in `file_editor/main.js` and `template.html`
are:

| Setting | Current field | Current default |
| --- | --- | --- |
| Line numbers | `showLineNumbers` | on |
| Line shading | `showLineShading` | off |
| Syntax highlighting | `showSyntaxHighlight` | on |
| Word wrap | `wordWrap` | off |
| Theme | `theme` / `currentTheme` | `cm6-dark` |

All five must move to immediate localStorage preference persistence and restore.
New/Open/Save/Save As/Close/Quit, Undo/Redo, clipboard actions, Select All,
Find/Replace and Go To Line are commands, not persistent settings. Preserve
available-theme checks and configuration-before-editor construction. Keep this
inventory current if implementation finds additional settings.

Current initialization uses `host.loadState`; changed settings recreate/update
the editor but do not immediately write preferences. The before-exit return
includes settings plus last path/draft. The shared shell's host state is keyed
by `app_state:<appId>` through `window.teState`, not per Sidebar file tab. Do not
confuse this shared app state with the requested localStorage preference record
or use it to restore another tab's document.

Concrete guard mismatch: CM6's Discard and Save-confirm call `host.requestExit()`,
but `app/templates/app_shell.html` exposes no such host method. Its
`attemptExit(navigateFn)` returns immediately on `{cancel:true}` without retaining
the original callback. A supported pending-navigation continuation is therefore
needed, with explicit cancel/resume ownership. CM6 also marks the buffer clean
on Discard without resetting text/`lastSavedContent`; its mutation observer can
mark it dirty again. `saveFile()` catches errors without returning a success
signal, while Save-confirm proceeds after awaiting it. New has a guard without
a stored continuation; Open/Close/Quit have inconsistent guard behavior.
Implement one guarded-intent path for those actions and app-shell navigation,
not just a button-specific redirect. Ordinary browser unload cannot be resumed
with an arbitrary stored callback; distinguish supported shell navigation from
browser-native unload prompts in tests and documentation.

### File Explorer And Sticky Reveal: Still Live Investigation Items

`file_explorer/main.js` reuses File/Edit dispatch handlers for New Folder/File,
Open/Open in editor, Download/Extract, Properties/Rename/Delete/Copy/Move.
Selection/enabled rules and item targeting need a full context-menu pass; do not
make long press also trigger immediate activation. Text-open navigation appears
in several handlers, so identify a shared backend intent path rather than fixing
only one link.

Show hidden toggles currently reload the directory; a successful `loadDirectory`
calls `persistState()`. There is a save path. Investigate failure timing, host
state restore and embedded versus standalone preferences before attributing the
reported loss to a missing write. Immediate preference persistence can be
selected after tracing those owners, independent of directory-load success.

The reported sticky defect is mobile-only after delayed drawer close/reopen;
desktop and general initial rendering are regression checks, not the reproducer.
When this bug reaches its scheduled investigation slice, explicitly notify the
user before live probing or attempting a fix: they want to reproduce/debug it
together. Do not silently fold it into the pipe-intent foundation work.
Source-tree `sticky-scopes.ts` already schedules on scroll, tree mutations,
tree ResizeObserver and window resize, and exposes `update()`. Hidden-ancestor
reveal is not covered by a direct tree-attribute observation. Trace
`chrome/explorer-chrome-controller.ts` and host drawer reveal/render ordering;
capture geometry at the failed reveal and compare with a successful one before
choosing a lifecycle fix. No confirmed race diagnosis yet. Dock layout/gesture
inspection is likewise pending, not an inferred CSS-only change.

## Phases

1. **Contract map:** inspect framework pipe routing, generic app launch intents,
   embedded context, exact-client targeting, and project/open/session owners.
2. **App behavior inventory:** trace all relevant File/Edit menu actions, File
   Explorer state, CM6 settings/guard, Terminal session creation, Explorer reveal
   callbacks (especially mobile delayed close/reopen), and dock gestures. Update
   source-backed findings and unresolved gaps.
3. **Cohesive plan gate:** finalize the intent matrix and concrete edit/test scope;
   obtain implementation approval before runtime changes.
4. **Explorer integration:** new File Explorer Sidebar tab, shared Terminal
   choice/new-session intent, and source-tree reveal bug correction.
5. **File Explorer integration:** item context menus, project/file/terminal routing,
   generic launch parity and hidden preference correction.
6. **CM6 integration:** complete settings persistence, discard/navigation resume,
   and stateful Sidebar launch/publication.
7. **Dock polish and end-to-end acceptance:** overflow gestures/label geometry,
   cross-app regression tests and native OTA validation.

Dependency findings may adjust slice order; changing transport/authority or scope
requires a revised approved plan. Investigations can be incremental, but avoid a
series of incompatible partial intent implementations.

## Acceptance And Publication

Validate embedded versus standalone behavior, cold/warm app launches, two clients,
multiple app tabs, reconnect/reload, historical/project/draft guards and failures.
Native clients serve installed assets: frontend build alone is not a live update.
Force OTA (or explicitly approved bundled package installation), verify the served
assets, then perform desktop and mobile acceptance. Do not restart the shared
framework without explicit approval. Synchronize versions if later changes create
a breaking frontend/native contract; APK publication remains separately approved.

No release/tag/version/build is part of this documentation pass. Record actual
test results and user acceptance in the tracker, never inferred completion.
