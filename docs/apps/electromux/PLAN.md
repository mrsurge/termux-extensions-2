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

## Historical initial slice boundaries

This slice creates a local branch and planning documents only. No SDK/helper,
Android source edits, APK builds, device changes, shared runtime restarts,
separate repo creation, tags or publication are authorized by it.
