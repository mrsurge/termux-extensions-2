# Electromux host plan

Status: approved planning direction; implementation requires a separate scope approval.
Date: 2026-10-06.
TE2 integration branch: `feature/electromux-host`.

## Goal and ownership

Create a framework-agnostic Electromux repository: an Electron-like Android
application host using Cefrium and Termux-backed execution. Prove it with an
independent sample and tests before TE2 adopts it. The corrected
`electromux-onboarding-draft.md` describes the direction, not a shipping SDK.

TE2 adoption means **TE2 Termux**, an additional Electromux-based Android app with its own
APK/application ID, installable beside TE2 Cefrium and GeckoView. It is not a
replacement or in-place migration of either existing client. Cefrium is the
new host's rendering dependency, not an app package to replace.

TE2 Termux is the launcher/display name; Electromux remains the framework-agnostic
host/library name. Select a distinct application ID during prototype setup.

Electromux owns the Android entry point, browser lifecycle, bundled asset
loading, Termux launch adapter/helper, bounded IPC and session ownership.
Consumers own UI composition, business logic, workers and framework supervision.
No generated HTML delivery, static-site generator or generic iframe replacement.
Static assets/layout can load concurrently with backend startup; semantic
readiness unlocks backend-dependent interaction.

Initially consume the separate repo as a pinned Git submodule; evaluate Gradle
libraries/plugin and Maven distribution after the sample contract stabilizes.
Pin Cefrium source/artifacts/plugin together. Preserve the independent Cefrium
toolchain; a submodule does not isolate incompatible AGP versions.

## Phase 0: contracts and reference inventory

### API-declared mobile chrome slice (approved 2026-10-07)

Electromux declares packaged chrome through `ChromeSurfaceSpec`: consumer
descriptor, exact entrypoint, placement and bounded height. `ChromeSurfaceHost`
is the renderer attachment/disposal seam, independent of TE2 and Cefrium. The
consumer supplies HTML/CSS/JS; the Android adapter attaches a small separate
Cefrium browser. Do not import the desktop toolbar or inject privileged controls
into application pages.

TE2 Termux supplies the mobile Home/Reload/Recents/Lock/Quit/Tools toolbar in
`desktop_client/android_shell/chrome.*`. JavaScript exposes the Electron
shell-preload-shaped `te2Desktop.request(method, params)` and `onStatus(callback)`
returning an unsubscribe function. This is a declared subset, not BrowserWindow
or arbitrary ipcRenderer compatibility. TE2 retains action semantics. Native
tools-overlay contents and dialogs remain unchanged; ordinary Cefrium retains
its native header and Gecko is unaffected.

Use the generic query/envelope/event bridge with exact browser/document identity,
request-size bounds, navigation generation fencing and disposal. State updates
follow async lock completion, without polling. Toolbar renderer recovery reloads
only its own packaged document once, never the framework or application.

Approved scope: reusable-library and TE2 source, asset generation, unit/browser
regressions and Kotlin build checks. No APK installation, runtime restart,
release or version bump. Checkpoint the independent Electromux source and matching
submodule changes before updating the pin. Next: rebundle/install an approved
APK, user live-test all actions and lifecycle transitions, and measure the extra
browser's startup/memory cost before claiming full parity.

Record exact source revisions and extraction candidates, not whole-activity copies:

- `android/cefrium`: MainActivity, CefriumApplication, asset relay/native query,
  persistent network service and existing policy/lifecycle tests.
- `desktop_client/electron/src/main/local-framework-controller.ts` and tests:
  owned versus external sessions, startup failure, control hello and shutdown.
- `framework/bootstrap/bootstrap.py`: `--stdio-control` uses stdin requests
  and inherited FD 3 responses; this is distinct from worker MessagePack pipes.
- `release/installer/install-te2` and `install_te2.py`: stateless acquisition,
  platform detection, prerequisites, verified payload, atomic activation,
  fallback, rollback, uninstall and settings preservation.

Do not assume Electron's transport equals the proposed helper protocol. Its
current startup combines a control hello with HTTP health discovery. Define
the adapter deliberately; preserve TE2 worker pipe-readiness contracts.

Prerequisite gates:

