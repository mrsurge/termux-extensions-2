# Sidebar App Intents And Unified App Behavior

Status: planned end-to-end workflows implemented and user live-accepted;
completion reconfirmed on 2026-10-04. Earlier slice notes retain historical
validation boundaries, not outstanding acceptance gates. Native-worker/mypyc
packaging and release integration are tracked separately.
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

### Archive Manager follow-up (new direction; not prior acceptance)

Extend the established intent system to Archive Manager, restoring File Explorer
archive opening/background extraction and adding **archive-only** context-menu
actions to Code TE2 Explorer. Archive Manager can remain stateless apart from a
minimal archive launch/restore query (optionally internal member path); no new
session/tab store is required. Embedded opening uses the initiating client's
Sidebar; standalone opening uses the normal query-seeded full-page app route.

Archive operations go frontend → own backend → framework pipe broker → archive/
job owner, with exact presentation validation, captured source/destination/member
guards and no uncertain mutation replay. Query restoration only restores a view,
never submits a background job. Retain normal job progress/cancel/results outside
the view's lifetime. Replace legacy File Explorer cross-app launch HTTP/navigation
and the nonexistent expand fallback, not the minimal query launch contract itself.

Investigation, implementation gates and checklist now live in
`docs/apps/dependency_trim/PLAN.md` under **Archive Manager intent integration**
and its TRACKER.md. Earlier acceptance in this workstream does not cover this
new integration. The 0.2.355 Sidebar IPC transport cutover remains a separate task.

## Desired Behavior

### Code TE2 Explorer

1. **Open in File Explorer:** open the selected directory in a **new Sidebar
   tab**, leaving Code TE2 and its current editor in place. Do not navigate the
   whole page away from the editor.
2. **Open in Terminal:** add a directory menu entry immediately below Open in
   File Explorer. Show a standard app-owned dialog offering **Sidebar** or
   **drawer**, with a **Don't ask again** checkbox. Both choices always
   create a **new session**, rooted at the selected directory. Reuse the same
   host-owned dialog and client/framework-wide remembered-choice policy from
   File Explorer. Editor Settings below Cursor style offers Ask every time,
   Drawer and Sidebar; native storage is independent of relay origin and project.
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

### Boundary And Approval Scope

The production pipe foundation was explicitly approved and implemented first.
The native adapter and in-project document-open service were then approved as
a separate slice. Remaining intent services and user-facing integration below
are subsequent slices; the foundation does not yet enable all their effects.

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
   mutations. Foundation limits and target-start policy are recorded below;
   durable operation deduplication, if needed by a domain mutation, remains a
   domain-service decision rather than permission to replay uncertain calls.

### Production Pipe Foundation

Source: `framework/rust/crates/te2-server/src/app_intent_pipe.rs`, owned by the
app-worker bridge, not the runtime-debug registry. Each server-instance/app key
resolves one captured live worker pipe; replacement closes the prior route and
its pending waiters. Both caller and target must match the framework's current
running-app shell identity. Request `originName`/`originNid` are not caller
authentication.

- `app.open`: `{appId, params}` uses the same lifecycle start/publication/query
  builder as HTTP app-open. It returns `{url, app_info}`, **not domain-effect or
  HTTP-readiness completion**. It sends no HTTP request to implement this operation.
- `app.intent.dispatch`: `{targetApp, intent, context, payload}` forwards
  `app.intent.deliver` to the exact registered target pipe. It does not start an
  absent target. Parameters reject extra top-level fields such as forged `source`.
- Initial target is `code_te2`. `sidebar.openApp` / `terminal.createSession`
  admit Code TE2, File Explorer, File Editor and Terminal callers;
  `project.openDirectory` / `document.open` admit File Explorer and File Editor.
  Unknown methods/apps are not arbitrary forwarding capabilities.
- Forwarded `source: {appId, shellId}` is framework-derived. `context` must be an
  object; its client/project/presentation claims are **not authenticated by the
  broker**. The forthcoming target adapter must validate these against the
  existing live ledger/registry before performing any effect. No active-client
  fallback is permitted.
- Caller supplies a nonempty envelope `opId`; this is correlation metadata, not
  a durable deduplication guarantee. The broker generates fresh request/reply
  IDs and requires matching reply ID/correlation and framework reply destination.
