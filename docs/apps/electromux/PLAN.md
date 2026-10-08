# Electromux host plan

## Android input / DevTools parity (2026-10-08)

TE2 Termux exposes the existing `imeContextSwitchingEnabled`,
`devToolsRunProfilesEnabled` and `devToolsDebugEnabled` settings as immediate-save
checkboxes, alongside keep-alive. Defaults and persistence remain owned by
AndroidAppSettingsStore. The exact packaged-page save method validates nonempty
patches containing only those four real boolean keys; no endpoint or arbitrary
setting is admitted through this lane.

PersistentNetworkService already applies IME updates. Its changed DevTools flags
now notify runtime observers; the Termux Activity alone consumes that notification
to reconfigure the existing Cefrium Inspector. Do not call recursive applySettings,
reload the page, reconnect the framework, or add another Inspector transport.
Existing Cefrium's HTTP settings callback remains unchanged. All additions are
TE2 consumer behavior, not reusable Electromux core. Source/JVM/build validation
and APK deployment evidence versus user live acceptance are tracked separately.

## TE2 consumer installer slice (2026-10-08)

This is TE2 application policy, not reusable Electromux functionality. The
adapter in `desktop_client/electromux/` belongs to this TE2 repository; the
independent `vendor/electromux` runtime remains framework-agnostic and unchanged
by this slice. Generic owned-child/output primitives are reused, not duplicated.

The native Termux lane alone enables installation. A missing PATH executable
with no manual command, venv, configuration error or active lifecycle operation
offers Install in the launcher and Settings local-framework card. Installation
requires a second explicit confirmation. The renderer cannot provide a download
URL, executable or arguments: the consumer downloads the fixed GitHub latest
`install-te2` asset and invokes Termux's absolute `sh` with `--yes`.

Download is bounded to 2MiB/60s. One detached owned installer process group has
backpressured stdout/stderr and a retained latest 2KiB progress line. Cancel
aborts download or SIGTERMs that group, escalating after 2s; it warns that partial
changes may remain and does not promise rollback. Disposal cancels the owned
installer. Authoritative exit plus fresh executable discovery determines success;
zero exit without TE2 remains an error. Success does not start the framework or
change the selected remote endpoint. The published installer needs no new flags
or TE2 release; optional structured installer signals remain future work.

Validation: strict actor TypeScript check/bundle; 30 actor/browser/installer
regressions; integrated Termux and embedded runtime JVM tests/Kotlin compile pass.
Fixtures exercise success, nonzero exit, missing executable, download/child
cancellation, bounded output, manual/native eligibility and explicit UI consent.
No real download/install, APK deployment, framework restart or publication was
performed. Actual installation and device UI acceptance remain the next gate.

Follow-up: the debug APK was built and installed in place on Razr with storage
preserved. User live acceptance passed both after removing TE2 from an existing
Termux userspace and on a fresh cold Termux userspace with no preinstalled
dependencies. Installer UI and fresh bootstrap/install success are accepted;
real-device failure/cancellation coverage remains separate. Exact APK checksum
and deployment evidence are retained in TRACKER.md.

## Isolated embedded consumer integration (2026-10-08)

Accepted pushed checkpoint: TE2 `b41c05a8`, Electromux `396e935`.
Approved scope is service/Binder integration, TE2 Termux build wiring and
regression/build validation; no APK installation or shared framework stop.

Generic Electromux `EmbeddedNodeService` and `EmbeddedNodeClient` now bridge
declared consumer methods/events over internal AIDL. The service checks caller
UID on every transaction, rejects concurrent requests, caps payloads at 64KiB
and observers at 16. Entry and execution lane come from the compiled native
declaration, never Intent extras. The retained process engine/failure cannot be
retargeted, is not closed on page detach/Service recreation, and is created only
by an explicit request. Disconnect fails the client without mutation replay.
Shared-UID packages remain a common trust domain, not mutual isolation.

TE2's private `TermuxNodeService` runs in `:electromux_node`, independently of
Cefrium; the shared Application skips Chromium command-line/consumer registration
in that process. Installed Termux UID/signature is checked before execution.
PersistentNetworkService's existing runtime adapter now uses this client instead
of Python-helper provisioning or an external Node executable. Android settings,
exact document authorization, revision/selection fences and Desktop controller
ownership are unchanged. The TE2 Python application dependency is not removed.

