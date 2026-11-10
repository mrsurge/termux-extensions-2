# 0.2.357 plan

## First priority: second editor area — 2026-11-02

This precedes the earlier intake and backlog below. S1 is implemented and
user-live-accepted (2026-11-03), commit ad98ca81. The 2026-11-04 requirements
below supersede the earlier globally shared primary/secondary membership design.
User approves updating this plan; remaining source changes, builds, asset
publication and runtime restarts still require slice approval.

### S1. Align the desktop editor rectangle

Make the primary and docked secondary editor share the same bottom edge. The
terminal/bottom panel and its horizontal resize boundary belong underneath both
editor columns. Preserve Explorer/right-sidebar rails, footer, secondary width,
collapse/detach behavior and Electron's native WebContentsView overlay.

Pre-fix source finding: template.html put the secondary host and vertical resize handle
in grid rows 2 / 5 (including terminal row 4), while the terminal and horizontal
handle occupy only column 2. Adjust these related grid spans together. Native
placement in main.ts measures the host rectangle; secondary-editor-registry.ts
applies those bounds with zoom, so verify actual overlay placement rather than
assuming CSS alone proves native correctness. This small independent slice is
complete; preserve its accepted geometry throughout the remaining work.

### S2. Shared opened documents, per-client placement and secondary tabs

Keep one backend-authoritative project opened-document set, shared by all
clients. Primary/secondary placement, tab ordering and foreground are per-client
presentation state, not globally shared group membership. Reuse authenticated
client/presentation identity and existing project state owners; do not clone
document/draft/autosave/WBA state machines or let a frontend own global admission.

- A globally open document is projected into every connected client. Each
  client may present it in primary, secondary, or both; at most one tab for a
  given file in each area. Two presentations still reference the same document.
  Do not create duplicate tabs in an area or duplicate backend document models.
- Give secondary its own tab bar. Direct Explorer-to-secondary open adds only
  that local presentation, not a primary tab in the initiating client. Other
  clients retain their known placement; a client receiving a newly opened file
  without known placement defaults to primary. This also applies after offline
  opens, initial connection and reconnect. Reconcile against current backend
  membership; stale stored placement must not reopen a globally closed document.
- Explorer context-menu wording: change "Open in a second window" to
  "Open in second window". Apply with the upcoming presentation UI work;
  this note does not change the current label yet.
- Represent placement with explicit primary/secondary flags (or equivalent
  typed enum/bitmask). Derive the local 0/1/2 presentation count; count alone
  cannot identify which area presents the file. Never sum counts across clients
  or use network connections as document owners. A disconnected client does not
  close documents, release ownership or prevent a later global close.
- Closing one of two local presentations removes only that presentation and
  leaves the shared document open. Closing the last presentation in the
  initiating client requests a backend global document close: remove the file
  from every client's areas, regardless of their different placement or counts.
  Example: client A secondary-only and B primary-only both close when either
  requests its last-local-presentation close. Another client's two presentations
  do not veto that global close. Preserve draft/save/discard consent and cancel
  behavior before backend closure; do not silently discard content.
- Distinguish local presentation removal, global document close, pane
  hide/collapse/detach, and actual model disposal in typed commands and handlers.
  If an explicit close-everywhere action exists, keep it distinct from closing
  one of two local tabs. Hiding a pane or focusing an extension panel is not a
  file close. Publish document-close/WBA disposal only for committed global
  closure, not presentation removal. Trace active-editor/focus notifications;
  WBA should otherwise need little change and no parallel ownership protocol.
- Migrate existing shared opened documents without inventing secondary tabs.
  Restore valid known local placement/current secondary file where available;
  default unknown placement to primary. Define historical-content restoration
  separately rather than treating immutable diff snapshots as working files.
- Fence revisions/project generations, global-close versus open/reconnect races,
  stale local close intents, project switches and cold restoration. The backend
  must serialize authoritative mutations and validate the initiating client's
  presentation transition; a client-supplied integer is not lifetime authority.
  Reuse concrete DTOs/codecs/RPC lanes and bounded presentation storage. Browser
  storage, if used for presentation hints, cannot own shared opened documents.