- Up to 16 concurrent operations per source; up to 16 pending deliveries per
  target. Serialized parameter size is bounded at 64 KiB; delivery wait is 15s.
  Timeout/disconnect means the effect may already have happened. Errors are
  nonretryable; caller cancellation, transport close and worker replacement
  release waiters. No replay, cancellation of accepted domain execution, or
  rollback is implied.

Validation: native-feature Cargo check, eight production-broker tests, two
existing bounded/ordered pipe-writer tests, 24 framework-pipe tests and three
app-lifecycle tests passed (37 targeted tests). Tests cover correlation,
framework-derived identity, forged parameters, allowlisting, unavailable/stale
workers, replacement ownership, timeout/late reply, disconnect, send failure,
capacity and cancellation. This is unit validation, not end-to-end acceptance.
The shared framework was not restarted; no frontend/assets/APKs were changed.

### Native Domain Adapter And Document Open

`app/apps/code_te2/app_intent_pipe.py` admits only `app.intent.deliver` from the
framework identity (NID 1 / `framework.rust`) with matching ID/correlation and a
nonempty operation ID. The native worker binds it to its existing domain asyncio
loop after application startup. Admission is bounded to 16 operations; the pipe
reader never waits for async domain work. Replies are written off-loop. Shutdown
fences admission and cancels pending tasks cooperatively, without retries or
rollback promises. Runtime-debug remains a separate admission surface.

The first implemented intent is `document.open`, from canonical File Explorer
or File Editor workers. Context is exactly `{clientId, hostId, presentationId}`;
`payload.target` cannot override it. Framework-derived source identifies the
requester app. The shared `handle_sidebar_document_open` service validates the
connected host client, active Sidebar slot, registered presentation and ledger
app ownership before invoking the existing host/editor open service. Pipe callers
must supply the current presentation incarnation; existing Sidebar socket callers
retain their established registration behavior. No synthetic Socket.IO SID is
created. The host service retains active-project containment checks.

This slice does not implement out-of-project CM6 fallback, project switching,
app-tab creation, or terminal creation. Those intents return explicit unsupported
errors rather than silently invoking partial workflows. Caller integration also
remains pending; no frontend assets were changed.

Validation: 24 targeted Python tests passed, including actual shared-service
ownership checks before mocked file opening; five changed modules passed Mypy
and mypyc code generation. No compiled runtime group was rebuilt/activated and
the shared framework was not restarted. Live acceptance remains pending.

### Sidebar App Open And Explorer Caller Integration

The next approved slice implements `host/sidebar_app_backend.py::open_sidebar_app`.
It accepts an authenticated backend client identity, verifies live host presence,
checks the manifest-backed launcher catalog, calls framework `app.open` over the
owned pipe, then reuses existing Sidebar ledger creation/publication. Stateful
manifests (including File Explorer) allocate distinct slot/console identities for
every explicit invocation. Nonstateful manifests retain their existing fixed-base
slot policy; CM6 statefulness is still a later slice.

Before and after the asynchronous launch, validate client presence, current project
root/generation and, for embedded callers, the source slot/app/current presentation.
If a fence fails after launch, no new Sidebar slot is committed: the app process
may already have started, with no rollback, retry or mutation replay. Launch timeout
is 30s. Ledger membership publication stays global; foreground activation targets
only the initiating client through the existing backend projection path.

`sidebar.openApp` now supports embedded File Explorer/File Editor/Terminal sources.
Context retains `{clientId, hostId, presentationId}` and payload is exactly
`{appId, params}`. Target app identity is catalog/manifest-derived, not a new
hardcoded app registry. Internal Code TE2 surfaces call the same backend service
directly with their authenticated connection identity, rather than round-tripping
through their own inbound pipe or borrowing Sidebar socket sessions.

Explorer's `explorer.directory.openInFileExplorer` replaces its direct frontend
HTTP app-open call and full-page navigation. The frontend sends only `rel` through
its Explorer RPC lane. `explorer/handlers/app_intents.py` resolves and validates a
real directory under the active project (including resolved symlink containment),
uses the connection's client identity rather than payload identity, and launches
File Explorer with that path. A directory containing spaces retains its query
state and embedding identity in the created Sidebar URL.