Only TE2 Termux includes the Node module. Its build tracks nested TS inputs,
packages the embedded TE2 entry under `embedded_node/te2.mjs`, and removes obsolete
generated external-Node assets. The reusable runtime depends on the host transport
library rather than duplicating classes. Cefrium 0.9.0's AAR has no competing
libc++_shared.so; the integrated package uses the NDK runtime with libnode.

Next gate: approved in-place install on Razr, without clearing storage or stopping
the framework. Verify cold Node boot, local/remote settings and selection, owned
start/stop/Cancel, long source-build output, page detach/reopen and retained engine,
external-framework preservation and late-document fencing. Then inspect service
PID separation/native memory and explicit process-death recovery. Packaging and
host regression checks do not establish these device/lifecycle claims. Installer
integration remains later; final license/notice redistribution is still a gate.

Validation: runtime strict typecheck/build and 24 Node tests; TE2 strict actor
typecheck and 15 actor/browser tests; integrated Termux JVM tests/debug assembly;
16 runtime JVM tests (including checked-exception-to-error/no-retry coverage),
independent proof JVM tests, and ordinary Cefrium compile/JVM tests without a
Node SDK configured all pass. APK entry checksum matches embedded-entry.mjs;
libnode, JNI shim and libc++ are present, obsolete external-Node entry absent.
APK is roughly 343MiB (debug, not a release artifact). Security alignment report
with exact source diffs is retained in
`.codex-scratch/electromux-node-service/security-alignment.md`.
Final debug APK: `android/termux/build/outputs/apk/debug/te2-termux-debug.apk`,
SHA-256 `6428d3e2c9a2fdb6e0e2aab7acd0866c77fe48472e5ebe6daea7fee13fe49459`.
It carries the explicit public Termux GitHub test signer (certificate SHA-256
`b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1`).
JVM totals: 26 Termux, 16 runtime, 2 proof and 58 ordinary Cefrium, zero failures.

Approved Razr installation completed in place, preserving app storage. Observed
UI PID 26331 and embedded Node service PID 26413, with successful JNI loading
and the selected entry materialized under private no_backup storage. Framework
PID 16864 survived installation and opening unchanged. Saved automatic startup
observed/connected to local and opened Code TE2; no manual Start/Stop was invoked.
Legacy helper/actor processes were deliberately left alive. One RunTargetProjection
timeout appeared in the UI log; no Node startup error/crash was observed. This
does not establish owned start/stop, remote switching or broad lifecycle acceptance;
the installed build is ready for the user's live validation.

User follow-up: killed the previous run and restarted; reported the new build
working. Record local restart/live acceptance, not proof of all remote, Cancel,
background or process-death recovery cases.

User subsequently confirmed Cancel and lifecycle behavior working properly.
Those user live-acceptance gates pass; remote switching remains open. No separate
instrumented crash/process-death recovery claim follows from this confirmation.

User confirmed remote switching working and approved commit/push. Local restart,
Cancel, lifecycle and remote switching are live accepted for this APK/source slice.

## Embedded Node / TypeScript runtime direction (2026-10-08)

### Independent ARM64 proof checkpoint

#### Embedded consumer-host foundation

##### Long-lived lifecycle/event follow-up

###### Child streaming/policy follow-up

Source inspection confirms TE2's existing LocalFrameworkController already owns
its child group, stdout/stderr log forwarding, FD3 control hello, health proof
and graceful stdin shutdown/escalation. Preserve this controller during actor
migration; do not wrap it in a second lifecycle owner or substitute the sample's
text readiness token for TE2's real protocol.

OwnedService now accepts native consumer-selected readiness/stop policy:
readinessMs=null explicitly allows a cancellable build wait. OutputPump streams
raw stdout/stderr bytes without a lifetime-output cap, with at most 16 queued
chunks of at most 64KiB, five-second sink completion deadlines and only 2KiB
retained tails per lane. Queue/sink failure terminates the owned child rather
than accumulating output. Explicit restart creates a fresh output pump; no
automatic restart/replay. Readiness retains a separate 64KiB bound.

The independent Termux proof selects indefinite readiness, 1s stop grace and a
declared child.output event. Strict checks/bundle and 23 Node tests pass, including
409600-byte streaming, bounded tails, slow-sink/queue rejection, >8KiB real-child
output, explicit restart and cancellation before hello. Android JVM checks and
assembly pass. Razr updated in place: PID 24668 remained ready across Status,
then Stop emitted child.state/SIGTERM and /proc confirmed removal. Log streaming
is covered by host regressions; the diagnostic UI retains only its latest event,
so this device test does not independently record every child.output event.
TE2 runtime and app data remain untouched.
Updated proof APK SHA-256:
`5ef1832fa091da7278fc335d95e916dbab307b42f3d74f7cb5bb20dc1c226ec0`.