Source findings: open_state_backend.py currently admits files into one shared
recent_files membership; remove_sidecar_recent_file removes a document globally
and updates affected client foregrounds. Existing client_foregrounds already
separates foreground selection. host/secondary_content_state.py holds a bounded
worker-local exact-client content descriptor, not a durable shared tab list.
These are reuse points for the revised contract, not evidence that independent
per-client area placement is already implemented. This is a state-contract
change, not merely a second frontend tab bar.

### S3. Unified container, menu/focus ownership and browser support

Support ordinary desktop web clients as well as Electron and mobile. Current
mobile-secondary-editor.ts explicitly gates non-Electron support by mobile UA
and mobile layout; this does not establish an inherent backend identity limit.
Use S2's shared document set and per-client placement. Mobile and desktop must
have the same secondary-area behavior, tabs, File menu targeting and focus/key
ownership; only responsive element placement and platform-native presentation
mechanics differ. Do not create a second mobile implementation of these rules.

Implement a regular outer pane/tab container and remove the outer working-editor
iframe as an explicit lifecycle step, not an assumed consequence of adding tabs.
Monaco itself is already mounted into a regular element through
bootInlineEditorHost. Electron retains its WebContentsView. Mobile now directly
mounts working content using the same reduced shell with an injected bridge;
historical comparisons retain an isolated secondary-role frame. Content-kind
transitions replace that presentation without reloading the main page. Audit editor/global/provider
ownership, identifiers, handlers and disposal before same-realm multi-editor
mounting; do not replace isolation with singleton collisions. Establish this
lifecycle before wiring the unified menu/focus behavior against the shared DOM
host. Retain iframe isolation where appropriate for historical/extension content
and preserve Electron native overlay/reparent/detach capabilities. Historical
diffs stay read-only immutable content. Escalate any required isolation/design
change rather than quietly dropping the outer-iframe removal requirement.
Controlled instance disposal is implemented, including abort fences during
asset/import boot. Boot admission is now per root with duplicate renderer-ID
protection. The visible mobile working iframe is removed; direct-mount/input
handoff is implemented. The user live-accepted the cutover and reload identity
fix, but explicitly confirms the extra-key focus bug remains unresolved; keep
that repair and its live acceptance open.
TextMate catalog/factory/token providers and snippet production now have shared
lease ownership; the stale grammar-transport fixtures are repaired. These are
preconditions for that direct mount; historical/extension isolation remains.

- One shared File menu on desktop **and mobile** targets the last-focused editor area
  (capture/execution routing implemented; live acceptance pending). Existing
  document/edit actions pin the renderer before dialogs, then validate its live
  association, project generation and foreground. New stays unchanged until
  secondary untitled-document semantics exist.
  Remove the secondary editor's redundant hamburger/File menu to free tab
  space. Opening/clicking the shared menu must retain the intended editor target
  instead of resetting it through menu focus. Capture a valid target for an
  action; reject stale/disposed/project-switched targets, with no cross-client
  focus changes. Preserve document-scoped save/run/draft consent rules.
- Extension panels retain their existing content/menu behavior and do not gain
  an editor File menu. When a panel is the active tab, disable inapplicable
  editor-only actions rather than accidentally applying them to a hidden file.
- Trace and reuse the terminal drawer's working focus/extra-key ownership,
  modifier and focus-restoration conventions before adding new mechanisms.
  Both editor areas must share one active-area routing pattern with the menu;
  preserve terminal ownership rather than installing a competing global owner.
- Fix the reported mobile regression: after secondary receives focus, extra keys
  remain stuck targeting it when the user returns to primary. Editor focus must
  update ownership; tapping an extra key must preserve the editor target instead
  of stealing or latching focus. Cover sticky/consumed modifiers, tab switches,
  pane close/hide, foreground restoration and transitions to/from the terminal.

### S4. Secondary extension panels as tabs

Allow extension-created secondary panels (surfaceKind=panel, such as toolbar
actions) to be hosted in the second area, including an explicit transfer from
the sidebar. Do not move primary contributed sidebar views by default. Reuse
existing ExtensionWebviewSurface identity and presentation registration; move
the presentation rather than duplicating extension/backend instances.