Synthetic/regression validation: 51 Python tests and 16 Node tests pass; TypeScript
typecheck, frontend build, six-module Mypy and mypyc code generation pass. The new
handler has its own focused module; existing lazy file-tree handlers are unchanged
(compiling that older module in isolation exposes pre-existing async-local `del`
limitations). Source whitespace checks exclude generated `host.js`, which contains
esbuild-preserved vendor whitespace. No generated bundle was manually edited.

No runtime restart, compiled-group activation, native OTA or APK publication.
Before the future live working-model milestone, rebuild/activate the matched domain
group and explicitly publish native frontend assets through the established OTA
flow; a frontend build alone does not update an installed client. Terminal session
creation, project switching, CM6 fallback/statefulness and the mobile sticky-scope
investigation remain pending; notify the user before that joint mobile debugging.

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
normal project-switch publication. The Project Intent Slice below defines the
implemented confirmation and one-shot launch sequencing.

### Project Intent Slice

File Explorer's directory action and item context menu reuse its existing
File/Edit command dispatcher and guards. Right-click, 600ms touch long-press
(cancelled after 8px movement), and keyboard context-menu keys work in list/grid.
Opening a context menu clears unrelated checkbox selection, so destructive
actions cannot silently apply to a previously selected batch. Disabled commands
are omitted. Existing rename/delete/transfer dialogs remain authoritative.

Embedded project opening goes through File Explorer's own `/intent` backend and
`project.openDirectory` on the production framework pipe. Standalone navigation
supplies `project=<directory>` to Code TE2; boot consumes/removes that query before
requesting the authoritative boot snapshot or restoring/mounting models, connects
the host's own lane, and uses `ui.host.project.directory`. Cancellation/failure
continues normal boot of the current project; no reconnect or refresh replay.

Both use prepare/commit/cancel with a backend-owned 120-second ticket: canonical
directory plus device/inode, client, optional exact Sidebar presentation/app,
current project root and generation. One pending ticket per client, 64 globally;
lazy expiry, no polling. Prepare has no project effects. Existing teUI confirmation
warns drafts **could** be lost if files change externally, not certain loss.
Cancel consumes the ticket without switching. Acceptance consumes before any
await; failure is never automatically retried. Embedded proof uses the live
Sidebar presentation; standalone proof uses the authenticated host UI IPC session.
The shared project switch revalidates before cleanup and immediately before root
mutation after asynchronous watcher cleanup. A known project restores its normal
sidecar; an unknown existing directory is adopted by that same service, with no
nested directory creation, draft reset or project-file overwrite.

Validation includes project ticket expiry/replay/cancellation, changed generation,
directory replacement, disconnected client and presentation mismatch, cleanup
race guard, shared project projection regressions, own-lane frontend routing,
one-shot query handling, context-menu command reuse, TypeScript/frontend build
and Mypy/mypyc code generation. No live acceptance is claimed; no runtime restart,
compiled-group activation, native OTA, Android edits, commit or push in this slice.

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

Original guard mismatch (now repaired): CM6's Discard and Save-confirm called `host.requestExit()`,
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

### Combined File Explorer / CM6 Completion Slice

Implemented after the project/context slice: Show hidden updates the live listing
flag and existing host state synchronously from either control; listing failures
cannot revert the preference. CM6 stores only the five inventoried preferences
under `te2:file-editor:preferences:v1`; unavailable storage, malformed values and
missing themes use safe defaults. Existing state is a one-time seed, not authority
over a persisted local preference. No draft/path/credential enters that record.

CM6's modal resolves an awaited guarded user intent. New/Open/Browse/Close/Quit and
supported app-shell exits retain the original action, reject duplicate pending
actions, and execute once after successful Save or Discard. Failed or cancelled
Save remains guarded; Discard restores saved text before continuing. App-shell
`onBeforeUnload` is a distinct synchronous dirty check; arbitrary native browser
unload is not resumable. No nonexistent `requestExit` or synthetic navigation.

The common editor-open service routes canonical external paths to backend-owned
CM6 Sidebar creation before project file reads, sidecar membership or WBA model
effects. Authenticated client identity remains required; Sidebar callers retain
presentation checks through launch. Extension-origin external opens use Sidebar
completion rather than waiting for a Monaco acknowledgement that cannot occur.
Historical immutable/secondary project-only model contracts remain unchanged.