- Validate final merged manifest/signature and actual installed UID against the
  chosen Termux distribution. The current Cefrium source places sharedUserId
  on application, whereas the proposal requires the root manifest attribute;
  source presence alone is not proof of shared-UID installation.
- Confirm the supported Termux execution-service interface, permissions,
  external-app policy, environment, argument quoting and result reporting.
  No existing launch adapter was found in the initial inspected client paths.
- Prove private local IPC access/SELinux behavior on both devices. Shared UID
  and a public distribution signing key are not session authentication.

## Phase 1: independent repo and executable sample

### Investigated contract baseline (2026-10-06)

Reference revisions: TE2 `7d051e4c95e0e75ddb6ea6238dd93bcdcb671953`,
Termux:Tasker `dbf685fe2973c3490a27cbd37f31909ad5eb3bb3`, Termux app
`8629e632fcb95da272221be327db653fb24befe9`. These are investigation pins,
not yet selected SDK compatibility versions.

**Identity.** Tasker and Termux declare sharedUserId on the root manifest.
The prototype must use `com.termux` there, a distinct applicationId and the
GitHub-Termux-compatible certificate. Current TE2 Cefrium instead configures
`sharedUserIdValue=com.termux.extensions.cefrium` and its own development
keystore; it is not proof of this relationship. Do not change an installed
TE2 package's UID/signature in place: use the independent sample package first.
Check merged manifest, certificate and installed UID, with compatible Termux
already initialized. Android deprecates shared UID, and a sharedUserMaxSdkVersion
cutoff can prevent sharing on newer fresh installs; do not add one mechanically
to a prototype that requires sharing. Device acceptance decides feasibility.
The public GitHub test key is compatibility identity, not a trusted publisher
or protection against another application deliberately joining that UID.

**Execution.** Prefer the Tasker-style direct, explicit TermuxService adapter
for the shared-UID prototype. Its FireReceiver creates ACTION_SERVICE_EXECUTE
with an executable URI and argument array, working directory, stdin and
background app-shell runner; PluginUtils starts the service and can attach a
PendingIntent for command completion. TermuxService is non-exported; actual
shared UID and Android lifecycle eligibility must be proven. Electromux does
not need Tasker's Locale receiver/plugin-host machinery. Pin termux-shared
constants or a tested narrow adapter; do not infer compatibility from names.

The public RunCommandService is a different adapter, not a silent fallback:
it requires RUN_COMMAND permission and allow-external-apps, plus package
visibility handling at modern target SDKs. Tasker's restrictions on callers and
script paths belong to its own policy layer; copying direct service execution
does not reproduce those protections automatically. Electromux must enforce
its own configured-command allowlist and reject arbitrary page-supplied commands.

**Bootstrap versus streaming.** Invoke a small helper with an absolute executable,
argv array and explicit working directory, without shell concatenation. Use
background app-shell execution, not a PTY for binary protocol. PendingIntent
reports command exit, not ongoing readiness or a full-duplex stream. Keep
ongoing handshake/events on helper IPC and keep diagnostic output bounded.
Source builds/install operations are their own progress phase and must finish
before launch; do not let a short readiness timer cancel a valid long build.
Consumer install recipes reuse their existing installer, verified artifacts,
activation and rollback; Electromux does not hard-code pip/TE2 or silently apt
install packages. Install/update/uninstall require explicit user intent.

**IPC proposal.** Use a short filesystem Unix socket path beneath the configured
Termux private runtime root, consumer/session scoped. The sample helper binds
the endpoint and the host connects after launch; this avoids assuming the
named LocalServerSocket constructor creates a filesystem socket (it creates
an abstract-namespace socket). Android LocalSocket supports explicit namespace
selection and peer credentials. Test interoperability with a Termux AF_UNIX
listener, access/SELinux, permissions, stale endpoint handling and reconnect.
No TCP fallback is automatic. Session credentials reject accidental/stale
connections but cannot isolate mutually hostile processes sharing the UID.

Separate bounded host-control frames from consumer payloads. The sample can use
length-prefixed JSON for its small control protocol; TE2 adapters must preserve
existing MessagePack payloads and its distinct stdin/FD3 bootstrap control.
Specify frame ceilings, backpressure, correlation, stream ownership and no
uncertain mutation replay before implementing. Credentials never enter page
URLs, logs or untrusted frames.