Preserve sandbox/CSP/resource scopes, typed binary messages, readiness/replay,
visibility/focus callbacks, retainContextWhenHidden, disposal and project/WBA
generation fences. Tab switches or moves must not imply extension-panel close.
Keep Electron's native overlay/reparent/detach approach. An extension reload is
not an acceptable substitute for a presentation move when it loses live state.
Audit which panel state is shared versus client-specific before defining restore
semantics. Existing WBA panel/view distinctions and sidebar presentation IDs are
the reuse points; this is a separate integration slice after shared-document and
per-client placement semantics. Reuse the same tab/container behavior on mobile
and desktop; extension panels do not require their own editor File menu.

### Validation and implementation gates

S1 is complete and user-live-accepted; retain its desktop geometry regression
coverage. Next approve the concrete S2 state contract/migration and close paths,
then S3 lifecycle/container work followed by unified menu/focus integration, then
S4 panel rehosting. Do not begin source implementation from this plan-only update.
Add backend migration/open-close/placement/concurrency tests and strict
frontend/WBA/Python gates as applicable. Live groups: Electron, desktop browser,
mobile; multiple clients with differing placement and foregrounds; direct
secondary opens; duplicate admission; close one of two local presentations versus
global close of the last local presentation; another client's two-presentation
case; disconnected/rejoining clients; drafts/autosave/cancel/project switch and
cold restore. Verify shared File menu targeting on **both** mobile and desktop,
menu focus retention, extension-tab disabled actions and mobile primary ->
secondary -> extra key -> primary -> extra key ownership, including modifiers,
file switches, pane closure and terminal transitions. Extension panels additionally
need messages, focus/visibility,
transfer, hide/reveal, real close and WBA restart tests. Preserve existing
historical-diff behavior. No Android packaging or shared restart is authorized
by this planning intake. No new live acceptance is claimed beyond completed S1.

## User-priority intake — ahead of the existing backlog (2026-10-31)

Work in this order; further user additions may precede the older sections below.
Preserve the existing deferred work and its acceptance/history.

1. **Experimental WBA native AOT trial.** Follow the repository-root SKILL.md
   (bun-typescript-aot), distinguish true native AOT from JIT/bytecode executable
   bundling, and verify actual toolchain support before building. Local Bun
   1.3.14 does not advertise AOT. Use a separately pinned toolchain and visible
   project workspace on the VPS, not a global upgrade. Audit the current typed
   WBA entrypoint, dynamic/runtime-relative module resolution, VS Code runtime
   imports and browser-served assets. Attempt an isolated native Linux build;
   preserve diagnostics and compare compatible JIT/source controls. No production
   launcher/transport change, shared restart, APK packaging, Any escape hatch or
   unapproved source rewrite. A successful compile is not integration acceptance;
   test readiness, actual protocol traffic and relocated assets before adoption.
   Assess Termux platform support separately; do not assume a glibc binary works.
   Read the supplied skill directly; formal skill installation is not required.
2. **Main page and app-shell favicons.** Audit actual rendered HTML and routes.
   Both templates currently declare manifest/apple-touch icons but no explicit
   standard favicon. Reuse TE2's existing icon for the launcher and resolve app
   shell icons from existing manifest/registry metadata with a TE2 fallback.
   Preserve image/text/emoji distinctions and URL safety; avoid app-ID branches.
   Check client interception/OTA mapping as well as browser HTTP behavior.
3. **Client framework-bookmark settings consistency.** Move the create-bookmark
   affordance immediately below the host/port/Connect row. Collect bookmark name
   through the existing generic text-entry dialog, rather than its separate
   permanent inline name field. Audit Electron's shared android_shell UI and
   Gecko/Cefrium/Termux native settings paths; reuse established dialog methods,
   preserve saved bookmarks/connection behavior, and validate cancel/empty/error
   flows and narrow/wide layouts. Android source/bundle/build changes require
   approval of that implementation slice; scheduling is not publication approval.

User approves recording this intake and isolated VPS AOT investigation/build on
2026-10-31. Favicon/settings implementation remains a subsequent approval gate.