First-party launch parity uses the existing framework `app.open` query mechanism:
File Explorer `path`, CM6 `file`, Code TE2 one-shot `project`, and Terminal
`cwd`/`new_session` transitioning to published `shell_id`. No new transport or
frontend relay. Unit/source validation does not claim live acceptance or OTA.

The combined slice subsequently received user live acceptance, including the
cached Code TE2 local mypyc build wrapper. Mobile follow-up: a successful Sidebar
document-open dispatch into the project editor sends the existing drawer-close
notification to the exact host client with `mobileOnly` and feedback text. The
host closes its sidebar and toasts "Opening in code editor" only in mobile
layout. External CM6 Sidebar opens and desktop layout are unchanged; failures
send no success feedback. This feedback describes dispatch, not completed model
mounting. Its live gate requires rebuilt domain libraries and client asset OTA.

The initial implementation used the Sidebar notification name on the UI IPC
lane, whose parser silently dropped it. Corrected delivery is the explicitly
declared `ui.sidebar.drawer.close` host notification, mapped to the existing
local Sidebar event. Regression coverage now runs through MessagePack decoding,
the actual host parser and event dispatch; DOM-only tests are insufficient.
The user subsequently rebuilt and verified the corrected feedback working live.

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

The user reproduced the sticky defect on Android and local Electron at the mobile
breakpoint, particularly after file switching/rendering. Joint live inspection
found only the root sticky row despite several open ancestor scopes in the live
tree. Hit-testing found the expected nested rows; calling the existing `update()`
once restored five local/four Android scopes without changing scroll position.
This establishes a stale geometry projection, not lost directory state.

The mobile drawer translates without changing tree dimensions. Offscreen tree
renders can sample a root-only fallback; reopening previously had no explicit
refresh and did not necessarily trigger tree mutations or ResizeObserver.
The approved fix requests `update()` from mobile drawer opening, resamples at
the drawer's transform transition end, and observes tree visibility for reveals
without animation. Observers/listeners are cleaned up on destruction; there is
no polling, scroll nudge, changed scope geometry or backend state mutation.
Twelve targeted tree/result-scope tests, TypeScript checking and frontend build
pass. Updated-client live acceptance remains pending force OTA; the diagnostic
manual update is not acceptance of the new source. The user subsequently live
verified the source fix; sticky-scope acceptance is now complete.

### Sidebar Dock Overflow Slice

The approved header layout bounds the icon grid to the remaining header width,
reserves at least 80px for the title (ellipsis retained), and keeps fixed-size
icon cells on one horizontally scrolling strip. The title icon does not shrink.
Popup menus remain siblings of the strip, not children of its overflow box.
After the user's first live acceptance, the boundary was refined: Explorer and
launcher occupy a fixed left-hand control group. Only app icons scroll between
that group and the window title; utility menus and their button behavior stay
unchanged. The user subsequently confirmed live acceptance of this refinement.

Wheel input follows the file-tab dominant-axis convention, normalizes line/page
units and does not consume Ctrl-wheel or wheel input at a scroll boundary.
Horizontal touch swipes scroll only when icons overflow. Vertical-start touch
gestures retain the existing reorder lane; mouse drags and nonoverflow touch
drags are unchanged. Claiming a scroll cancels pending icon long-press/reorder,
closes the HTML icon menu and suppresses the resulting activation click. A new
tap remains active. Gesture listeners are disposed on projection refresh, and
the scroll offset is retained. No new persistence or backend authority is added.

Forty-one dock/presentation/reveal/file-tab tests, full TypeScript checking and
frontend build pass. User live acceptance is complete;
the slice does not publish APKs, bump versions or restart runtime processes.

## Phases

### Terminal Intent Slice (implemented; synthetic validation only)

Explorer's directory menu places Open in Terminal immediately beneath Open in
File Explorer. An app-owned teUI choice offers Sidebar, Drawer and Cancel; Drawer
is the initial default. The host now owns the shared remembered choice for both
Explorer entry points: `ask`, `drawer`, or `sidebar`, scoped to the stable client
and configured framework origin across projects. The dialog includes Don't ask
again; Editor Settings exposes a custom selector directly below Cursor style,
including Ask every time to restore the prompt.

