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
bootInlineEditorHost. Electron presents that page in a WebContentsView; mobile
loads a secondary-role page in an outer iframe. Do not simply remove the iframe:
SecondaryContentLifecycle documents non-disposable working-editor providers and
reloads between working/historical content kinds. Audit editor/global/provider
ownership, identifiers, handlers and disposal before same-realm multi-editor
mounting; do not replace isolation with singleton collisions. Establish this
lifecycle before wiring the unified menu/focus behavior against the shared DOM
host. Retain iframe isolation where appropriate for historical/extension content
and preserve Electron native overlay/reparent/detach capabilities. Historical
diffs stay read-only immutable content. Escalate any required isolation/design
change rather than quietly dropping the outer-iframe removal requirement.

- One shared File menu on desktop **and mobile** targets the last-focused editor
  area. Remove the secondary editor's redundant hamburger/File menu to free tab
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