First trial: actual AOT requires the tested canary da867c60b, not the current
stable 1.4.4 release despite documentation examples. Unchanged WBA compiles and
passes AOT type checking, but its executable cannot start after relocation due
to missing runtime theme assets; JIT bundling also has a runtime-relative vendor
import failure. The ordinary generated-dist process passes isolated protocol and
asset controls under the same Bun. Approve a concrete packaged-asset/module-root
strategy before further edits; compilation alone is not adoption. Full receipts
and exact commands/limits are in TRACKER.md. Keep the root user-supplied SKILL.md
unchanged and qualify its toolchain assumptions with observed evidence.

2026-11-01 packaging follow-up: an explicit app-level build root and embedded
shipped resources resolve AOT startup and browser-asset lookup without production
code edits. The generated codec is staged byte-identically at its source-relative
resource path in the disposable build checkout. Relocated executable passes
isolated pipe/Socket.IO/HTTP/asset/EOF checks even with that checkout temporarily
hidden. User-installed themes/extensions remain external runtime inputs; they
are not embedded. Full code-server/exthost and installed-theme integration is
still required before adoption. The JIT standalone has separate import/asset-name
problems; retain the passing ordinary dist process as the qualified control and
do not claim a complete AOT/JIT performance comparison. Exact receipts: TRACKER.md.

WBA follow-up approved 2026-11-01: implement the missing optional
@socket.io/bun-engine for Bun/AOT, retain Node/missing-module fallback and a
TE2_WBA_BUN_ENGINE=0 diagnostic control. Share HTTP/RPC logic, not a loopback
proxy, and report the actual engine. Rebuild AOT before comparing interpreted
and compiled transport behavior; older benchmark receipts used standard
Engine.IO in every mode. Preserve the live experimental launcher until the user
approves replacing it. Pixel Termux compilation remains a separate next test.

## Bundle native Node dependencies with wheels

User requests release-time packaging instead of first-run npm install/native
compilation. Bundle node-pty and audit all shipped Node consumers for other
native addons, including the optional msgpackr-extract server-codec accelerator.
Include their required JS wrappers, support files and license notices, not just
loose .node files. The Bun engine itself is JS and is already separately bundled.

For Android/Termux, generate the native addons on the Pixel; an upstream Android
prebuild is not a prerequisite. A working node-pty was already built and exercised
there under Node 26 while diagnosing npm 12 script blocking. Qualify the intended
Node 24 baseline too before treating that artifact as release-compatible.
Build Linux variants in the Linux wheel environment, not on Android.

Inventory platform/architecture, Bionic versus glibc, shared-library dependencies
and Node-API versus Node-module-ABI compatibility. Declare the tested runtime
contract and enforce artifact selection accordingly; do not assume cross-version
compatibility or require separate binaries where stable Node-API is sufficient.
Use existing package-resource materialization and atomic fingerprinted runtime
selection. Normal supported wheel installs must not invoke npm or a compiler;
missing/incompatible packaged artifacts must produce a precise error rather than
silently downloading/building. Any editable/source-build escape hatch is explicit.

Validate installed Linux and Termux wheels in clean environments with npm/network
and build tools unavailable: native module load, real PTY spawn/I/O/resize/exit,
and server MessagePack interoperability/native/fallback behavior. Measure wheel
size against publication limits. Keep accepted AOT artifacts as experimental
receipts; this packaging work does not require adopting AOT or rewriting WBA.
Record the request now; implementation/publication remain separately approved.

## Consolidated terminal, run-profile and app-install UX intake

This is the active home for these items. Only the deferred shell-execution
section is transferred from release_0_2_356/PLAN.md, not that entire plan.
Other completed/deferred work and historical notes remain in their owning docs.
The following is planning intake, not authorization to implement every item.

### Terminal app termination and exited-session presentation — 2026-11-09

User reports redundant Stop/Kill controls and a shell-exit path that disconnects
the WebSocket and repeatedly toasts unsupported-pipe errors. Treat that transport
sequence as a reported symptom to trace, not an established root cause.