The preference is a separate bounded record in existing native state storage
(Electron `desktop-state.json`, Android application-private presentation store),
not a dock-layout field or shared backend preference. Browsers use localStorage.
Native clients never fall back to random relay-origin localStorage. Reads are
demand-loaded and cached; changing the preference creates no terminal.

The backend validates the initiating intent, publishes exact-client
`ui.terminal.destination`, and immediately returns `{pending: true}`. It does
not hold the framework broker's 15-second request window open for a dialog.
The host resolves its preference/dialog and replies over its own UI IPC lane
with `ui.host.terminal.destination`. Backend single-use tickets expire after
120 seconds, with at most 64 total and one per client; lazy expiry and host
disconnect clean them up. The reply revalidates project generation, live client
and source presentation before creating a fresh session. Wrong-client, late,
replayed, cancelled and stale-project replies cannot create one. Storage failure
is reported; an explicit one-time choice may still proceed, without claiming it
was remembered. No new transport or mutation retry was added.

`host/terminal_intent_backend.py` serves Explorer RPC and pipe
`terminal.createSession`. It validates directory, live client, embedded source
presentation when provided, and project generation before creation/activation.
Explorer also enforces project containment. Stale/disconnected callers cannot
activate results; uncertain creation is never retried or destructively rolled back.

Drawer creation uses the existing PTY owner with explicit CWD, shared membership
and exact-client `ui.terminal.open` carrying the created shell ID. It does not
change the shared active-shell fallback or globally rebind sockets. Existing bind
generation/checkpoint handling owns selection. At a cap of one, sidecar membership
protects the prior active and new shell rather than evicting an active client.
Ordinary drawer create/activate behavior remains unchanged.

Sidebar launches use the existing app-tab service with CWD and a UUID
`new_session` seed. Terminal waits for its lifecycle snapshot, then creates on its
own lane. Serialized backend admission matches seed/CWD in retained FWS shell
metadata (`TE2_TERMINAL_LAUNCH_ID`): repeated requests reuse the running claim;
exited claims and different CWDs reject. This is not a permanent exactly-once
journal after FWS record removal. Success replaces the seed with `shell_id` in
the page URL and publishes concrete Sidebar state. Failures are not automatically
retried. Standalone launches can consume the same seed; supplied CWD is honored.

The user subsequently assembled the Android client and reported everything
working live. Remembered destination has user live acceptance. Native bridge
source and release-facing asset versions are synchronized to 0.2.352; no release
or shared framework restart was performed by the agent in this slice.

### File Explorer Text/Terminal And CM6 Statefulness Slice

Ordinary framework-app Sidebar presentations now receive the stable initiating
client and concrete presentation identifiers. File Explorer sends embedded
document/terminal intent to its own backend, which supplies the fixed Code TE2
target over the owned framework pipe. Missing embedded identity is an error,
not a standalone navigation fallback. Standalone file opens retain CM6 navigation;
standalone terminal opens carry CWD and a fresh session seed. Embedded Terminal
choice is resolved by its initiating Code TE2 host, using the same app-owned
dialog and native-backed preference as Code TE2 Explorer.

The shared Sidebar document-open adapter resolves paths before containment checks.
In-project files use the existing exact-client editor hook; outside-project files
open a distinct CM6 app tab without changing the editor foreground. This covers
pipe and existing Sidebar document callers, not every editor/host open entrypoint.
New-file creation navigation remains unchanged in this bounded slice.

CM6 declares existing file-shaped Sidebar statefulness and publishes its concrete
file URL through its own backend on open/Save As. Shared first-party state transport
is extracted rather than duplicated. Embedded boot does not restore an unrelated
app-global last file or unsaved draft; existing preferences remain available.
Full CM6 settings persistence and save/discard navigation continuation remain later
work. Guarded project adoption and File Explorer context-menu expansion are next:
project opening must preserve the existing draft-consent workflow, not bypass it
with an unconditional backend switch.

These changes are source/unit validated only; native asset publication and matching
compiled runtime activation are prerequisites for later live acceptance.

Successful app-intent Sidebar creation carries an explicit `revealSidebar` flag
on the existing exact-client activation event. The host uses its normal open
operation (never toggle) and existing mobile-only Explorer-close helper. Desktop
Explorer remains visible. Reconnect/restoration activation does not carry this
layout intent; cancellation/failure does not reveal. Bottom terminal drawer
activation retains its existing behavior.

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