Next slice: extract the existing TE2 actor policy into an importable consumer
factory while retaining its external stdio entrypoint, parameter/schema guards,
session/revision state, config authority and controller. Prove parity locally
before wiring the embedded engine into TE2's Android service/renderer.

###### TE2 actor consumer extraction

Checkpoint before extraction: TE2 e0eda55f, Electromux 4e82b58 (local only).
`desktop_client/electromux/local-framework-consumer.ts` now exports an explicit
factory with native-owned environment/event/log adapters; imports alone do not
read config, attach stdin/register signals or launch children. Methods/events,
session/revision ordering, config-root isolation, immediate Start acknowledgement,
selection intent and cancellation remain in this TE2 policy module. Dispatch
rejects concurrent/closed calls and clones DTO results; disposal is idempotent,
stops only owned children and suppresses later state publications.

The existing `local-framework-backend.ts` remains a thin executable adapter with
the same helper ready envelope, correlated replies and signal/EOF cleanup. Its
framing/writes now reuse pinned Electromux FrameDecoder/FrameWriter, with bounded
request batches (8) and outbound queue/deadlines rather than retained unbounded
input. Build emits both stdio executable and importable Node24 consumer bundle.
LocalFrameworkController remains sole TE2 child lifecycle/control authority.

Acceptance: strict actor and Electron typechecks/build, seven existing real-process
tests and five direct factory tests pass; the combined run also passes the browser
state-ordering/coalescing/disposal regression (13 reported tests). Direct tests cover import effects,
config DTO isolation, config/child-root separation, owned launch/revision state,
source cancellation, endpoint guards, unknown methods, idempotent disposal and
external-framework preservation. These are isolated fixture processes, not live
TE2 restarts. No Android build/install, framework restart, asset OTA or runtime
replacement belongs to this extraction. Next integration must add typed request
parameters to the embedded host and preserve exact native document/consumer
authorization before selecting this factory in TE2 Termux.

###### Typed embedded API and native selection seam

The generic private-FD runtime is now `runtime-host.ts`, supplied a compiled
consumer factory by its entrypoint. Proof-only methods/completion events remain
in the proof entry/consumer, not generic routing. Requests accept optional JSON
object params, validated/copied with 64KiB byte, 4096-node and 32-level shape
bounds; method syntax is generic, while consumer declarations authorize dispatch.
Direct host calls also validate/copy params before asynchronous dispatch.