- Replace separate Stop/Kill controls with one deliberate termination action.
  Audit their actual semantics first; if they are graceful/forceful termination
  levels, make forceful termination a bounded fallback for the same action.
  Keyboard interrupts remain available and are not synonymous with terminating
  the session. Reuse existing backend-owned shell lifecycle methods.
- On natural shell exit, preserve the final terminal render/checkpoint and show
  an inert exited-session presentation with “Press Enter to exit” (and an
  accessible touch/click dismissal). Do not replay input into a dead shell,
  reconnect/reopen it or attempt unsupported pipe operations. Dismissal returns
  to the terminal splash/session list; it does not close the whole app.
- If the user explicitly terminates/exits the session through the UI, dismiss
  its presentation and return to the splash/session list once termination is
  confirmed. Do not leave that deliberate action on the retained-screen prompt.
- Model natural exit, explicit termination, transport loss and genuine failure
  distinctly. An expected shell/stream closure is not a reconnect/pipe-error
  toast loop. Preserve useful reporting for actual failures without repetition.
- Validate exit during startup and after output, termination escalation, final
  screen retention, keyboard/touch dismissal, disconnect/reconnect distinction,
  and repeated/late events on desktop and mobile. Trace other terminal surfaces
  if shared code changes, but do not impose app-list navigation on the drawer.

### Login-shell environment and terminal profile setup

Investigate the user-reported Termux login-shell prompt carrying the launcher's
venv label even though the new shell is not actually using that venv. Trace
inherited environment/prompt activation state and login initialization before
changing behavior. Show the shell's actual environment, not a stale cosmetic
venv indicator; do not blindly erase an intentionally requested environment.
Cover standalone, File Explorer and editor-drawer terminal launch paths where
applicable, using shared ownership patterns rather than cross-app source imports.

Add a terminal profile/settings setup modal for executable/command, arguments,
shell/login behavior and sizes (terminal dimensions and presentation/font sizing
as appropriate to the existing surfaces). Audit existing preferences/profile
machinery before defining scope/defaults, persistence and per-terminal overrides.
Keep shell creation and durable configuration backend-owned. These are TE2
terminal profiles, not VS Code extension-contributed terminal profiles.

### Shell-execution run profiles and command-palette commands

Transferred user requirements from the deferred .356 section (2026-10-25):

- Add a shell-execution run-profile type: execute the configured command in the
  running editor terminal, or create/open one when necessary, reusing the same
  execution/terminal ownership as built-in Python/Node/GCC runners. This is not
  a new web-server/preview profile or another shell backend.
- Preserve current-file substitutions `%` and `%<` (extensionless counterpart),
  including `gcc % -o %< && ./%<`. Support additional arguments appended to the
  command tail. Add explicit `.desktop`-style `%f` current-file support; audit
  and agree any additional field-code subset rather than implying full desktop
  entry compatibility. Define literal-percent escaping, argument/token handling,
  shell versus argv semantics and quoting for spaces/Unicode/metacharacters;
  do not interpret arbitrary file paths or placeholder contents as shell code.
  Reuse existing runner substitutions, cwd/path and dispatch helpers.
- Add a root command-palette option accepting a shell command for that same
  editor-terminal path. Typing/preview must not execute; explicit acceptance
  executes, cancellation does nothing.
- Whenever a user action invokes the editor terminal (including these profiles,
  palette commands and existing terminal-open actions), reveal it and transfer
  keyboard focus after readiness. Exact-client ownership remains authoritative;
  background state/restoration must not steal focus.
- Preserve run/save/draft consent, disconnected/no-replay behavior, existing
  terminal reuse and creation/readiness. Validate substitutions, trailing args,
  explicit acceptance/cancel and desktop/mobile focus before live acceptance.

### Third-party second-root app package installation UX

Second-root discovery, manifests, shellspec/lifecycle and registry refresh
already exist. The missing feature is user-facing install/open handling for an
app package file/ZIP, not a new app runtime or generic dependency/build system.
Reuse existing second-root registration and app start/open mechanisms.