## ALS file-open presentation routing correction — 2026-10-17

### File-open-only foreground-lag correction

An exact live registered client/slot/presentation can originate a document-open
intent while `_client_active_windows` still reflects another slot or is empty.
Document opens therefore opt into `allow_registered_inactive` at their common
backend owner; caller proof, current presentation, shared slot membership and
requester-app ownership remain required. A supplied stale presentation is always
rejected, including when the foreground happens to match. Missing presentation
identity cannot use the exception. Other intent/project/terminal/app admission
keeps its existing foreground requirement. No focus state is rewritten, fallback
client chosen, operation replayed or notification broadcast by admission.

This is the bounded pre-release repair, not the deferred framework-pipe/short-ID
migration. Tests cover pure resolution plus the real document-open composition
for both socket and pipe callers. Activation requires matching Code TE2 mypyc
source and user-approved worker refresh; frontend publication cannot activate it.
Current status/acceptance is maintained only in release_0_2_354/TRACKER.md.

Approved maintenance scope: retain Sidebar IPC while removing global last-focus
as authority for a user file click. Backend-persisted slots, conversation/query
state and console labels stay shared. Order, foreground and rendered presentation
are client-specific; document membership is shared, only the caller moves foreground.

1. The ALS common file-open frontend boundary reads clientInstanceId, te2_host_id
   and presentationId from its iframe URL. Rust validates and preserves that
   target rather than substituting FocusedWindowStore.
2. Code TE2 validates the exact registered live client/slot/presentation. No
   other-client fallback, shared-slot recreation or automatic mutation retry.
3. Reconnection republishes existing presentation identities and the local
   foreground slot. Delayed old-connection disconnect must not erase replacement
   registrations. This must not change shared membership or another client.
4. Test two clients sharing one slot, missing/stale targets and reconnect races;
   typecheck/build both frontends and validate Rust/Python boundaries.

Matching ALS native build, Code TE2 mypyc/source activation and frontend publication
remain separate gates. No runtime restart, APK, release, console-ID migration or
framework-pipe cutover is authorized here.

## ALS stdio serving readiness — approved 2026-10-17

Keep ALS independently launchable. Add explicit --stdio to its Python bootstrap
and native server, preserving inherited stdin/stdout only for framework protocol.
Preparation diagnostics/build stdout and native tracing go to stderr. Replace
the HTTP readiness poster with the same concatenated MessagePack app.readiness
notification used by Code TE2 after router preparation/listener bind. Standalone
launches without --stdio emit no framework readiness and do not consume stdin.

Switch the TE2 ALS shellspec to backend pipe/native_pipe_testing, declare stdout
MessagePack/stderr text, and set manifest readiness_support to "pipe". Preserve
the existing port, app identity and Sidebar per-presentation callback; that UI
callback is separate from worker serving readiness. No HTTP readiness fallback.

Use one native server lifecycle for executable/library entrypoints. Bound pipe
input, handle EOF/corruption and unexpected serving failure through shutdown;
unsupported inbound requests receive protocol errors, not fake service support.
No Sidebar intent migration, mypyc work or event-loop replacement is included.
Validate bootstrap flag/build-output behavior, exact framing/readiness, standalone
mode, occupied-port failure, stdin EOF and signal shutdown in disposable runtimes.
No shared framework/ALS restart, package install, APK or release is authorized.

Additional user-approved seam: remove ALS main.js's redundant HTTP health polling.
The framework app_shell already gates module initialization on worker readiness;
retain the existing proxy metadata/start URL and launch query propagation, then
mount directly. This is ALS-wrapper-only, not a generic proxy template migration.
Matching wrapper OTA/reload becomes an activation gate; no native mapping change.

## Multi-client console identity and routing — approved 2026-10-17

Console observability is not Sidebar authority. Preserve durable client IDs,
shared slots/conversations and exact transient presentation tuples; no native
identity store or saved layout migration is included.

The framework console owns a SID-indexed registry. Updated bridges register
their original identity plus parent client/presentation context and receive
`console:registered` with a compact runtime handle, e.g. `als:Ab12.Cd34`.
Each token is four case-sensitive alphanumeric characters; the suffix groups a
parent client, not an authorization grant. Allocation checks collisions with
bounded retries/capacity; tokens are not reused during this framework runtime.
Reconnect may receive a new page handle. Rediscover live handles before eval.