**Remaining proof.** Source establishes the intended interfaces, not device
acceptance. Both devices still need compatible-signature/UID installation,
explicit service start, helper connection, background lifecycle and orderly
exit tests. No shared runtime or Termux setting was changed by this investigation.

Primary references:

- [Pinned Tasker execution source](https://github.com/termux/termux-tasker/blob/dbf685fe2973c3490a27cbd37f31909ad5eb3bb3/app/src/main/java/com/termux/tasker/FireReceiver.java)
- [Pinned Tasker launch/result adapter](https://github.com/termux/termux-tasker/blob/dbf685fe2973c3490a27cbd37f31909ad5eb3bb3/app/src/main/java/com/termux/tasker/utils/PluginUtils.java)
- [Pinned Termux service manifest](https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/app/src/main/AndroidManifest.xml)
- [Public RUN_COMMAND interface](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent)
- [Termux signing families](https://github.com/termux/termux-app#installation)
- [Android shared UID contract](https://developer.android.com/guide/topics/manifest/manifest-element#uid)
- [Android LocalSocket](https://developer.android.com/reference/android/net/LocalSocket)
- [Android LocalServerSocket](https://developer.android.com/reference/android/net/LocalServerSocket)

Repository creation/location and any upstream publication need explicit approval.
Prototype minimal host/core, Cefrium adapter, Termux helper, sample assets and
a tiny backend with no TE2 imports. Define versioned bounded requests,
responses/events, session identity, source routing, cancellation/disconnect
semantics and stderr diagnostics. Keep consumer payload codecs adaptable;
do not force TE2's existing MessagePack through a second JSON conversion.

Sample proves bundled page loading, launch/attach/status/stop/detach, a request
and reply, unsolicited event, reconnect and incremental UI updates without
document recreation. Separate launch acceptance, process existence and semantic
readiness. Repeated starts must not duplicate a live owned backend. Remote or
external sessions must not require local installation or be stopped by UI exit.

## Phase 2: automated tests

- Protocol: partial frames, size limits, malformed/version-incompatible input,
  correlation, wrong session/consumer, late replies and disconnect cancellation.
- Lifecycle: cold launch, already-running attach, duplicate start, readiness
  timeout, helper death, backend exit, detach/reconnect and ownership-scoped stop.
- Browser: local asset provenance/missing assets, bridge allowlist/identity,
  untrusted frame rejection, recreation and renderer recovery.
- Install contract: arbitrary working directory, missing prerequisites,
  verified acquisition, install/reinstall/upgrade, failed activation rollback,
  one fallback, uninstall preserving user state, managed files only.
- Adapter parity: reuse current Electron/Cefrium tests as references; add
  consumer-adapter regressions rather than importing TE2 into sample core.

Native libraries are test fixtures only when they genuinely exercise the same
contract; import-only or mocked tests cannot establish device execution.

## Phase 3: physical acceptance

Under explicit device/build/install approval, use Motorola and Pixel with a
compatible Termux signing family. Do not wipe user state without approval.
Verify APK manifest/certificate, actual UID, helper IPC and installed assets.
Run the installer in an ordinary on-device Termux session as well as automation;
record ADB/SSH preload/environment differences instead of masking exit failures.

Exercise fresh install, existing install, backend already running, source-build
wait, unavailable Termux, permission refusal, owned stop versus external detach,
screen lock/background, activity/renderer recreation and reconnect. Measure
click-to-text separately from backend readiness. Record exact artifacts/logs
and distinguish automated checks from user live acceptance.

## Phase 4: additional TE2 host integration

After sample acceptance, add pinned Electromux to TE2 through approved submodule
or library integration in a separate Android app/build target with its own
application ID and compatible signing. Do not replace the existing Cefrium
target or change its installed UID/signature. TE2 supplies assets/configuration, local launch/install
adapters, remote endpoint handling and consumer-specific bridge operations.
Keep TE2 framework worker orchestration and authoritative state unchanged.
Preserve existing remote connections, OTA, origin/identity, downloads, sidebar,
IME and CDP contracts; do not confuse server builds with installed client assets.

Validate both local Termux hosting and remote TE2 access; compare Electron
launch/install ownership behavior without making Electron depend on Electromux.
Existing Cefrium and GeckoView clients remain intact; any shared-source changes
require explicit scope and regression coverage for those clients. Include
side-by-side installation and independent settings/lifecycle acceptance.

## Desktop-parity POC direction (2026-10-06)

The independent repo's `docs/DESKTOP_API_INVENTORY.md` records the source-backed
21 launcher commands, 28 app-view commands, event/dialog boundaries and actual
portable-source candidates. The first approved implementation adds native-owned
consumer descriptors and a guarded request/reply/event foundation to the
independent sample only. Events currently accompany replies; unsolicited native
streaming, stable-origin hosting and actual Desktop-source integration remain
later gates. Existing TE2 runtime/clients are unchanged; no APK/device or
publication acceptance follows from synthetic tests.

This approved direction supersedes a sample-only/extraction-first sequence.
The independent sample's Pixel IPC acceptance provides the foundation; next
build a working TE2 Termux POC using TE2 Desktop as the design/API language,
then stabilize/extract the reusable SDK. Electromux means a Termux application
host for Android: Termux is the execution environment, not an optional generic
Linux provider. Cefrium remains its rendering engine.

The target is one-to-one TE2 Desktop application functionality with explicit
Android platform equivalents, not compatibility with every Electron API.
Prefer actual portable JS/TS reuse over separately reimplementing behavior.
Keep Electron's current behavior and existing Android clients unchanged while
proving the new consumer. No literal whole-Activity or whole-main-process copy.

### Source-backed reuse map

| Reference | Planned reuse / boundary |
| --- | --- |
| `desktop_client/electron/src/shared/contracts.ts`, shell preload | Promise request/reply and subscribable events; platform adapter replaces Electron IPC. TE2-specific method names remain in the consumer. |
| `desktop_client/android_shell/host.js`, launcher/settings | Reuse browser-compatible code/assets after isolating bridge/global assumptions. This directory is Electron-owned despite its name; do not confuse it with `app/android_shell`. |
| `local-framework-controller.ts`, `local-framework-config.ts`, tests | Preserve ownership/state-machine/configuration semantics and translate Node process/FD adapters to the Termux helper. Extract pure policies for actual TS reuse where practical. |
| `preferred-app-startup.ts`, startup tests | Preserve ordered local launch then preferred-app preparation, parallel renderer load, already-running attach and failure escape paths. |
| Android `PersistentNetworkService`, relay, settings/assets, Cefrium page policy | Reuse proven Android lifecycle and remote/local relay behavior behind the new consumer/host boundary. Activity does not become the transport owner. |
| Existing Cefrium resources and TE2 client bundles | Feed packaged assets into Electromux hosting APIs; keep OTA/inventory/version authority and framework-to-relay URL rewriting. |

Desktop main-process imports such as Electron and `node:child_process` are not
browser-portable. A JavaScript engine does not itself implement Electron or Node
APIs. Do not add `androidx.javascriptengine` merely for nominal API completeness;
first identify a specific reusable headless-JS workload and missing execution
capability. Keep its selection behind a measured implementation gate.

### Host versus consumer

Electromux provides configurable branding (application ID, label, icon/splash),
bundled entrypoints, explicit local asset/custom route mappings, guarded bridge
registration, process configuration/ownership, readiness, request/event transport
and lifecycle. Route access and bridge capability are separate permissions:
serving a route or navigating a remote page does not grant native execution.
Reject traversal, undeclared resources and untrusted callers; credentials remain
native/helper-owned. Public signatures/shared UID are compatibility, not sandboxing.

TE2 provides framework commands/configuration, dependency installer recipes,
health/app-catalog adapters, bookmarks/preferences, OTA policy and TE2-specific
native methods. Reuse existing logic; generic Electromux must neither import TE2
nor know its app IDs/endpoints. A second differently branded non-TE2 consumer
must eventually prove these boundaries are reusable, without premature extraction.

### Local and remote are one client model

Selected framework endpoint and owned local backend are distinct state. Remote
connection must work with local installation/autostart disabled. An existing
local framework is external unless this host actually launched/owns it; observing
an endpoint never grants shutdown authority. Switching endpoints retargets the
existing relay and reconciles connected surfaces without spawning a second
control architecture. Closing the app stops only its owned local framework;
remote/external frameworks stay alive. Preserve existing TE2 stdio/FD3 bootstrap
control and worker pipe readiness rather than replacing them with the sample's
ping/ready protocol. Installer/source-build completion precedes launch readiness.

### Coherent implementation sequence and gates

1. Define configurable consumer descriptor and narrow platform bridge/event
   contract. Inventory each desktop method/event as shared, Android-adapted or
   explicitly platform-specific; preserve response shapes and disposal semantics.
2. Build the new branded TE2 Termux target with packaged Cefrium/TE2 resources,
   reusable launcher/settings logic and existing Android remote relay. Prove
   remote-only operation before introducing framework launch ownership.
3. Adapt local framework configuration/start/attach/stop through the owned
   Termux helper, including existing stdio-control/FD3 readiness, logs, source
   build waits and installer progress. Share the desktop state-machine tests.
4. Add automatic local launch/preferred app, early UI load, settings/bookmarks,
   OTA, navigation, dialogs, downloads, sidebar/secondary surfaces and debugging
   parity. Keep one launch/connection model; publish a per-feature parity matrix.
5. Validate Pixel and Motorola: remote-only, owned local, already-running
   external, failed/long build, endpoint switch, background/recreation/reconnect,
   renderer recovery and exit ownership. Never infer parity from compilation.
6. Publish a working POC only under separate approval; afterward extract stable
   host APIs/library/plugin and prove custom branding/routes with another consumer.

The initial direction approval covered documentation only. Subsequent explicit
first-slice approval covers the independent consumer descriptor, guarded bridge,
sample wiring and targeted synthetic/compilation tests. It does not authorize
APK assembly/device changes, TE2 runtime changes, commits/tags/publication or
automatic merges. Request separate approval for the TE2 consumer target.

## Actual Desktop host reuse seam (2026-10-06)

Separately approved source/test slice: `desktop_client/android_shell/host.js`
accepts an injected `__te2ShellPlatform` request/event/navigation adapter before
its existing Electron/WebKit paths. Existing Electron paths remain the default;
pagehide unsubscribes the injected local-framework-state listener.
`electromux-platform.js` is TE2 consumer code mapping the Desktop methods onto
the existing Android gateway DTOs/routes. It creates no network client or relay;
native bootstrap must supply gateway request, current browser origin and trusted
navigation. Gateway request returns `body.data` exactly once. Native authorization
remains mandatory; injection is not a security boundary.

Remote catalog/settings/bookmarks/open/quit/reload routes reuse the existing
gateway. Local execution/startup and asset update actions explicitly remain
unsupported, rather than silently claiming persistence or completion. This is
not wired into an installed client yet; no new APK target or asset publication.
The actual Desktop host import regression and all 113 Electron tests pass.
Next gate is a separately approved branded remote-only target/bootstrap that
provides the real native adapter and visibly disables unsupported controls.

## Separate TE2 Termux native consumer checkpoint (2026-10-06)

Approved source/compilation slice: `android/termux` selects the actual standalone
Cefrium build definition with a distinct app ID `com.termux.extensions.te2termux`
and label TE2 Termux. Both targets compile the same Cefrium activity/application
and shared Android service/bridge source. BuildConfig gates the new consumer;
existing Cefrium and Gecko entrypoints remain unchanged. Termux package renderer
classification explicitly remains Cefrium. No activity copy or second relay.

Generated APK-owned `electromux_shell/` resources are copied from the actual
Desktop launcher/settings source; only generated HTML selects the remote consumer
bootstrap. The native handler uses an exact `/android-shell/` asset allowlist and
returns local errors for missing/unlisted resources before the OTA tree. Editor
resources retain their existing seed/OTA path. This prevents editor OTA from
overwriting the consumer bootstrap with the older Android launcher.

The consumer uses the existing gateway for endpoints/bookmarks/catalog/app
actions; unavailable local/startup/update settings are visibly disabled and
mutations rejected. The eventual goal remains full local launch/configuration,
environment/venv, ownership/stdin-FD3 shutdown, automatic/preferred startup,
sidebar preference and second-editor parity. Native desktop window detachment is
the exception. No local backend is launched by this interim target. Generic
Electromux helper/library extraction is not complete merely because this consumer
target compiles; integrated POC first remains the approved sequencing.

Target compilation/9 JVM tests, original Cefrium compilation/58 JVM tests,
113 Electron regressions and both browser adapter/bootstrap tests pass. Merged
debug manifest confirms distinct identity/shared UID/private runtime/provider;
signer/installed UID, actual remote navigation, sidebar/second-editor persistence
and lifecycle still require separately approved signed APK/both-device testing.
No APK assembly/install or shared runtime restart occurred. See
`android/termux/README.md` and `NATIVE_TARGET_SECURITY.md`.

## Local-control backend foundation (approved 2026-10-06)

The actual Desktop controller/config code uses Node built-ins, not Electron.
Reuse it in `desktop_client/electromux/local-framework-backend.ts`, bundled as a
TE2-owned Node actor; Termux already supplies Node. Electromux remains generic:
its authenticated helper starts a native-declared framed backend using private
`--backend-config` argv/cwd/env, not TE2 endpoints, commands or module imports.
Sample-default behavior remains independent. No page-selected arbitrary executable.

Preserve TE2's stdin/FD3 control; ordinary logs are not protocol frames. Separate
control-actor readiness from framework readiness. Start acknowledges asynchronously,
build-only preparation precedes the bounded hello timer, and the endpoint is
rechecked after a long build before claiming ownership. No automatic mutation
retry. Existing/external frameworks are never stopped. Consumer shutdown must
have time to reap its owned child before generic-helper escalation (20s declared
for this actor). Shared framework is not touched by synthetic fixture tests.

Next integration gate: expose host-neutral ownership vocabulary, native-declared
consumer config/provisioning, authenticated native bridge methods, unsolicited
state delivery, persistent service lifecycle and selected-relay endpoint sync.
Keep automatic startup/preferred app, installer execution, decorators and new
APK/device testing outside this first backend slice. Do not present tested
standalone control logic as an already-wired Android launch feature.

## Asynchronous state transport prerequisite

Before Android service/UI integration, the generic helper separates replies
from unsolicited backend events with one reader. Authenticated clients explicitly
opt in using `events: true` in hello; request-only clients remain compatible.
Events have a bounded nonempty name and no request ID. One per-connection writer
serializes replies/events with a 16-frame queue; overflow disconnects the slow
client, not the backend. Disconnected events are discarded, not replayed.
Reconnect must retrieve current authoritative state. Partial frames and reply
waits remain bounded; idle backend output does not trigger a timeout.

The TE2 actor emits `local-framework-state` with `data` carrying the existing
state DTO, coalescing to the newest state under stdout backpressure. Lifecycle
tests await these events, not poll. This does not yet enable event consumption
in Kotlin or grant execution authority to any web page. Next slice upgrades the
native socket client and service ownership, then binds the exact APK-owned
launcher/settings pages; a loopback origin alone is insufficient because
remote framework pages share it. No Android source/device mutation in this slice.

## Electron-subset portability acceptance

Electromux targets a useful Electron-compatible subset for Termux apps, not all
Electron APIs and not conversion of TE2 into the generic host. After the TE2 POC,
accept an unrelated small Electron application supplied by the user and prove
an almost-drop-in build/runtime workflow. Keep supported contracts familiar,
unsupported operations explicit, and record any required application edits.
Until this passes, Electron compatibility is a goal rather than an established
capability. Future transparent FS/process adapters may use the shared-UID Termux
root `/data/data/com.termux/files/`; implementing them is separately scoped.

## Historical initial slice boundaries

### TE2 local integration prerequisite (2026-10-07)

Read-only integration inventory confirms PersistentNetworkService already owns
relay, UI IPC and runtime observers; Desktop's packaged consumer shell already
has an injected platform request/event seam. Do not add another TE2 service or
grant launch authority through AndroidShellGateway's broad same-origin HTTP API.
The exact APK-owned launcher/settings document must be authorized separately
from remote pages served under the same relay origin.

The approved prerequisite packages independent Electromux generic Kotlin
host/Termux transport into an internal `android/host` library and makes its sample
consume it. Generic assets accompany the AAR; sample diagnostics/browser/service
and ping policy stay in the consumer. This is a build boundary, not public SDK
stabilization. Next: checkpoint/pin a reproducible source or artifact dependency,
then adapt TE2's service to own the host runtime and TE2's Node actor. Never use
an absolute sibling-checkout dependency or copy sample classes into TE2.

Before local execution integration, adapt the consumer bridge with exact
APK-owned page/document/method checks (the generic descriptor now admits a
native-declared exact loopback document URL), native event
delivery and selected-endpoint synchronization into the existing Android settings/
relay authority. The actor currently tracks selectedOrigin internally, so it needs
an explicit native-consumer synchronization contract; refreshing its state alone
must not silently retarget a remote connection. Source-build preparation already
returns promptly and publishes completion events. Auto-start/preferred app and
exit/shutdown ownership remain subsequent parity gates; no device/runtime mutation
is implied by this prerequisite.

Current source checkpoint: the independent sample has generic native helper
provisioning and a private started/bound non-sticky service. RuntimeOwner owns the
bounded request lane and renderer subscriptions; Activity/page close only
detaches its observer. Android service destruction disconnects client resources
but does not stop the retained Termux helper/backend. No background survival or
automatic relaunch guarantee. The next integration boundary is TE2's existing
PersistentNetworkService/relay plus exact native consumer page/config authority;
do not add a second TE2 process lifecycle or claim sample tests as installed
client acceptance. Device recreation/reconnect validation remains a separate gate.

The reusable host source is pushed at Electromux `d45788b` and pinned in TE2's
`vendor/electromux` Git submodule. Only the TE2 Termux Gradle target consumes
`:electromux-host`; neither neighboring checkouts nor copied sample classes are
build dependencies. The subsequent source slice now wires manual local control;
installed acceptance remains separate.

## Manual local-control implementation and next acceptance gate

### Launcher state handoff follow-up

Pixel reproduced a stale Starting card while the exact actor-owned bootstrap and
server were already healthy; navigating to Settings and back recovered Running.
This is not a missing executable or a failed framework start. The actor now
stamps snapshots with a process-session identity and monotonic revision; the
Termux platform orders both replies and events so a late Start acknowledgement
cannot roll back a newer Running event. Reconciliation is a single-flight,
read-only actor-state request after native page-load completion and visible
page activation (pageshow/focus/visibility). It never repeats a mutation, polls,
discovers processes or changes ownership. Native exact-document authorization
and generation fences remain intact.

Rebuilding/installing an APK does not replace a retained running helper/actor.
Existing actors without revision fields remain readable; revision-ordering live
acceptance requires a newly started actor. Do not stop an existing framework
merely to refresh this actor without explicit lifecycle approval.

TE2 Termux installs an optional PersistentNetworkService-owned runtime backed by
the pinned host's native Termux client/provisioner. It packages the real Desktop
controller as a Node actor and uses the real launcher/settings browser modules.
Only the two exact APK-owned loopback documents have the seven local-control
methods; remote app pages sharing that origin cannot execute them. Navigation
fences queued replies/events and detaches the page observer, not the transport.
Service destruction disconnects without Stop/Shutdown or uncertain relaunch.

Native settings/relay retain selected endpoint authority. Actor observation and
explicit local selection are different facts: only Start/Use advances selection
revision; a native single-use fence requires its initiating upstream to still
be selected before relay retarget. Backend state projects actual native selection
to pages. Launcher configuration uses a separate consumer config directory while
framework children retain their existing environment/config/data roots.

Source validation includes exact-document/method rejection, selection replay and
retained-actor fences, real-process external ownership/build preparation/cleanup,
configuration isolation, actual browser bootstrap/disposal and all three Android
target compilation comparisons. This does not prove Cefrium callback order or
physical process/background survival.

Next approved-work boundary requires APK assembly/install approval: package this
seed, verify UID/signature/assets, then test manual config save, existing-framework
attach, owned start/build wait, Stop, remote changes during startup, navigation,
Activity recreation, service destruction and explicit reconnect without replay.
Preserve external/remote frameworks and existing Termux user data. Automatic
startup/preferred-app and owned-process exit behavior remain subsequent slices.

This slice creates a local branch and planning documents only. No SDK/helper,
Android source edits, APK builds, device changes, shared runtime restarts,
separate repo creation, tags or publication are authorized by it.