Plan a picker/open-with/context-menu entry, app metadata/manifest preview,
explicit installation/launch consent, progress/error/cancel feedback and clear
duplicate/update handling. Recognize app packages by validated content, not ZIP
extension alone. Validate archive paths, manifests, app IDs and destination
boundaries; do not run arbitrary archive scripts on selection or extraction.
Extract/install atomically under the existing user app root, refresh the registry
through its established backend owner, and offer to open the installed app.
Keep install, build and execution distinct; any required build/install commands
need their own explicit consent. Scope UI integration after auditing existing
picker, File Explorer/archive and launcher conventions; no new parallel installer.

## Release dependency order: wheels before APKs

User requires this order beginning with the next release (2026-10-28): finish
and jointly validate companion/runtime wheels on Linux and Termux first, then
make those exact versions available to the APK install/start workflow, then
freeze/bundle/build the APKs and perform device acceptance against those wheels.
APK-local assets do not remove the dependency on the installed framework/editor
backend. Do not present a new APK tested against an older backend as complete
release validation. Preserve separate wheel and APK acceptance gates; do not
start final APK packaging before its wheel prerequisites are ready.

## Fail-closed built-in asset routing

Deferred from .356 by the user on 2026-10-27 to preserve the release schedule.
The corrected exact codex-ext approval-module alias remains in .356; broader
routing hardening is not a .356 release blocker.

The approval incident exposed different miss behavior: Cefrium/TE2 Termux's
unmatched module request fell through the framework relay to the server, hiding
the bad local alias, while Gecko's local asset origin returned 404. Bundled-file
presence and hashes did not prove that the actual dynamic-import URL was local.

Define a manifest-backed distinction between local-only built-in static assets
and genuinely dynamic/backend requests. Declared asset requests must fail closed
when missing or unmapped, never silently fetch from the upstream server. Preserve
normal API/socket/document routing; do not indiscriminately block unknown API
requests. Audit Gecko, Cefrium, TE2 Termux and Electron against the same contract.

Add end-to-end regressions for actual request URLs, redirected ESM/local-origin
imports, absent files and incorrect aliases. Verify that asset misses generate
clear failures and zero upstream requests, while dynamic routes still proxy.
Resume only with separately approved implementation and client validation.

## Code TE2 pipe concurrency — deferred O2 continuation

Deferred from .356 at the user's request on 2026-10-26. Completed DTO/PyO3
byte-ingress/native-type optimizations remain accepted, not pending work.
The user reports searching 6,000+ files and delivering all needle-in-a-haystack
results in under one second without earlier stalls. This is user-observed
behavior, not a controlled benchmark or a new throughput guarantee.

The original request includes multiprocessing, multithreading and event queuing
on Code TE2's receiving/processing side, using the main framework scheduler as a
reuse candidate. Tokio tasks alone are not multiprocessing. Historical synthetic
Ferrous/JSON-RPC tests demonstrated tens of thousands of concurrent real RPCs
per second; the reported search backpressure was Python-worker intake, not FD
transport capacity. Preserve that distinction when investigating.

Resume only if workloads demonstrate sustained queue pressure, unrelated RPC
responsiveness problems, or a new concurrency requirement. Audit the current
framework scheduler and Python ownership/GIL boundaries before choosing processes,
threads or bounded queues. Preserve ordering, cancellation, bounded memory and
state authority; measure a user-visible benefit against coordination and
serialization costs before production adoption. Scheduling this backlog does
not approve implementation or require resuming it first in .357.

## Shared Rust runtime libraries

User defers this work from .356 on 2026-10-25. Target final product size,
duplicated build work and developer ergonomics, not request-speed claims.
No production integration, build, version bump or publication is authorized
by this scheduling decision.

Preserve the isolated source and methodology in
../../../framework/shared_runtime_probe/README.md and historical evidence in
../release_0_2_356/TRACKER.md (O5). The equally stripped C-ABI cdylib fixture
reduced total ZIP bytes from 1,136,342 to 902,159 (~20.6%), with library-only
private implementation updates. Initial build times were essentially tied.
These are small synthetic fixture results, not production savings estimates.
The earlier ordinary Rust-dylib control was larger and is not the intended design.

## Continuation gates

1. Approve a bounded production candidate/API after auditing actual duplicated
   linked code. PyO3 is worker-only, not a shared framework dependency.