Duplicate legacy names remain separate registrations; ambiguous legacy evals
reject rather than broadcast. Eval targets one SID and replies must match that
SID/registration. Disconnect rejects only its pending work; timeout cancellation
stays pinned to the original SID. Logs use server-owned registration handles.
Shared-socket teardown unregisters only a matching current handle.

Never parse console suffixes into Sidebar destinations. ALS file-open RPC already
reads the caller tuple from its URL and overrides supplied targets. Mentions
retain client-local MRU selection and derive conversation from the validated
shared slot. Bind Editor/Explorer/diagnostic/Sidebar mention entry lanes to their
own connection's client before routing; another live client's ID must reject.

Validate collisions/exhaustion, duplicate IDs, both disconnect orders, stale
replies, shared-socket teardown, reconnect context, two-client file opens and
distinct MRU mentions. Console-importing tests use disposable TE2_CACHE_HOME
roots because imports reset the transcript. Typecheck/build both frontends.
Activation needs separately approved runtime-bridge refresh, Code TE2 domain/
mypyc activation and matching client/ALS assets. No restart, APK, OTA/seed,
version bump, commit, push or framework-pipe migration is included in this slice.

## Qualified Sidebar windows — corrected user requirement, 2026-10-17

The console-only short-handle foundation above is retained but is not the
requested Sidebar identity model. Code TE2 now owns short persistent references
in `ui.sidebarIdentityReferences`: main pages are keyed by durable client plus
window ID, shared states by existing host/slot ID. Four-character case-sensitive
alphanumeric references have collision checks and explicit capacity errors.
The maps do not rename existing clients, slots, conversations or saved layouts.

For main page `f0f0` presenting shared ALS state `a1b2`, the effective Sidebar
window is `als:a1b2.f0f0`, and its main-page console is `main_page:f0f0`.
Another main page `c3d4` presents the same state as `als:a1b2.c3d4`.
The wrapper manifest may declare `sidebar_state.presentation_prefix` (`als`);
other apps use their declared console prefix. These are backend-registered
presentation identities, not independently random console aliases.

Sidebar host registration binds client/window to connection metadata and returns
`mainPageId`. The existing presentation-update RPC registers a short window and
returns `mainPageId`, `sidebarStateId`, `sidebarWindowId`; the transient
`presentationId` remains the incarnation proof. Embedded and native/detached
launch paths await this registration before final navigation, preserve the
incarnation and inject the three short fields into their local URL. The URL's
`te2_console_worker_id` is the qualified window ID. Main/ALS/shared console
bridges request preservation of these exact names under the existing SID-owned
console safeguards, rather than another random rename.

Main-page registration readiness and identity requests are bounded and reject
on disconnect; no stale acknowledgement crosses a connection epoch. Reconnect
republishes current presentations. Qualified console replacement by the same
client retains the name but changes SID ownership; old disconnect/replies cannot
remove or answer for its replacement. Unqualified legacy duplicates remain
ambiguous and do not broadcast evaluation.

ALS file-open frontend and Rust DTO gateway preserve `sidebarWindowId` and
`mainPageId`. TE2 validates both against the registered client, slot, live parent
and incarnation before existing open authority runs. Mentions carry the same
registered identity with the client-local MRU target; the target slot still owns
the conversation. Compatibility without short fields retains existing tuple
checks; supplied malformed/stale short fields never fall back. Qualified state
publication cannot persist a client's suffix: presentation-only query fields
are excluded from shared restore/query state and the shared console base stays
unqualified. Old stored URLs are qualified when mounted, without clearing docks.

Validation covers the exact examples above, same-installation distinct window
references, restart restoration, collisions, stale incarnations/parents, both
disconnect orders, shared-state URL isolation, requester binding, ALS gateway
forwarding and frontend registration readiness. This adds an ALS Rust gateway
change: activation needs its matching native build/install, Code TE2 mypyc/domain
activation, framework console bridge refresh and matching client assets. No
restart, package install, APK, OTA/seed publication, commit/push or version bump
is included in source approval. Live multi-client acceptance remains separate.