Native `EmbeddedConsumerSpec` declares a literal packaged embedded_node/*.mjs
entry and copied unmodifiable method/event sets; traversal/remote paths and
consumer declaration of runtime.ready are rejected. EmbeddedNodeRuntime uses
that asset and those allowlists, copies JSONObject params and retains existing
ready framing, process lifetime and event transport. This declaration grants no
renderer authority: the existing exact-page/presentation gate remains necessary.
Retained engines must never be retargeted to a different consumer in-process.

TE2 build now also emits embedded-entry.mjs, using its imported consumer and
explicit Termux child/config environment in native Termux mode. Private-FD host
fixture tests verify typed endpoint params, proof-method rejection, real owned
launch/state, graceful cleanup and build cancellation on disconnect. This is
host-side integration evidence, not ARM64 embedded TE2/Cefrium acceptance.
No active TE2 Android adapter, APK seed, installed client or shared framework
was changed. The next slice must wire package assets/build inputs and service
ownership into TE2 Termux while preserving native selection/document fences and
explicitly dealing with a retained old helper/actor; no automatic uncertain
launch or externally-owned framework shutdown is permitted.
Validation: strict runtime/actor typechecks and bundles, 24 runtime Node tests,
15 combined TE2 process/factory/browser-state regressions and native runtime/proof
JVM checks all pass. No APK assembly/install or device mutation was performed.

Approved follow-up adds TS `OwnedService` semantic FD3 readiness, explicit
status/stop, startup-failure reporting, bounded output and owned-group cleanup;
no automatic restart. Start returns at readiness rather than at child exit.
Consumer events are explicitly declared and fenced against pre-initialization
and closed owners. Replies/events share `FrameWriter` (16 pending frames,
five-second write deadline); overload is terminal, with no event history/replay.
The existing native transport explicitly accepts `child.state`. Sample Start /
Status / Stop buttons remain fixed native methods, not arbitrary execution.

Strict typecheck/bundle and 19 Node tests pass, including natural unsolicited
exit, disposal during startup, event rejection and slow-writer bounds. Android
runtime/ordinary/Termux JVM tasks and independent Termux APK assembly pass.
Installed only this proof on Razr without clearing app data: PID 23996 returned
ready, remained ready across a separate Status call, then explicit Stop returned
SIGTERM/exited plus child.state; /proc confirmed the PID gone. This is diagnostic
acceptance, not TE2 actor/Cefrium integration acceptance. The current service
has proof-sized limits (3s readiness, 8KiB cumulative output, 250ms stop grace);
production consumer policy/streaming must be designed before TE2 migration.
Activity detach and native process-owned engine behavior remain unchanged.
APK SHA-256:
`bbcbeb04071a5a196ed2a1d3791e0d0134aec4a8a417aff7d872c07370c27a78`.

The native-selected compiled proof factory now runs through reusable TS
`ConsumerHost`: single initialization with retained failure, declared-method
dispatch, concurrent-call rejection, closed-owner result fencing and idempotent
disposal. Readiness follows consumer initialization. `OwnedChildSupervisor`
owns one child operation, rejects overlap/reuse after disposal, and aborts/joins
its runner. The proof runner retains exact process-group ownership, bounded
stdio/FD3 and a deadline. Channel loss disposes the consumer; Activity observer
detach does not close the process-owned engine. Frame writes have a five-second
completion deadline; replies/events stay serialized on the private FD lane.

This is a foundation, not complete Python-helper migration or an Electron
child_process implementation. Diagnostic wire methods/events and fixed Termux
policy remain sample-specific. Long-lived semantic-ready children, consumer
events, Cefrium document authorization and the existing TE2 actor still require
integration gates. No renderer-controlled module paths/argv/environment or
automatic mutation replay were introduced.

Strict typecheck/bundle and 13 Node tests pass, including initialization failure,
undeclared/concurrent calls, late closed-owner results and real-child abort/join.
Android runtime/ordinary/Termux JVM tasks and Termux APK assembly pass. Installed
only the independent proof on Razr, preserving app data and TE2. APK SHA-256:
`7d361bba4a96ce3608086180877d5f5224d685cfc033066dd3dde3f3f769a78f`.
Device PID 23177 returned expected UID/HOME/PREFIX/TERM, exit 7 and FD3 readiness.
Cancellation PID 23363/descendant 23366 returned SIGTERM, groupGone=true and the
correlated sample.updated event; all three PIDs were absent afterward. This is
agent-observed diagnostic acceptance, not TE2 migration acceptance.

#### Separate Termux child execution proof

Checkpoint commits before this slice: Electromux `5d8bc28`, TE2 `1791a793`.
Approved implementation/install uses opt-in `:node-termux-proof`, independent
package `dev.mrsurge.electromux.nodeproof.termux`; ordinary proof and TE2 remain
unchanged on device. It reuses the same diagnostic source/build definition with
native-gated Termux methods, explicit signing and root `com.termux` shared UID.
Installed Termux APK certificate and configured public GitHub test certificate
were independently compared: SHA-256
`b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1`.
No keys or build environment files are committed.

APK SHA-256: `b9f6fae48394cbcc536b291d61a82724bfb4b07e38af35937dcd2a6a3b580c6d`.
Signature/root manifest/16 KB ZIP alignment verified; installed UID is 10517,
same as Termux. Razr API 36, proof target 34, observed process domain
`u:r:untrusted_app_27:s0:c5,c258,c512,c768`. This observation, not merely the
manifest, establishes the tested direct execution lane. Android execution
restrictions remain relevant elsewhere:
[Android 10 behavior changes](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission).

Embedded Node directly spawned fixed Termux Bash child PID 21918: UID 10517,
explicit Termux HOME/PREFIX/cwd, TERM=xterm-256color, separate stdout and stderr,
deliberate exit 7, exact `ready:21918` over inherited FD3, group gone afterward.
Cancellation proof shell 21955 spawned sleep 21957, published exact readiness
over FD3, then owned group SIGTERM completed with groupGone=true; all three
observed proof children were absent from /proc afterward. No TermuxService,
external Node/Python helper or framework launch was used. Commands are fixed,
not renderer supplied; output/deadline bounded, no automatic fallback/replay.
Host checks cover output overflow, missing readiness deadline, spawn failure,
unauthorized standalone methods, exit/stdio/FD3 and group cancellation.

Next concrete design gate: migrate generic supervision/consumer loading into
embedded TS without weakening ownership and protocol guarantees; then Cefrium
renderer/document lifecycle and C++ runtime coexistence, followed by TE2 actor
integration. Current TE2 runtime is not replaced by this execution proof.

#### Device lifecycle follow-up

User accepted Ping/filesystem and unsolicited events on Motorola Razr. Lifecycle
inspection then found Android had destroyed/recreated the Service but retained
its process: a second node::Start returned -1, and an unsupported checked Binder
exception appeared as a null reply. Approved fix uses a process-owned runtime
slot (including retained startup failure), with Services as reconnecting adapters;
onDestroy does not close/reinitialize the engine. Binder failures return explicit
error DTOs. No automatic engine restart, mutation replay or survival guarantee.

Fourteen JVM tests and APK assembly pass. Follow-up APK SHA-256:
`59b37cf72cc134713a8c692e28582ad04f8cc65e93fcd778a498b02374b0c10a`.
Installed in place, with 16 KB ZIP alignment passing. Device proof: Service absent
after explicit same-UID stop while engine PID 19624 remained; recreated Service
answered request 3 with that same PID/event. Explicit proof-package force-stop
and reopen produced PID 20117/request 1, without old request replay. TE2 apps,
framework and Termux state were untouched. This manual process-loss gate is not
automatic renderer/engine crash recovery. Termux child proof remains next.

Approved implementation is opt-in in `vendor/electromux`: `runtime/` strict TS,
`:node-runtime` JNI/Kotlin library and `:node-proof` standalone diagnostic app.
Use `-PelectromuxEmbeddedNodeProof=true`; the accepted TE2 host stays unchanged.
Commands, checksum lock and test strategy: `vendor/electromux/runtime/README.md`.
Node runs once in a private `:node` service process on a background thread, with
dedicated socketpair framing instead of app-process stdio. No Python helper assets
or TE2 imports. Ordinary debug signing; no shared UID or Cefrium renderer yet.

Full ARM64 v24.21.0-0 archive SHA-256:
`e3cd29a1be03405f11dd5c857af8cd3ad13f84f1409ea648f5328f0bada5bd76`.
Imported libnode SHA-256:
`955b308b1dfdf7662e8fe5ee4eb8c0c7d0a313f2d306387f2307529993c4bc32`.
Actual libnode is 87,657,320 bytes, depends on Android libc/libm/libdl/liblog and
libc++_shared, exports node::Start and has 16 KB ELF LOAD alignment. Headers need
C++20. Build uses NDK 28.0.13004108; Gradle provisioned CMake 3.22.1.

Strict TS, four host tests (including built-bundle FD requests/events), nine reused
native transport JVM tests and ARM64 debug assembly pass. APK 16 KB ZIP alignment
passes; size 99,851,792 bytes, SHA-256:
`d84b13be1e9b804c27c8218df0c36fc167940c76cb4075be8d4937df136c618d`.
Assembly does not prove Android boot, child permissions or renderer parity.

Next: separately approve device installation for independent Ping/filesystem,
Activity recreation and service/process loss. Then prove Termux signing/UID and
controlled child environment/stdio/cancellation/FD readiness, followed by browser
bridge and supervisor migration. Complete recipe/source provenance and third-party
notices before redistribution. No TE2 runtime replacement, device install,
framework restart, release/version bump or publication in this slice.

This is the current direction, superseding the Python-helper architecture as
the intended product. The accepted prototype remains unchanged until the new
runtime is proven. Installer integration is paused behind this prerequisite.
Documentation approval is not approval to download/vendor binaries, implement
native code, assemble/install APKs, terminate processes or publish releases.

Electromux is a reusable Termux-oriented Electron-like host, not TE2-specific
glue and not a Cefrium replacement. Cefrium owns rendering; Electromux owns the
embedded JavaScript main runtime, typed IPC/API adapters and owned-process
lifecycle. TE2 Termux remains one separately installed consumer. Termux supplies
application executables/environment and the established shared-UID execution
lane, not the Node/Python runtime needed to boot Electromux itself.

### Current source versus intended runtime

Current source: Cefrium renderer JS -> exact-document Kotlin bridge -> private
Binder client/service -> isolated embedded Node executing the native-declared
TE2 TypeScript-derived consumer. Local restart, Cancel/lifecycle and remote
switching are user live-accepted. There is no Python helper/external Node
prerequisite in this TE2 host execution path.

Historical implementation: Python Unix-socket helper -> external Termux Node.
`vendor/electromux/electromux/helper.py` owns authentication, socket leases,
process supervision, bounded forwarding and recovery; `protocol.py` owns JSON
framing; `sample_backend.py` is demo-only and `__init__.py` is a package marker.
The TE2 actor already reuses real Desktop controller/configuration source.

Implemented target: Cefrium renderer -> narrow native/document-fenced bridge ->
embedded Node with Electromux main-process JS and a consumer module. Removal of
the Python helper runtime and external-Node prerequisite preserves ownership,
authentication, correlation, bounds, backpressure and recovery guarantees.
TE2's own Python dependency is an application concern and is not eliminated by
this change. Avoid simply embedding Node then spawning another external Node
actor. Preserve Desktop code reuse via a transport-independent consumer seam.

### Runtime candidate and build language

- Candidate: [fogtape/nodejs-mobile](https://github.com/fogtape/nodejs-mobile),
  **full Android v24.21.0-0**, ARM64 first. Node 24 is upstream LTS; the fork's
  [release](https://github.com/fogtape/nodejs-mobile/releases/tag/v24.21.0-0)
  is marked prerelease. Candidate selection is not binary/device acceptance.
- Do not select an unpinned latest asset. Record exact release/recipe commit,
  artifact URL, SHA-256, headers, build flavor, ABI, licenses and toolchain.
  Inspect the actual archive before claiming its layout, size or provenance.
- Prefer full over lite initially: retain Inspector and general-purpose
  functionality rather than a consumer-specific reduced ICU/feature profile.
  Node 25 is EOL; Node 26 is Current and the fork's latest 26.11 snapshot is
  explicitly based on an unreleased proposal. Neither is needed for this proof.
  [Upstream status](https://nodejs.org/en/about/previous-releases),
  [fork releases](https://github.com/fogtape/nodejs-mobile/releases).
- Author generic runtime, protocol DTOs, supervisor and API adapters in strict
  TypeScript. Typecheck separately, then emit/bundle JavaScript into APK assets.
  Type stripping is not typechecking; no on-device compiler is required.
  Keep Android/Cefrium lifecycle and JNI in Kotlin/C++ where necessary.
- Electromux's generic runtime must not import TE2 or require a running framework.
  Consumer policy, installer commands and TE2 launcher semantics stay separate.

### Independent proof and migration gates

1. Inspect pinned ARM64 libnode/header artifacts, exported entrypoint/linkage,
   minimum Android API, ELF/APK 16 KB alignment and C++ dependency coexistence
   with Cefrium. README claims of 16 KB support require independent verification.
2. Build an independent sample using a small JNI adapter and a process/service-
   owned Node background thread, never Activity-owned initialization. The
   [fork FAQ](https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/FAQ.md)
   documents one runtime per process; verify shutdown/restart behavior for the
   exact artifact. A stopped JS consumer is not necessarily a stopped engine.
   Decide crash isolation/recovery boundaries before replacing the old helper.
3. Prove typed request/reply and unsolicited event delivery with bounded queues,
   exact-document authorization, cancellation, navigation/disposal fences and
   renderer recreation. Do not use app-process stdin/stdout as dedicated IPC or
   call process.exit() blindly inside a shared Android process.
4. Initialize explicit writable roots, cwd, HOME/TMPDIR and runtime caches before
   Node initialization; keep app-owned runtime state separate from the Termux
   environment passed to children. Follow the
   [embedding guide](https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/EMBEDDING.md).
5. On an explicitly approved device, prove file access and one controlled Termux
   child: correct UID/environment, stdout/stderr, exit status, process-group
   cancellation and inherited extra FD/readiness. Shared UID alone does not
   prove Android executable/SELinux permissions. Embedded process.execPath is
   not a promise of a runnable Node executable; do not assume fork() parity.
6. Migrate the generic supervisor/framing implementation and its real-process
   tests to TS/Node; retain stale/live-owner protection and no mutation replay.
   Remove Python runtime packaging only after equivalent gates pass.
7. Integrate the existing TE2 actor as a consumer, then revalidate local/remote
   launch, source-build waits, FD3 readiness, settings/bookmarks, sidebar/second
   editor, lifecycle recovery and owned-only shutdown. No compatibility claim
   follows merely from libnode loading or TypeScript passing.
8. Resume missing-framework installer UI after Electromux boots without installed
   Python/Node. Installer may install TE2 application dependencies with explicit
   consent; it must not be necessary to bootstrap Electromux's own control plane.

The framework-independent ADB/CDP debug tap remains planned separately; preserve
Inspector capability without enabling production debugging by default.

## Connection/bookmark/Android settings slice (2026-10-07)

Approved source implementation: mobile Framework Connection gives the host a
full-width row, with Port/Connect below. The field was present in source/APK;
CDP was disabled during inspection, so the actual missing-field cause is not
claimed as proven. Physical layout acceptance is required.

TE2 Termux explicitly seeds a Localhost (`127.0.0.1:8089`) bookmark once in the
existing native bookmark store. Atomic seed marker plus bookmark publication
allows deletion to persist; collisions, capacity and existing endpoints are
preserved. Seeding never changes the selected framework and ordinary Android
clients do not invoke it. Shared bookmark save/delete and Connect retain the
existing gateway/settings paths.

The consumer-only `electromux-settings.js` adds keep-alive, actual permission/
CPU/Wi-Fi lock status, Notification permission and Battery settings buttons.
Exact packaged-document native requests reuse AndroidAppSettingsStore and
PersistentNetworkService. No arbitrary intent target/extra is accepted;
system notification settings use the native consumer package. Resume rereads the
keep-alive flag before existing permission/power handling. Browser activation
refresh is coalesced and preserves pending checkbox intent; it never reloads the full
connection form. Foreground/lock policy remains active-session-owned, not an
independent launcher wake lock. The keep-alive checkbox saves on change without
a separate Save button, disables during the write, and restores the confirmed
value on failure without mutation retry. Desktop never imports the Android section.

Source checks and user live layout/bookmark/permission acceptance pass. The
immediate-save follow-up also received user live acceptance on Razr.
No installer or shared-framework action.

## Later: framework-independent ADB frontend evaluation

User requested an Android debug tap into CDP or the console bridge that works
without a running framework. Prefer existing Cefrium CDP, with native opt-in,
loopback-only control and ADB forwarding; do not require the framework-hosted
console worker to discover/enable it. Investigate native port/target discovery,
exact-page evaluation, bounded correlation, renderer restart lifecycle and
forward cleanup. Assess Gecko's equivalent separately. Keep production security
and authorization explicit; no blanket debugger resume or web-security disabling.
This is documentation only, deferred until after this settings slice.

## Deferred settings/install follow-up

Priority is the confirmed stale-helper-socket incident described in
[OUTSTANDING_ISSUES.md](OUTSTANDING_ISSUES.md). Its approved lifecycle/UI source
fix passes tests and preserved-storage Razr cold-start live acceptance. No framework
mutation replay, shared-framework restart or data clearing is permitted.

User live acceptance of the automatic-startup/isolated-launcher slice passed on
2026-10-07. The major helper-lifecycle bug is also fixed and live accepted.
The requested URL-field, bookmarks/localhost preset, remote loopback/run-profile
verification, Android notification/power settings and conditional standard
Termux installation card are recorded in [OUTSTANDING_ISSUES.md](OUTSTANDING_ISSUES.md).
Resume with two coherent scopes: connection/Android settings first, installer
integration second. Obtain renewed concrete approval before edits or device work.

## Automatic startup and isolated launcher — current implementation

The approved consumer slice reuses Electron's `startLocalFrameworkOnLaunch`,
`autostart` and `preferredAppId` settings and existing portable launcher UI.
Private Android `electromux_startup` preferences persist these fields; only the
exact native launcher/settings document bridge can read/write them. Existing
framework environment, broadcast and venv configuration remain actor-owned.

A one-shot native app-entry coordinator starts the configured local framework
concurrently with renderer initialization. Preferred-app navigation waits for
native selected-endpoint readiness, then uses the existing app-open gateway.
Remote-only preferred-app mode checks whether the selected server is online;
local readiness does not incur a second health probe. Activity recreation,
renderer reload and service reconnect do not replay startup. Navigation and
endpoint fences prevent late completion from replacing a user's selection.
Teardown detaches the coordinator; it does not stop an external framework.

TE2 Termux shell/chrome documents now use `/electromux-shell/`, served from APK
assets before editor OTA. Allowlisted legacy `/android-shell/` HTML migrates to
the new namespace, without clearing preferences/storage. Source already had
APK-first interception, so the missing launch card is not proven to be an OTA
overwrite. This is isolation and migration, not a confirmed incident diagnosis.
Ordinary Cefrium retains `/android-shell/` and inert startup hooks; generic
Electromux remains framework-independent. Android intent-security guidance
keeps local execution authority behind the exact native-document allowlist:
no new exported components or incoming-intent execution settings were added.

Validation scope: browser regressions, Termux and ordinary Cefrium Kotlin/JVM
compilation/tests. Next gate needs separate APK assembly/install approval:
upgrade without storage clearing, editor OTA, saved settings across restart,
automatic local/preferred launch, remote-only attach and user navigation races.
No framework/bootstrap change, release/version bump or device mutation in this slice.

Status: approved planning direction; implementation requires a separate scope approval.
Date: 2026-10-06.
TE2 integration branch: `feature/electromux-host`.

## Release-compatible mobile launch wait (2026-10-07)

Approved direction; mobile source implementation is now present, with physical
launch behavior live-accepted after user-cleared app storage. Preserve
compatibility with the last published TE2 release: do not change the Python
bootstrap, Rust server, wheel, or release version for the first mobile fix.

Launch the configured `te2` normally once, without a separate `--build-only`
preparation process. Bootstrap already chooses the installed release binary or
automatically builds an editable/source install. The release installer wrapper
sets `TE2_SERVER_BIN`; unconditional `--build-only` currently fails with
`--build-only cannot be used with --server-bin` on the new Motorola.

While the owned launch is pending, wait indefinitely for the existing bootstrap
control handshake and established readiness checks; do not fail merely because
compilation exceeds the current short deadlines. Display the latest bootstrap
stdout line in the launcher as progress, replacing rather than accumulating
lines. Keep stderr flowing through existing diagnostics. Output text is feedback,
not parsed build-state or readiness authority. Exit/spawn/control failures still
end the wait with an error; only elapsed-time startup failure is removed.

Provide a Cancel button during this pending operation. It sends SIGTERM to the
exact owned launch process/process group (including its build), not an external
or remote framework. Cancellation must unwind the wait and prevent late
readiness from selecting the endpoint or launching the preferred app. No
automatic restart or mutation replay. Preserve bounded output and existing
document/selection/ownership fences.

Desktop has the same desired waiting/progress/cancellation semantics, but its
implementation is deferred because Electron is delivered through the Python
wheel. Keep this first change mobile-scoped even though the controller source is
shared; do not silently alter Desktop defaults. A later coordinated release may
add explicit preparation/build phase events in `framework/bootstrap/bootstrap.py`
and phase-specific deadlines for both clients. Those events are not required of
the last release and must not become a prerequisite for this mobile fix.

Validation for the eventual implementation: published release startup without
Cargo/prebuild, delayed editable build beyond the old deadlines, last-line
progress, cancellation during compilation, early exit, late-ready cancellation
fencing, and external/remote ownership preservation. Implementation/build/APK
installation require their own approved scope. Source/tests and bundling are
validated and APK installed on the Razr. User accepted launch behavior after
clearing app storage; this does not validate upgrade/OTA launcher preservation.

### Integrate launcher isolation into the next slice

The user reported that the framework launch card was absent until app storage
was cleared, and suspects an OTA-overwritten launcher. Root cause remains
unverified. Include source-backed investigation and correction with the next
automatic-startup/preferred-app slice, rather than an unrelated release.
Acceptable directions are a unified client-aware Android launcher or a distinct
APK-owned self-hosted launch location analogous to Desktop. Existing client
identification, asset routing and materialization contracts must decide the
implementation; do not introduce guessed client identity or an extra transport.
Keep TE2 Termux's host adapter available across APK upgrade and editor OTA,
preserve user settings/data, and test without clearing app storage. Existing
Gecko/Cefrium launchers and remote framework selection must remain intact.

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

TE2 Termux supplies the mobile Home/Reload/Recents/Quit/Tools toolbar in
`desktop_client/android_shell/chrome.*`. JavaScript exposes the Electron
shell-preload-shaped `te2Desktop.request(method, params)` and `onStatus(callback)`
returning an unsubscribe function. This is a declared subset, not BrowserWindow
or arbitrary ipcRenderer compatibility. TE2 retains action semantics. Native
tools-overlay contents and dialogs remain unchanged; ordinary Cefrium retains
its native header and Gecko is unaffected.

User live-accepted the first toolbar APK. The subsequent approved layout polish
keeps Home/Reload on the left and Recents/Quit/Tools on the right, removing the
Lock button and its JavaScript rendering. Existing native lock semantics/API
are not removed from other clients. This APK-owned UI needs a rebundle, not an
editor OTA; the polished APK's installation/live check is separate.

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