2. Specify versioned C ABI, buffer/handle ownership, panic/error boundaries,
   library identity and relocation. A compiler pin does not stabilize Rust ABI.
3. Qualify dependency/Ferrous alignment and platform-specific compiler/toolchain
   policy; preserve Linux private Python versus Termux system ABI boundaries.
4. Design manifests, fingerprints and receipts so private implementation changes
   rebuild the library without rebuilding compatible consumers. The PoC driver
   demonstrates this policy; production bootstrap does not implement it yet.
5. Measure complete compressed wheel/native payloads and clean/incremental
   builds; validate loaders, missing/wrong libraries and compatible replacement
   on Linux and Termux before adoption or release.

Direct search/FS/Git operations reuse is a separate potential stage, not implied
by shared packaging. Preserve authoritative framework state, authorization and
scheduling; do not create competing owners. Runtime activation and live acceptance
remain explicit gates after any separately approved implementation.

## ALS — repo-memory maintenance and independent integration settings

User intake 2026-11-09: schedule in this release alongside ALS work. Planning
only; investigate the ALS source and approve a concrete implementation separately.

- Define a configurable repo-memory size threshold (value/unit still to decide).
  Above it, include a maintenance alert in every relevant KB MCP invocation's
  output and every repo-memory/developer-instruction concatenation used for
  session initialization and handoffs. Measure the canonical current file;
  do not rely on stale transcript copies. Alert text instructs the agent to
  spawn a specifically named repo-memory maintenance subagent to review/compress
  the file. Ordinary compression does not require another user decision.
- Preserve architectural facts, user-authored requirements and unresolved notes
  while compressing. Offloading information into repository documentation is
  optional and requires the user's discretion/approval; this is the user decision
  within the maintenance operation. Do not silently discard facts to meet a limit.
- Design a reserved subagent-name marker/escape sequence recognized by the
  harness. It identifies a temporary maintenance role authorized by this feature's
  policy, not an arbitrary string that grants unrestricted execution authority.
  The harness must enforce Markdown-only writes, normally to the exact canonical
  repo-memory file within the repository CWD. Other Markdown paths require the
  separately approved documentation scope. No code/config/non-Markdown writes,
  path/symlink escapes or repository-wide approval/permission bypass. Expire the
  grant when the maintenance assignment ends; retain normal runtime/sandbox
  enforcement. Audit the actual extension/harness enforcement points before
  choosing the marker or claiming that these restrictions can be guaranteed.
- Add explicit KB MCP usage instructions and automatic creation of the generic
  repo-memory file when repo-memory integration is enabled. Reuse existing KB
  and repo-memory mechanisms and preserve existing file contents/user changes.
- Split settings into independent **Repo memory integration** and **TE2
  integration** flags. Repo-memory integration creates/maintains the generic
  file and installs its developer/KB instructions. Remaining TE2-specific
  integration belongs to the latter flag. Define migration/defaults so existing
  users do not unexpectedly lose instructions or receive duplicate injection.
- Validate threshold crossings, repeated KB/init/handoff alerts, absent/disabled
  memory, safe creation, compression fidelity, user-approved offload, reserved
  marker spoofing, write-scope enforcement and grant expiry. Verify all settings
  combinations and existing-session/handoff behavior. Implementation and live
  acceptance remain separate gates; do not interrupt the current editor cutover.

## Final backlog — native window presentation hints

User proposal recorded 2026-11-09. Defer until the user confirms their Android
Electron application base is ready; this is scheduling, not implementation approval.
Keep this after the current editor cutover and existing backlog.

At native window creation, investigate optional semantic presentation hints for
external Electron-compatible hosts: role (`dialog`, `file-picker`, `tool`,
`document`), owner-relative placement and animation category. Reuse existing
dialog kind, parent/modality and window contracts rather than deriving intent
from HTML or adding a parallel window manager. Android hosts may map hints to
native presentation/animations; unsupported hosts retain existing behavior.
Use semantic categories rather than Android resource IDs, respect reduced motion,
and keep modality, focus, authorization and lifecycle rules authoritative.
Audit and approve the concrete cross-host contract after the Android base is ready.
