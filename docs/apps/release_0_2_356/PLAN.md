# 0.2.356 maintenance plan

## Release direction

### Termux execution-environment refresh — 2026-10-26

Before the next release, refresh installed `termux-*` packages plus the current
core/exec/tools prerequisites. Installed presence alone does not qualify an old
Termux execution environment. Read names/status from `dpkg-query`, not `apt list`
display text, and do not require ripgrep in the installer. Refresh apt metadata,
then reinstall/upgrade the selected package set and normal dependencies with
explicit `--force-confnew`/`--force-confask` dpkg policy. `apt -y` alone does not
answer modified-conffile prompts. Explain package-configuration replacement and
dpkg backups before consent; home dotfiles are outside this repair.

The Python installer performs this before locking or probing Python/Node ABI,
then replaces itself through Termux's packaged login entrypoint and the exact
installer arguments. One internal handoff flag avoids a refresh loop. This lets
package-owned loader setup choose the preload library rather than inheriting a
stale environment or hardcoding current library names. Rollback/uninstall skip
the refresh; Linux and legacy release selection stay unchanged. The no-Python
bootstrap also installs core support with explicit updated-conffile policy.

Mocked install/consent/failure/handoff tests do not establish on-device linking
acceptance. Validate with a stale Termux environment before publication. Also
audit the separately packaged Electromux launcher's hardcoded legacy
`LD_PRELOAD` path before claiming parity; client/Android edits are not authorized
by this installer slice.

Sources: https://github.com/termux/termux-tools/blob/master/scripts/login.in and
https://manpages.debian.org/bookworm/dpkg/dpkg.1.en.html.

### Owned frontend/WBA no-Any cleanup — 2026-10-25

Replace explicit and inferred Any in owned source, including nested structures,
generic arguments, parameters, members, callbacks and return values. Resolve WBA
imports directly to TS implementations, retain generated .mjs runtime output, and
type controller/global contracts at their producers. External dynamic data stays
unknown until checked; Array.isArray/JSON/DOM/socket defaults must not leak Any
back into owned declarations. Gate both projects with compiler-backed checks and
negative fixtures; preserve copied upstream and verify its integrity separately.
Record unrelated baseline test debt, not a false whole-suite pass. No shared
runtime restart, Android publication, version bump or commit is part of this slice.

### Approved webview lifecycle, links and icons — 2026-10-25

Investigate/repair JSON Crack initial rendering through document-ready, revision-
fenced delivery, not arbitrary delays or extension patches. The injected head
bridge currently reports ready before extension scripts execute, and readiness
has no document-incarnation proof. Preserve the ordered startup journal, resource
sandbox, client identity, reconnect and one-shot semantics. Compare local Code OSS
webview load handoff; regress delayed scripts, replaced documents and queued data.
Partial graph geometry remains a hypothesis until live testing.

Add guarded webview file-link forwarding through existing WBA navigation ownership;
respect extension-handled clicks, local fragments and enableCommandUris policy.
No unrestricted opener/command execution or iframe navigation fallback. Support
ThemeIcon declarations and missing contributed-image fallback to the installed
package icon (no extension-id exceptions or filesystem scans). Live inspection
confirms $(markdown) was fetched as a file, and Code Visualizer's declared
media/icon.png is absent while its package icon exists. Reuse typed Sidebar icon
projection, including additive Python DTO fields where necessary. Test/build
frontend/WBA and Python contracts; matching activation/OTA/restarts remain separate
approval gates. No version bump, commit, Android or framework changes in this slice.

### Approved editor ↔ extension-host properties slice — 2026-10-25

After deferring shared libraries to .357, repair missing editor-to-preview scroll
sync and complete the bounded read-side editor-properties family: visible ranges,
all selections and resolved editor options. Reuse vscode.editorState.update and
ExtHostEditors.$acceptEditorPropertiesChanged, not Markdown-specific messages or
another transport. Reference local Code OSS mainThreadEditor.ts/extHostTextEditors.ts
and Markdown TopmostLineMonitor. Preserve exact-client facade/path/generation,
volatile disconnected notifications and open-ACK resynchronization; independently
deduplicate changed properties and dispose obsolete listeners/timers. Initial
properties must be refreshed after open and viewport/model/configuration changes.
Tests cover real WBA client dispatch, client isolation, malformed ingress,
coalescing and lifecycle. Typecheck/build frontend and WBA; no Python/Rust/mypyc,
runtime restart, OTA, Android, version bump or commit in this approval.
Editor mutations, decorations and editor-group management remain separate APIs.

User defines this release primarily as drop-in optimizations. Preserve established
contracts/behavior, avoid new runtime dependencies, and measure improvements
without claiming source-only validation proves live latency gains. Additional
user-provided optimization items will be integrated here, not in a competing plan.

## Actual work order — corrected by user 2026-10-20

2026-10-24 user reprioritization: defer native-debug/console-bridge work again
and repair the Explorer Git-init footer first. Detection is already backend-owned
and correct. The frontend status handler applied a non-repository diff-base
snapshot, then unconditionally hid Init with setGitControlsEnabled(true, false).
An independent later hydration could restore it, explaining the intermittent
visibility. Approved fix projects the backend isRepository === false flag in
that status update, preserving the existing confirmation/RPC/init path, project
guards and empty-but-initialized repository handling. Include actual-controller
DOM ordering/transition regressions, typecheck and host build. No backend/mypyc,
runtime restart, OTA, Android, commit or publication is included in this slice.

2026-10-22 scope correction: before further network-RPC optimization or restoring
Refresh, address the user's app-agnostic framework invariant. Approved audit and
staged proposal: FRAMEWORK_AGNOSTIC_AUDIT.md. Existing Cargo selection core is
generic, but native setup/discovery and several Rust policy/debug/asset paths
contain app-specific production knowledge. Do not extend those branches. First
approve a generic native runtime/selection contract, then atomic registry/routes/
future-launch context refresh, and migrate remaining policy through app manifests
and app-owned hooks. User separately approves Stage A1 bootstrap implementation:
configured-root discovery, a typed read-only selector and app-owned runtime
provider. User subsequently approves Stage A2: the read-only cross-language
selector uses the existing capability-protected sidecar and installed bootstrap
locator, with bounded startup receipts and strict typed Python/Rust contracts.
No lifecycle/reload caller was enabled by A2. User then approves Stage B source
implementation and isolated tests: one immutable manifest/initialization/intent/
route/native-selection catalog, dynamic guarded socket dispatch, generation-pinned
launch admission and rollback without touching active owners. Stage B is now
source-wired; shared framework/sidecar adoption and live refresh remain separate
approval gates. User subsequently approves Stage C: app-owned intent/CORS/state/
capability declarations, structured exact-target diagnostics and isolated tests.
Stage C is source-wired; live adoption remains gated. User then approves Stage D
neutral fixtures/source guardrails, explicitly including the retired editor alias.
That source cleanup is implemented; grouped live adoption remains pending.

Validation is a gate within implementation work, not a standalone phase. User
confirms the startup work has passed live validation; do not ask them to repeat
it or leave it as the next work item.

1. Startup recovery / early HTTP initialization — implemented and live accepted.
2. Framework-pipe intent and Sidebar IPC consolidation (O1), especially ALS <->
   Code TE2. This is the next actual workstream: source audit/design, then bounded
   implementation approval and delivery, with its tests/acceptance in that phase.
   Immediately after the cutover, address the Code TE2 Any audit described below,
   before starting the next optimization slice.
3. Pipe/DTO/PyO3 optimization (O2): delivered byte-ingress/native-type slices are
   complete and live accepted. Remaining Code TE2-side multiprocessing,
   multithreading and event-queue work is deferred to .357 (2026-10-26), not a
   .356 release obligation. See ../release_0_2_357/PLAN.md for resumption gates.
4. Connected-but-quiet built-in console policy is implemented; Cefrium socket
   repair awaits the user's APK acceptance. User defers ALL remaining console/
   MCP work on 2026-10-25; see end-of-plan backlog. Do not start native commands,
   ALS logging migration or retained-history implementation now.
5. User suspends O3 pipe socket routing indefinitely (2026-10-25). Further raw/
   zero-copy pipe codec flattening is next-version investigation, not .356 work
   or a promised zero-copy result. Do not automatically resume either. Remaining
   optimization candidates need explicit reprioritization; reviewing the existing
   async-runtime probe does not authorize production adoption.

This corrects the agent's earlier placement of console work as Phase 2. Workstream
ordering does not itself approve implementation of the recorded investigations.

## Post-cutover follow-up — Code TE2 Any audit

User supplied root `mypy_typecheck_errors.txt` (2026-10-21), captured from Code TE2
with strict mypy, extra checks and all Any-disallowing options enabled. Treat this
as the seed report for the large typing-debt pass after the ALS/Code TE2 pipe
cutover, not permission to interrupt that cutover or silently broaden its scope.
Preserve the original report unchanged, including while it remains untracked.

When resumed, establish the exact reproducible command, mypy version, source root
and configuration, then refresh diagnostics against the post-cutover source.
Group by root cause/interface rather than assuming each diagnostic is a separate
fix. Prioritize native FWS callbacks, event/DTO boundaries, service contracts and
worker lifecycle typing. Use concrete DTOs, protocols and typed containers;
validate object/unknown ingress rather than propagating Any or merely replacing
it with casts, broad suppressions, disabled checks or opaque object everywhere.

Keep behavior unchanged and validate touched owners with focused regressions,
the agreed strict/extra/Any command and the normal mypyc validation workflow.
Distinguish upstream-stub/library typing seams from local dynamic authority and
surface any genuine policy tradeoff before weakening a check. Changing durable
build/typecheck policy, activating compiled code or fixing the whole report needs
its own concrete implementation approval; this entry records the follow-up only.

2026-10-21: user reports interpreted Code TE2 working well and prioritizes typing
before another build, then approves staged production/test cleanup. Current
reproduction, grouped boundaries and remaining diagnostics are maintained in
`TYPING_AUDIT.md`. Build/typecheck policy is unchanged; no compilation, activation,
restart or commit is authorized by this cleanup. A separately approved native
worker correction aligns `skipSid` list delivery with the Python Sidebar
contract; its tests remain unexecuted until a build/test compilation is approved.

The first slice is checkpointed locally as `039e38bf`; the user approves continuing
the remaining report. Source cleanup now passes the full stronger invocation for
the Code TE2 tree and focused owner regressions. Remaining gates are actual
native/mypyc compilation and live activation, not further known diagnostics in
this report. Keep the stronger audit separate from durable build-policy changes;
do not infer compilation-time improvements from error-count reductions.

### Approved mypyc progress/cache visibility and import correction

User requests live completed/total C targets, then per-target cache labels for
future builds. Preserve normal build/cache/concurrency/activation policy; use
ccache's isolated per-invocation machine-readable results rather than global
counter deltas or elapsed-time guesses. Missing statistics must be unknown.
Tests include tiny isolated compiler fixtures, not a full editor build.

The user's subsequent 310/310 build fails during import validation, not C
compilation. Isolated imports of its retained compiler outputs reproduce
NativeEventHandler losing runtime Protocol identity under mypyc. User separately
approves extracting that Protocol and the same-shaped QueueSizeReader into one
small interpreted contracts module, retaining compiled implementation modules,
with actual focused compile/import validation. Full domain rebuild/activation
and runtime testing remain separate; do not publish or activate failed snapshots.

## Compiled Sidebar DTO correction during live validation

2026-10-21: user validates the new compiled runtime; the running worker log and
loaded shared objects confirm actual mypyc adoption. ALS diff-link file opens
then reveal a receiver-side schema failure, independently of the separately
reported ALS Markdown-link frontend parsing bug. User approves moving the three
runtime-inspected msgspec Struct DTOs to the existing interpreted Sidebar
contract module, preserving compiled dispatch, strict validation and all owners.
The actual codegen dispatch test additionally exposes request-order-dependent
module initialization; user separately approves correcting the lazy import.
Qualify first-call file-open and valid/invalid/null coordinates/qualified IDs in
the compiled fixture. No full domain rebuild, activation, ALS rebuild/OTA or
runtime restart is authorized by these fixes. Markdown parsing remains separate.

## Pre-IPC inspection affordance — Electron DevTools

User approves an immediate small Electron-only affordance before the next major
workstream: title-bar DevTools button between Home and Reload, toggling a detached
DevTools window for the displayed app (launcher when no app is open). Existing
local DesktopShellSettings persists showDevToolsButton, default false, without a
schema/version bump. Desktop Settings exposes Show DevTools button; shared shell
capability hides/omits it on native Android/Electromux hosts. Main process gates
the action and rejects absent/destroyed targets; no page-provided target ID or eval.

Tests/typecheck/build are in scope; no Electron restart, APK build, runtime restart,
OTA or commit is authorized. Rebuilt Electron relaunch is required for activation;
ordinary editor asset OTA cannot update the native main/toolbar implementation.
This does not advance Phase 4 console-bridge retirement.

## Additional .356 repair — Aria Downloader (recorded for later)

User reports Aria Downloader is pretty broken and requests repair in this release.
On explicit steering, record for later: do not displace the next IPC work or begin
investigation now. Concrete priority among later tasks remains to be selected.

When resumed, inspect current app source and exact current runtime/shell logs,
then propose a bounded repair plan. Historical recurring 502/stale-shell/lifecycle
issues in ../dependency_trim/PLAN.md and TRACKER.md are leads, not proof of the
current failure. Reuse the app-owned ASGI/typed frontend, jobs and framework-shell
ownership; distinguish compatibility repair from the broader socket/intent redesign.
Do not replay download submissions or restart/kill shells as a diagnostic shortcut.
Runtime transitions, mutations, implementation and live acceptance need their own
concrete scope. No Aria inspection, code change or restart is approved by this entry.

## Phase 1 — slow-connection startup recovery

Initial approved frontend slice preserves ui.host.bootSnapshot.get and its
existing response shape, including compatibility with older servers. The later
approved HTTP slice below supersedes its frontend-only activation boundary.

The boot snapshot includes project/editor/Explorer/run-profile state and managed
Code Server disk assessment. Its previous eight-second emitted-request deadline
included transport buffering, backend work and response delivery. Initial failure
previously continued with null state and triggered a second full snapshot during
prerequisite preparation, ultimately failing before editor mount.

Use a startup-specific 60-second request budget; show waiting state and offer
explicit Retry/Stop Loading after failure. Retry only the state read, never project
launch, installation, mode change or other mutations. Do not continue unknown
startup state or infer installation absence. Preserve fresh-negative revalidation
and known-compatible fast path. Disconnect still rejects requests; no automatic
replay or generic RPC timeout change. Polling/WebSocket behavior remains intact.

Validate strict TypeScript, host build, boot and transport regressions. Source
validation is not client activation: native clients need separate asset publication
and reload. User reports the live startup validation passes (2026-10-20).

## Early language HTTP projection — approved 2026-10-20

GET /api/app/code_te2/startup/language (native route /startup/language) reuses
the existing Rust HTTP -> PyO3 domain submit bridge. It returns only ui_prefs with
webWorkersEnabled and code_server from existing authoritative preference/disk
assessment owners, no full project snapshot, identity allocation, installation,
runtime start or preference mutation. HTTP response is no-store; backend failure
is 503, not 404. No new server/transport/library or fallback Python HTTP worker.

Frontend prefetch begins before Explorer namespace initialization. After any
explicit project-launch handling, use its status to prepare the language backend
and start WBA readiness asynchronously before requesting full host state. Document
mount remains independent of WBA readiness. Full project/editor snapshot is still
required: this is not elimination of all startup round trips. Do not seed the
small projection as complete UI preferences; later full preferences supersede a
changed mode. Fresh negative installation facts are rechecked before consent.

Only HTTP 404 selects unchanged RPC behavior, retained only for this page lifetime;
user explicitly requires missing endpoints not to kill older-server startup.
503/permission/network/timeout/malformed-200 are errors with explicit read retry,
never capability absence, inferred installation absence or transport fallback.
Bound response to 32 KiB decoded bytes, 60-second abort covers body delivery too.
New server retains old RPC for older clients. Old clients retain their old timeout;
compatibility does not retroactively optimize them.

Validate strict Python/TS, existing backend tests, native HTTP response tests,
404/error/deadline tests and actual boot ordering. Matching Rust worker plus
Python/mypyc activation and client assets are required for live optimized path;
updated assets against an old worker exercise the 404/RPC lane instead. Native
tests do not activate a worker. No runtime restart, APK build, version bump,
commit or asset publication is authorized in this slice.

## Follow-up evidence

If needed, measure connection setup, emitted request/response and backend snapshot
timing to evaluate the additive HTTP endpoint and further startup scheduling changes.
Transport congestion is plausible, not established by the source inspection.

## Phase 4 — native-client debugging and staged built-in bridge policy

Approved native inspector repair (2026-10-25): live Razr evidence isolates a
cross-APK DevTools abstract-socket collision, not console identity or logging.
Chromium falls back to <base>_<pid> when its base bind fails, while the existing
relay keeps connecting to another APK's base socket and SELinux denies access.
Direct ADB discovery of this process's fallback lists the actual app targets.
Share a process-qualified prefix/name between native server and relay from
creation; expose that name in the existing state snapshot and cover derivation
with JVM tests. Do not scan/fallback to another app's socket, weaken SELinux,
enable logs as a workaround, or change the renderer/debugger policy. Shared
Cefrium/TE2 Termux source only; APK assembly/install remains a separate gate.
Source reference: [Chromium DevTools socket factory](https://github.com/chromium/chromium/blob/main/chrome/browser/android/devtools_server.cc).

Subsequent user scope correction: connected-but-quiet console registration/eval
is sufficient for ordinary debugging; the objective is eliminating automatic
page-load log traffic, not retiring this working control lane. Gecko native
debugging is being developed by the user on another branch; do not implement a
competing Gecko/Chii replacement here. Next bounded proposal is MCP access to
Cefrium native CDP, especially errors unavailable after page failure. Existing
te2_console_eval already addresses the native Android control worker independent
of page JavaScript, but its allowlist currently exposes state, not CDP requests.
Qualify typed native target discovery, exact-target evaluation and bounded
on-demand error retrieval over that existing control lane. Preserve inspector
session/focus, connection/document epochs, request deadlines and cancellation;
never replay evaluation or continuously forward protocol/log events upstream.
Native error capture retention/byte limits require explicit design approval.
No new framework transport or MCP catalog entry is inherently required. Android
implementation and another APK build require separate approval; leave the user's
current Cefrium build source undisturbed while investigating.

2026-10-25 update: user resumes this work and approves a bounded **bridge-policy
first** implementation, superseding full removal as the immediate direction.
Code TE2, Terminal and File Explorer opt into a shared built-in wrapper around
the unchanged agnostic bridge API. Framework bootstrap adds `--debug-console` /
`--no-debug-console` with `TE2_DEBUG_CONSOLE`; existing `--runtime-debug` also
enables these bridges. Rust's existing app_bootstrap publishes `debug_console`
and app_shell applies it before app module import, without another HTTP request,
query flag or console registration handshake. Older/missing policy is quiet;
the existing runtime_debug field still enables older-server diagnostics.

User correction supersedes connection gating: built-in setup always prepares,
connects/registers and serves eval, preserving existing identity/state consumers.
Only automatic log/error forwarding is gated, before serialization. The ordinary
browser console continues running. `await window.te2DebugConsole.enable()` works
through console eval; `disable()` restores console/error hooks without tearing
down registration, eval or pending control work. `status().forwarding` reports
the distinction. Page overrides are not persisted; dependency preparation stays
single-flight and retryable.

Approved runtime extension: `te2 console logging on|off|status [--url URL]` reads
or updates framework-owned atomic policy through bounded JSON /api/console/logging.
Startup flags/environment seed policy; explicit runtime off overrides that seed.
No process-environment mutation, persistence, automatic replay, broadcast or shared
runtime restart. Newly loaded/restarted app pages receive the policy through
existing app-bootstrap; existing pages use their own eval override. Mutation
requires JSON plus a non-simple control header under existing framework network
admission; CLI disables proxies/redirects and reports failures without fallback.

Approved scope: source/tests/builds/docs for those three TE2-owned producers,
CLI/bootstrap and existing app-bootstrap projection. No native Android control
worker, run-profile/generic user-app API or framework console relay changes;
no APK build, runtime restart, OTA, commit or ALS edits. ALS has its own producer
and upstream/snapshot contract, so it remains a separate migration—not evidence
that all first-party logging is quiet. Rebuild/adopt the framework plus publish
matching app-shell/bridge/host/Terminal/File Explorer assets before live checks;
no Code TE2 worker or mypyc rebuild is required.

Subsequent separately scoped slices: client-associated native debugger/MCP
discovery/evaluation, then client-run-scoped **disk-only retained history, at most
500 records**, with bounded record bytes/previews and on-demand retrieval rather
than automatic network forwarding. Retained history excludes in-memory log lists,
not transient bounded encoding/I/O buffers or browser-internal caches. Qualify
native CDP on Cefrium/Electron versus native Firefox RDP on GeckoView; current
Gecko Chii/Chobitsu GUI remains separate and does not consume RDP directly.
Use exact client/run/target/frame/document-incarnation guards, not URLs or a
global last-active target. Qualify built-in sidebar frame coverage and native
control discovery before retiring bridge-dependent tools. Browser debug caches
are volatile/bounded, not a durable cross-renderer log contract.

The following records earlier deferral/removal directions for context; it does
not override the bounded policy implementation and separate follow-up gates above.

User explicitly defers implementation until after framework-pipe intents (Phase 2)
and concurrency/queuing (Phase 3). This is not the next work item, approved edits
or an active acceptance gate.
User's later direction supersedes warn/error-only filtering as the primary plan:
remove first-party framework apps from the console bridge once native debugging
is ready, and reserve the bridge for user/developer app instrumentation.

### Source-backed findings

- app/static/js/te2_console_bridge.js and Code TE2's separate copy at
  app/apps/code_te2/main_page/frontend/console_bridge.js patch log/info/debug/warn/
  error. _emitLog maps every argument through JSON serialization and forwards it
  as console:log whenever connected, with no verbosity gate. Some calls can
  therefore copy/transfer large legacy debug structures.
- app/te2_console_runtime.py on_console_log accepts registered-worker records,
  appends them and broadcasts to drawers, without filtering by log level. A
  server-only filter cannot recover the serialization/uplink cost already paid.
- framework/bootstrap/bootstrap.py uses the canonical --runtime-debug flag and
  TE2_RUNTIME_DEBUG environment. Framework app_bootstrap already includes
  runtime_debug; app/templates/app_shell.html consumes it for startup timing.
- console:registered is an existing backend-to-bridge reply suitable for an
  additive verbosity policy without a new handshake or frontend query argument.
  Registration/evaluation traffic is separate from console:log and must survive.
- ALS has its own bridge and vendored frontend snapshot under app/apps/als_rs/
  vendor/frontend/static/js/console_bridge.js. It needs separately approved
  upstream changes/snapshot publication, not a manual generated-vendor patch.
  Native/Node console producers need inventory before claiming blanket coverage.

### Intended direction — requires investigation and approval when resumed

Expose native-client runtime discovery/inspection/evaluation through socket and
MCP tooling. Cefrium uses its CDP debugging facilities. User identifies Gecko's
similar interface as CHI; record that terminology without assuming wire/API parity
with Chromium CDP. Qualify actual pinned-client bindings, target capabilities and
protocol versions during investigation. A common tool-facing API may use distinct
native adapters; do not claim Gecko is CDP-compatible without verification.

Keep on-device internal client logging and native runtime access, rather than
automatically serializing/streaming all framework app console calls into the
application console bridge. Discover/log/evaluate internal main pages, iframes and
detached views through exact native targets and execution contexts. Avoid streaming
every native console event as a substitute that recreates the same bandwidth cost;
qualify bounded on-demand logs, subscriptions and runtime-debug controls.

Once replacement inspection/eval is proven, remove framework-app bridge imports,
initialization, worker registrations and automatic console forwarding at their
actual source entrypoints. Preserve local console behavior. Inventory ALS and all
built-in apps, wrapper templates, shared/native/Node producers and secondary
surfaces before claiming broad retirement. ALS changes require independent source
scope and a regenerated vendored snapshot, not direct vendor editing. Electron
and generic-browser internal-tool behavior need an explicit decision; do not
silently remove their only inspection path or retain an undocumented fallback.

Leave the agnostic console bridge, developer embedding API, worker discovery,
console drawer, eval/control and tooling available for user/third-party apps that
explicitly embed it. Removing first-party registrations must not delete the
developer instrumentation channel or break user wrappers. Any optional filtering
for that retained channel is a separately evaluated feature, not a replacement for
this requested internal-client migration.

### Access, compatibility and migration gates

- Map existing CDP-over-ADB/native control tooling first; distinguish device-local
  debugging from a remote framework/MCP session reaching that device. A remote
  framework cannot assume it can dial the client's loopback debugger. Qualify an
  authenticated, capability-scoped client-owned connection for socket/MCP routing.
- Native debug endpoints stay loopback/controlled; no public debugger exposure,
  raw arbitrary-target forwarding or query-string authority. Preserve explicit
  debug/eval consent/admission and don't equate logging verbosity with access.
- Bind every request to client/window/native target/context incarnation; preserve
  IDs, timeouts, cancellation, detach/reconnect invalidation, cleanup and no eval
  retry. Main-page/Sidebar identity is not automatically a native debugger target.
- Inventory older APK/renderer/server combinations and define supported behavior
  before cutover. Lack of native debug support must be explicit; no implicit
  bridge reinjection into first-party apps to conceal a missing prerequisite.
- Test native target discovery, precise eval/log access, context lifecycle and
  remote routing, then prove internal console bridge traffic is absent while
  developer-embedded apps retain registration, logs and eval/control.
- Use disposable TE2 roots for runtime-bridge tests (console imports can truncate
  transcripts). Native source changes require separately approved APK/client build
  and publication; backend transitions need separate approval. No implementation,
  new debug transport, bridge removal or runtime restart is authorized now.

## Optimization workstream details (O1–O9; scheduled above, O9 unprioritized)

The following are requested investigation/proof-of-concept candidates, not blanket
implementation approval, accepted performance claims or release blockers. Keep
the completed Code Server initialization acceptance separate. Several items extend
beyond drop-in optimization into architecture: qualify those seams before making
them production dependencies. No experiments, dependencies, cross-repo changes
or protocol cutovers are authorized by recording this list.

### O1. Framework-pipe intents and Sidebar IPC consolidation

Investigate broad framework-pipe IPC/intents adoption for robust backend messaging,
including ALS <-> Code TE2 mentions, file opens, project switches and relevant
Sidebar state operations. Reuse existing broker/intent owners rather than create a
second bus. Reconcile the earlier deferred Sidebar IPC work in
../dependency_trim/PLAN.md and ../sidebar_app_intents/PLAN.md with actual source;
old .355 scheduling is historical, not a claim that the cutover shipped.

Preserve shared Sidebar membership versus exact-client/presentation foreground,
admission, reconnect/registration lifetime and durable backend authority. Define
capability/version compatibility and independently updated ALS/TE2 deployment
before retiring socket clients. Do not replace app frontend sockets merely because
backend-to-backend intents move to the pipe.

Approved first implementation slice: generic manifest-declared app RPC relay and
CWD/restore-state migration for Terminal, File Explorer and File Editor. The
existing broker supplies owned route identity, bounded correlation and disconnect
cleanup; receiver hooks retain semantic authority. Terminal/File Editor must opt
into the ordinary worker's existing HTTP-plus-pipe mode as a prerequisite. No
ALS source changes, frontend migration, runtime restart or publication in this
slice. Contract and source-backed next ALS/mention requirements:
`../sidebar_app_intents/APP_RPC.md`. Follow with separate ALS integration approval,
not a claim that the entire O1 cutover has shipped.

2026-10-21 ALS read-only survey and recording approval expand that companion
contract with a complete parity inventory and two ordered implementation stages:
bounded bidirectional ALS pipe, then semantic operations/events through existing
owners. Preserve explicit standalone socket integration; framework pipe mode has
no socket fallback. No new any/Any types. Project actions need caller proof and
bulk draft/review budgets need qualification before a concrete cutover approval.
No ALS code/runtime changes are authorized by this planning update.

Subsequent Stage A approval covers ALS's bounded bidirectional pipe foundation,
typed DTOs, client installation before router startup, isolated tests and docs;
no semantic operation cutover/exports, runtime restart, installation or push.
Source implementation is now in ALS's framework_pipe submodules; its existing
Sidebar socket traffic remained unchanged at that checkpoint. Stage B was then
approved and implemented at source: explicit ALS --stdio uses the owned pipe for
the inventoried operations, while standalone integration retains Socket.IO.
Exact client/presentation proof now also accompanies project actions. Generic
receiver-owned per-method budgets and shared byte admission keep control calls
small while selected full-model review/draft paths opt into bounded larger
responses; project UI/broker/client deadlines are aligned. Oversize/timeout or
unknown acceptance cannot authorize replay or a second transport.

The matching framework, Code TE2 Python/mypyc, ALS binary and caller-proof frontend
must be activated together. ALS frontend snapshot publication requires a clean
source checkpoint first; installed clients still need separate OTA/reload.
No version bump, install, runtime restart or client publication is authorized by
source validation. TRACKER.md owns those pending gates; ALS FRAMEWORK_STDIO.md and
the APP_RPC companion own the implementation contract.

### O2. Pipe concurrency and in-process Code TE2 DTO buffering

Current disposition (2026-10-26): completed boundary optimizations remain done;
the remaining Code TE2-side process/thread scheduling and event queuing is
deferred to .357. The user reports searching over 6,000 files and delivering all
needle-in-a-haystack results in under one second, without the earlier stalls.
This is user-observed acceptance, not an agent-controlled benchmark. Further
concurrency complexity has no demonstrated present need. The following records
the historical investigation, not authorization to resume it.

2026-10-21 priority: user requests conversion/allocation overhead as the next
target, not eliminating PyObject pointers from generated C. User approves plan/
tracker updates and read-only investigation; production edits require the
following concrete slice approval. Preserve current wire formats and owners.

Source-backed first candidate: workbench_adapter_shell_manager._stdout_reader_loop
calls len(encode_message(obj)) for every decoded push. With the native codec this
walks the Python graph back into rmpv::Value, encodes MessagePack and copies the
bytes back into Python solely for their length. payload_bytes is passed through
PendingPush to diagnostics telemetry; it is not a queue-admission budget. Gate
this accounting behind the existing diagnostics_latency_metrics_enabled() policy
at intake. Disabled metrics should perform no counting serialization; enabled
metrics retain the previous exact measurement, including coalesced accounting.
No new codec/queue or WBA provider/references (O9) change is part of this slice.

The user subsequently approves this minimal telemetry gate and focused Python/
strict validation. It is source-implemented; compiled/interpreted worker adoption
and live acceptance remain separate. No native build or live transition is part
of that approval. The broader boundary comparison below is still investigation.

Next qualification candidates: native framework-pipe decode to rmpv::Value to
Python graph to msgspec.convert, its outbound Struct-to-dict-to-Rust path, and
FWS typed requests projected through generic values. Native socket request/ACK
and WBA codec paths also share values.rs. Compare narrowly typed bridge calls
and bounded serialized buffers against actual current converters using small
control requests and nested/Unicode/binary/bulk fixtures. Include serialization,
copies, schema validation and interpreter attachment in measurements; report
boundary timings separately from total request latency and Python-only memory
measurements separately from native/RSS. Retaining an additional typed object is
not automatically an allocation win. No speedup is established by this survey.

Keep frame/depth/node limits, duplicate/non-string-key rejection, integer/binary/
null semantics, failure ordering, exact-client authority and no replay. Existing
native decode enforces guards that plain msgspec decoding alone does not replace.
Do not introduce packed codecs/shared libraries/opaque native pointers or a new
production buffer path without a separate bounded proof and approval. Preserve
ordinary Python and compiled runtime parity; source tests do not activate mypyc.

Approved isolated qualification is complete; commands, runtime identities and
measurements are in BOUNDARY_PROBE.md. Keeping full native validation, inbound
control/nested buffers improve conversion time, but binary regresses and outbound
gains largely vanish against compiled projection. Plain msgspec accepts sets the
current converter rejects. No blanket buffer cutover: next proposal is a bounded
inbound-only seam with exact guards/schema/error semantics and actual-dispatch
validation; outbound remains unchanged. No queue/GIL/runtime policy change is
authorized by the probe. Attachment costs/end-to-end latency and allocation/RSS
remain unmeasured; the probe times conversions within one attached interpreter.

2026-10-22: user approves inbound-only framework-pipe source/tests, explicitly
identifying search/Git result data as the target. Source now captures a bounded
original frame through the same native decoder and calls typed control_bytes →
the existing router. Schema-error formatting uses the prior converter on rejected
frames only; native corruption still closes before dispatch. Outbound/WBA/queues
are untouched. Matching-domain entrypoint is checked before native startup.
Capture-inclusive compiled search/Git fixtures show ~24% lower conversion time,
but binary-heavy data regresses ~20%; do not promise a universal improvement.
Actual-dispatch/interpreted/two-module-mypyc evidence and reproduction are in
BOUNDARY_PROBE.md. Source integration is not activation: prepare matching Rust
worker/full selected domain and obtain explicit lifecycle approval before live
testing. No shared restart or full mypyc build belongs to this slice.

#### WBA control pipe and network ingress follow-up

User reports rebuilding/adopting the prior framework-pipe slice successfully and
searching roughly 6,000 files without prior stutters/hangs. Record qualitative
live improvement without a historical benchmark or measured causal speedup.
Search benchmark repair is user-deferred; suspected MessagePack incompatibility
is not a diagnosed cause and old-tag reconstruction is not requested.

User approves WBA-first inbound source/parity/isolated measurement, with network
RPC next as a separate proposal. INGRESS_AUDIT.md maps actual
surfaces and records the WBA source: retain exact frames from existing pending
bytes under unchanged native validation, hand over PyBytes and decode with
msgspec in Python before existing domain routing. No outbound/direct WBA socket,
provider, frontend, queue or lifecycle change. Matching worker/domain adoption
requires a separate build/activation decision; no full mypyc build or restart is
part of this implementation slice. Preserve the binary-heavy regression caveat.

Network RPC audit finds generic Value→Python conversion in Backend.call after
native RPC validation and native socket-context wrapping. Next propose retained
validated original payload bytes plus native-owned context, not re-encoding the
wrapper; preserve handler/admission/ACK/error/cancellation semantics and leave
direct forwarding alone. Native HTTP helpers and FWS conversion remain separate.
Full design/evidence/reproduction: INGRESS_AUDIT.md. User subsequently approves
the bounded three-lane network inbound byte handoff, strict typing, native/Python
tests and an isolated source/compiled PyO3 dispatch probe. Source is implemented;
matching production worker/domain build/adoption remains separately gated. Native
guards, wrapper conversion budgets, SocketRef context, admission/Future/ACK/error
behavior remain; no other events/HTTP helpers/outbound/direct-WBA paths migrate.
No runtime transition, OTA, version or commit is included. Targeted mypyc-native-type review remains after the
selected PyO3 conversion work, without broadening into a zero-PyObject goal.

#### Async bridge feasibility — uvloop and pyo3-async-runtimes

2026-10-23: user requests investigation alongside the native-type audit, then
approves recording findings only. No new crate, lockfile, prototype, production
change, build or activation is authorized by this entry. This candidate does not
silently replace or reorder the targeted native-type pass.

Upstream pyo3-async-runtimes is the successor for modern PyO3 (the old
pyo3-asyncio release targets PyO3 0.20). Its 0.28.0 manifest requires PyO3 0.28,
matching this worker's pinned 0.28.3, and lists both single-/multi-thread Tokio
uvloop tests. Its README explicitly describes uvloop use. This establishes an
upstream-supported compatibility candidate, not a test of TE2's CPython 3.14,
Termux uvloop-te2 wheel or current worker lifecycle.

Source-backed opportunity: Backend.call_input currently holds an owned admission
permit in spawn_blocking while the Python concurrent Future's result(120.0)
waits. The Python task already runs on the dedicated domain loop created by
app.libs.asyncio_runtime.new_event_loop (optional uvloop, explicit asyncio
fallback). An awaitable bridge could let Tokio await completion without parking
one blocking-pool thread per in-flight Python operation. This is a potential
thread/concurrency benefit, not a measured request-latency/RSS win. It does not
merge Tokio and uvloop, remove the GIL, make synchronous Python nonblocking or
eliminate serialization and cross-thread scheduling.

A separately approved isolated probe should compare the existing path with
into_future_with_locals/explicit TaskLocals bound to the actual domain loop.
Do not adopt an event-loop-owning main macro or globally install a new loop policy
over the current worker. Our submit returns concurrent.futures.Future, not a
Python asyncio awaitable: qualify the minimal safe adaptation or coroutine entry
point, retain the byte/DTO boundaries and avoid duplicate scheduling. Submission
and result conversion may still need bounded blocking work; do not move costly
Python attachment/marshalling blindly onto Tokio executor threads.

Gates: default asyncio and uvloop, real owning-thread loop identity, contextvars,
source/mypyc parity, simultaneous calls, exception/result propagation, timeout,
caller cancellation, accepted-work admission lifetime, shutdown and stale-loop
invalidation. Preserve count/byte limits and no uncertain execution replay;
dropping a Rust waiter must not silently change Python task cancellation or
release admission while accepted work is still running. Qualify private Linux
Python and Termux separately before dependency/adoption decisions. Measure parked
threads, throughput/tail latency and bridge overhead under bounded concurrency.

Primary evidence (checked 2026-10-23):

- [Upstream project and uvloop example](https://github.com/PyO3/pyo3-async-runtimes).
- [0.28 event-loop/TaskLocals contract](https://docs.rs/pyo3-async-runtimes/0.28.0/pyo3_async_runtimes/).
- [0.28 manifest: PyO3 dependency and Tokio uvloop tests](https://docs.rs/crate/pyo3-async-runtimes/0.28.0/source/Cargo.toml).
- [Original pyo3-asyncio release](https://docs.rs/crate/pyo3-asyncio/0.20.0).

#### Follow-up after PyO3 optimization — targeted mypyc native types

User expands this to a staged cross-surface pass: **pipe/network first, retained
UI caches also included**. Source inventory, N1–N5 order, measurements and gates:
`NATIVE_TYPES_AUDIT.md`. Subsequent concrete approval permits N1 PendingPush native
fields and isolated RPC metadata/direct-delivery probes. Subsequent N2a approval
implements direct typed network delivery without its temporary context map,
with source/real-codegen namespace/cancellation parity; no full-domain build/
activation/restart. Next proposal is common/lane metadata, then shared
event/diagnostic records and selected caches. Do not clone already-structured
msgspec envelopes or arbitrary extension payloads; preserve schema islands and
verify actual compiled coverage.

N3 (7e214f4d, 2026-10-23): user approves isolated qualification of both event
headers and diagnostics cache/copy reuse, plus tests and docs only. WorkerEvent
has 17 module consumers including its owner; broad conversion is not assumed
worthwhile. diagnostics_bridge normalizes markers on intake then repeats that
work during aggregation; native cache records and shallow-copy alternatives
must preserve owner/project eviction and outgoing copy ownership. In particular,
dropping copies entirely aliases retained markers into published projections and
is not a semantics-preserving shortcut. Inspect actual compiled inventory:
diagnostics_bridge is absent/lazy-loaded while event_bus and file_tabs_projection
are present. Compare source and speculative compiled costs separately; no eager
imports or inventory expansion are authorized. Evidence and bounded follow-up:
EVENT_DIAGNOSTICS_PROBE.md. No production/full-domain build/activation/restart or
commit is included in this qualification approval.

Subsequent N3 approval implements the measured diagnostics safe-copy slice:
explicit internal TypedDict/direct field reads and shallow marker copies from
the already-normalized cache, without changing ingress or wire ownership. Native
records/event headers do not earn a broad migration from this comparison and
remain deferred. User separately approves replacing the pre-existing unsupported
async del project_root with _ = project_root for actual-module codegen parity.
Production compiler inventory is unchanged; fresh worker import/adoption is a
separate gate. N4 retained caches is the next candidate after live validation.

N3 user live acceptance closes that gate. User subsequently approves bounded N4:
compare caches, remove unused diff payload size/stringification, return detached
Git status dictionaries through builtin copying, and keep draft-index native
conversion probe-only. Existing diff/draft/Git cache dataclasses are already
native. Qualified draft-index field conversion brings no convincing hit-path
gain, so retain it. Exact source/codegen tests, synthetic timing/memory scopes and
activation gates: RETAINED_CACHE_PROBE.md. No cache lifetime/ownership/wire change,
full-domain build/activation/restart or commit is authorized by this slice.

Subsequent N5 approval qualifies actual search sessions/provider modules with
the shared pipe schema/MessagePack codec and existing lifecycle, then includes
the search owner as an explicit build-only inventory root. Runtime lazy imports
and interpreted DTO/pipe islands stay unchanged; no parallel typing or codec
implementation. The existing snapshot fingerprint picks up the expanded graph.
Qualification/inventory tests and documentation are in scope; full-domain build,
activation, restart, commit and Terminal projection changes are not. See
NATIVE_TYPES_AUDIT.md, N5 lazy search compile coverage, for evidence and gates.

N2b comparison (dc66b255, 2026-10-23): shared parsing also serves Sidebar. User
approves isolated four-lane native-intermediate versus schema-reuse qualification
and docs only. Preserving real editor-only contract compilation, both candidates
pass 136 cases per source/compiled-editor mode; ordinary native metadata helps
less than reusing the validated msgspec schema. Reuse removes the intermediate
allocation, with 20–28% small-parser reductions including decode in local samples;
wide-message decode dominates. Exact frozen-dataclass relocation fails import on
the installed toolchain and is not an adoption path. Prefer the refined reuse
variant preserving original private wire fields and legacy public constructor,
but explicitly changing the coercer's concrete return annotation; lane policies/
projections stay unchanged. Evidence/gates: COMMON_RPC_PROBE.md. No production
edit or runtime transition is authorized by that probe approval.

Subsequent concrete approval adopts the refined schema-reuse source change in
socketio_jsonrpc.py, with actual four-lane output/error parity and real editor
contract codegen. Keep the schema interpreted and legacy constructor available;
return the accurately annotated frozen schema, replacing only whitespace-bearing
methods. No lane dictionary, validation, transport or dispatcher changes. Probe
generation reconstructs the pre-change baseline so future comparisons remain
meaningful. Full-domain build/adoption/restart/commit remain outside this scope.

2026-10-23: user subsequently approves **both isolated probes**, plus findings in
this plan/tracker, without production cutover/restart. Source and actual mypyc
queue comparison find an 8.5–12.1% local queue/drain reduction for a native
PendingPush record; async source/compiled × asyncio/uvloop qualification frees
blocking sections during awaits but has mixed latency. Recommend the native
record first and a separately gated capacity-oriented async cutover, not one
inseparable production rewrite. Source/measurements/limits and remaining gates:
`DOMAIN_OPTIMIZATION_PROBE.md`; reproducible isolated tooling:
`framework/domain_optimization_probe/README.md`. That initial comparison did not
approve production edits; subsequent N1 and N2a approvals above are the bounded
production exceptions, now joined by the separately approved N2b source reuse.
Full domain build, activation and async adoption remain
unapproved.

User explicitly schedules this after the boundary-conversion work (2026-10-21).
Audit hot, frequently reused domain records, numeric loops and repeated dictionary
lookups for obvious native-class/primitive-field wins. Preserve Python strings,
containers and PyObject references when they are the appropriate representation;
zero PyObject pointers is not an objective. Evaluate lookup/allocation reduction
and compiled behavior before replacing a representation, including the cost of
building a second object merely to unpack it again. Runtime-inspected msgspec
and Protocol contracts retain their established interpreted boundary. Validate
ordinary Python and actual mypyc codegen/runtime parity; avoid fixed-width integer
overflow or altered null/identity semantics. Concrete edits require a bounded
proposal/approval after the PyO3 measurements, not blanket type rewrites now.

Investigate multiprocessing/multithreading and in-process queues around pipe I/O
and the Code TE2 PyO3 boundary: reduce pipe backpressure, keep intake moving and
move appropriate work behind bounded in-process scheduling. Identify the actual
reader/writer, executor, GIL and handler bottlenecks before choosing a mechanism.
Queues need byte/count budgets, fairness, cancellation and overload behavior; moving
backpressure into unbounded RAM is not a fix. Preserve per-owner/document ordering,
required delivery versus disposable progress, and no uncertain mutation replay.

Keep a schema/serialization boundary where appropriate; buffering is not permission
to move arbitrary Python objects into Rust as already-decoded DTOs. Relate evidence
to existing search queue/coalescing fixes and ALS extension-adapter DTO hypothesis,
without assuming that an unproven cross-repo hypothesis establishes this bottleneck.

### O3. Framework-pipe socket routing

Explore transparent socket routing through pipe DTO envelopes, skipping a network
proxy hop where useful. First map current frontend -> framework -> worker socket
ownership and compare actual hop costs. Define connection/namespace identity,
binary framing, admission, ordering, flow control, close/cancel/reconnect semantics
and slow-consumer isolation. Compare against the current proxy before committing;
do not assume encapsulating a stream saves bytes or CPU. Keep this routing proposal
distinct from O1 semantic intents and O8 WBA raw-socket experimentation.

### O4. FlatBuffers / Cap'n Proto pipe protocol and codec

Compare schema-based codecs for smaller/more efficient pipe transfers, including
Cap'n Proto packed streams. Use representative initialization/CRUD and sustained
traffic, measuring actual framed bytes, encode/decode/allocation CPU, peak memory,
latency and compatibility cost against current MessagePack. Schema evolution,
framing/limits, unknown fields, validation and mixed-peer behavior are gates.
Packed representation and zero-copy claims must be qualified separately for the
actual bindings and buffer lifetimes. No codec replacement based on size estimates.

### O5. Shared Rust libraries and direct operations

**Deferred by user to 0.2.357 (2026-10-25).** Preserve the isolated PoC and
results below; no production integration belongs to .356. The continuation
owner is ../release_0_2_357/PLAN.md and its TRACKER.md. This deferral does not
authorize production changes or a version bump.

2026-10-25 approved first proof: prioritize **final product size, duplicated
build work and developer ergonomics**, not runtime/request speed. Isolated
framework/shared_runtime_probe compares two static consumers against two
matched-toolchain Rust-dylib consumers of one concrete Tokio/Hyper/gzip runtime.
Count the entire distribution, including dynamic Rust std, using identical
implementation/dependency locks and ZIP settings. Measure target-cold/cached-
source, no-op and private-implementation-change builds; inspect actual Cargo
consumer recompilation. This is a matched-set ABI experiment, not stable public
Rust ABI, zero-copy work or a production dependency/pipe migration. Linux first;
Termux, private Python, wheel loader/receipt integration and production adoption
remain separate. PyO3 is not duplicated between framework and editor worker.
User confirms Ferrous is additive/backward-compatible; align framework to worker
pin only in a separately approved production integration, not in this fixture.

Approved scratch cleanup first reclaims ~3.3 GiB from obsolete .354 APK trials
and extracted inspection JAR, with exact recovery log losslessly compressed.
Active/previous mypyc selectors, compiler caches/snapshots, current APK/mapping
and release artifacts remain. Probe builds preserve isolated targets, require
2 GiB free and stop their own build process group below 1 GiB.

User subsequently clarifies the intended candidate is a **stripped cdylib**, not
the initially tested ordinary Rust dylib. Approved isolated follow-up now exposes
only a version check and bounded caller-owned byte-buffer operation; no Rust
types, allocator ownership or Future crosses. Compare equally stripped static
consumers, include all client/library bytes, test real C-header use, loader/ABI
failures and private implementation-only rebuilds. Tiny fixture result is ~20.6%
net ZIP saving, initial build times essentially tied, with unchanged consumers on
library implementation updates. No production-size estimate, worker/pin/pipe
migration or runtime speed claim. Details: framework/shared_runtime_probe/README.md.

Investigate a shared framework/editor operations crate and separately evaluate
runtime shared-library packaging/linking to reduce duplicated binaries/build work.
A shared source crate is not proof of smaller shipped binaries. Compare actual
wheel/APK/native sizes and clean/incremental build times, with Linux private Python
and Termux ABI/loader/toolchain constraints included.

Explore direct Code TE2 *ops-library calls using the same typed structures used
before pipe enveloping, reducing appropriate pipe routes without cloning operation
implementations. Framework-owned state/authorization/scheduling must not become
two independent owners merely because both binaries link a library. Decide which
stateless operations can be shared directly versus operations that must still
reach the authoritative framework owner. Earlier shared-library deferral in
../release_0_2_354/PLAN.md is background, not new implementation approval.

### O6. Desktop/mobile localhost transport mode

For selected mission-critical local streams (WBA is the user's example), explore
Node IPC instead of WebSockets/namespaces in Electron and applicable mobile hosts.
Qualify available Node/native bridges and secure renderer access in each client;
do not assume every mobile renderer has Node or localhost proves same-device
ownership (remote servers are transparently proxied as loopback).

Local selection needs explicit verified runtime/endpoint capability. Preserve the
remote transport, exact-client isolation, session/generation fencing and stream
semantics. Compare the IPC path to the existing implementation before expanding
scope. This is selected-stream experimentation, not removal of all sockets.

### O7. Frontend Cap'n Proto packed-stream experiment

User specifically requests a frontend packed-stream proof, using Socket.IO binary
frames where appropriate. Start with bounded initialization/CRUD DTOs as a candidate
corpus; WBA suitability remains open because extension-produced data is varied.
Inventory browser/TS bindings, bundle/runtime requirements and schema coverage;
measure payload, CPU, allocations, decode stalls and client compatibility against
current MessagePack. Typed envelope/control data and opaque extension payloads
may need different treatment. Do not assume every extension object fits a fixed
schema or that opaque JSON requires replacing the complete transport.

### O8. WBA raw-socket and compression experiment

Explore raw sockets with internal client/session IDs, drawing on ALS conversation
history identity patterns where applicable. First inspect those actual patterns;
do not import another app's backend or equate conversation identity with a WBA
connection. Preserve registration, exact-client routing, request correlation,
timeouts, provider/document generations, disconnect invalidation and no replay.

Evaluate compression plus MessagePack (and optional candidate codec) using real
WBA payload distributions: tiny event streams, large responses, local/remote
latency and CPU on Termux. Compression remains an open trade-off, not an enabled
default. Keep socket transport, serialization and compression experiments separate
so results can identify which change helps. No raw-socket rewrite is approved yet.

### O9. Document-relevant WBA provider publication (separate pass)

User observes early provider/references events for typescriptreact with resync=true
and asks to defer irrelevant language data until files are opened. Read-only
source tracing confirms these are language-feature provider registrations, not
TextMate grammar bodies or a Markdown grammar dependency transfer.

Current owners/evidence:

- extensions/provider-registry.ts buildResyncEvents enumerates retained providers
  and emits individual kind/handle/language registrations across their selectors.
  Normal registration also produces per-language events; filtering resync alone
  would leave live registration traffic untouched.
- client/workbench-client.ts resync replays those events via onEvent, along with
  workspace readiness, diagnostics and webviews. Keep those different event owners
  separate; provider optimization must not discard readiness or diagnostics.
- server/event-bridge.ts emits te2.event through wsBroadcastNotification; the
  editor-socket.ts sender broadcasts events without clientInstanceId to all editor
  sockets. Thus a client's resync replay can also reach already connected clients.
- monaco_editor/m_editor_app.ts requests te2.resync on WBA connection and later
  adapter.providers with empty params for full provider-snapshot hydration.
  Investigate overlap rather than claiming either path can simply be removed.

Intended direction to investigate/approve: retain the complete authoritative WBA
registry, but publish a document-relevant projection per client/presentation, lazily
adding matching capabilities on open/model language change/reconnect. Reuse known
document lifecycle where possible instead of adding a per-provider round trip.
Scope replay to its requester and consider bounded snapshot batching/deduplication.
New clients/servers must negotiate or retain the legacy behavior explicitly.

Do not filter solely by filename extension or one globally active language: account
for full document selectors (language/scheme/pattern), wildcard providers, embedded
languages, multiple open documents/clients and provider retirement/generation.
Actual semantic-token legends are a separate per-provider decoding requirement
when that provider applies; language catalog/configuration metadata and TextMate
catalogs serve other consumers and are not automatically this optimization target.
Measure event count/bytes and initialization/model-switch correctness before a
cutover. This source survey/proposal does not approve WBA implementation yet.
User explicitly defers this work when requesting the accepted checkpoint and
moving to Sidebar/intent work; do not start O9 as the next slice.

### Common decision gates and investigation order

1. Phase 1 startup is user live accepted. Begin Phase 2 O1 source/contracts audit
   next, then obtain its concrete implementation approval.
2. Phase 3 O2 follows O1; native console work is Phase 4 after both, not a
   follow-up validation phase. Each has tests and live acceptance within it.
3. Use O1 contracts and O2 queue evidence to inform later O3/O6/O8 prototypes;
   O4/O7 codec proofs and O5 library audit can be evaluated independently.
4. For each candidate, present a bounded implementation/rollback plan and obtain
   approval. Preserve current transport until parity/compatibility is established.
5. Keep separate measurements for startup round trips, sustained throughput,
   tail latency, memory, compressed bytes and build/package cost. No unsupported
   performance claim, automatic speed-based transport selection or mutation retry.

This is a provisional dependency-aware investigation order, not a promise to ship
all eight items in .356. User can reprioritize as the optimization list develops.

## Deferred — standalone Terminal headless projection audit / Pyte alternative

User requests planning only while testing the network ingress slice. Standalone
Terminal rendering/restoration feels janky compared with the existing Pyte-based
implementations, including File Explorer's independent Node PTY backend. This is
user-observed behavior, not yet a diagnosis of headless xterm or proof that a
replacement is required. Do not interrupt the current testing or change runtimes.

First audit the pinned xterm-headless/SerializeAddon configuration and actual
checkpoint/restore flow. Reproduce and distinguish live-output issues from
projection serialization/replay, resize ordering, cursor/application/mouse modes,
alternate-screen state, colors, scrollback and reconnect. Compare the same
bounded PTY output/resize/reload sequences against File Explorer and the drawer;
do not infer parser correctness or latency from appearance alone.

If a bounded configuration/restore fix cannot resolve it, evaluate replacing
only standalone Terminal's headless screen projection with the shared app-neutral
Pyte machinery. File Explorer already uses its own node-pty worker/raw byte
offsets plus Pyte checkpoint parsing off the live-output path. Reuse that neutral
library/pattern, never another app's backend, shellspec or session implementation.
Keep browser xterm.js as the renderer; this proposal does not replace it with
Pyte or remove the Node PTY shell merely to change screen projection.

Before implementation, qualify ANSI/Unicode/wide-cell and truecolor fidelity,
cursor/mouse/application modes, alternate screen, resize/reload/reconnect,
scrollback expectations, raw stream ordering/gap detection, checkpoint identity,
resource use and shell/session lifetime. Preserve each app's existing ownership,
input behavior and transport. Present a concrete repair versus replacement scope,
parity tests, rollback and grouped live checks for approval. No new dependency,
transport cutover or migration is authorized by this planning entry.

Source orientation: app/apps/terminal/terminal_stream_broker.mjs and package.json;
app/apps/file_explorer/TERMINAL.md; app/libs/terminal_runtime/README.md.

## Deferred — ALS renderer-owned Markdown file actions

User explicitly defers implementation (2026-10-21); this is an end-of-plan
follow-up, not a release blocker or permission to begin source changes.

Classify filesystem destinations while rendering Markdown and produce explicit
file-open action markup carrying path/line/column, rather than ordinary
HTTP-resolvable anchors intercepted by a generic click handler. Activation must
reuse ALS's existing own-backend file-open RPC and framework-pipe routing;
rendering/streaming/replay must never execute an operation. Preserve normal web
links, keyboard/accessibility behavior and exact-client/presentation admission.
Qualify both streaming and finalized/replayed rendering, absolute/relative paths,
encoded paths, #L198/#L198C4 and supported colon coordinates. File links should
not expose bogus localhost URLs in native long-press/link menus; choose a
file-aware action/context-menu affordance without relying on file:// navigation.

Read-only evidence: the live APP_RPC.md anchor retained its correct raw
filesystem href and #L198 hash, with link routing bound and the hash recognized.
The native long-press menu displayed the browser-resolved .href on the current
loopback origin; ordinary clicks are user-confirmed working after the pipe
receiver correction. This is separate from the compiled DTO/intent failure.
Obtain a concrete renderer/interaction/test approval when this item is resumed.

## Deferred — shell execution profiles and command-palette terminal commands

User intake 2026-10-25; record only, then return to the logging/native-debug
work. This does not authorize implementation or change the release cut line.

- Add a shell-execution run-profile type: execute the configured shell command
  in the running editor terminal, or open/create one when necessary, using the
  same execution/terminal ownership as the built-in Python/Node/GCC runners.
  This is not a new web-server/preview profile or another shell backend.
- Support current-file self-reference in command templates: `%` for the current
  file and `%<` for its extensionless counterpart. Preserve the user's example:
  `gcc % -o %< && ./%<`. Allow additional run arguments appended to the command
  tail. Before implementation, qualify existing runner substitutions, cwd/path
  conventions, shell quoting (spaces/Unicode/metacharacters), placeholder
  escaping and argument placement for compound commands; reuse existing helpers
  instead of inventing an incompatible substitution/dispatch system.
- Add a root command-palette option that accepts a shell command and executes
  it in that same editor-terminal path, opening a terminal if needed. Typing or
  previewing the palette entry must not execute it; explicit acceptance does.
- Whenever a user action invokes the editor terminal (including run profiles,
  palette execution and existing terminal-open actions), reveal it and transfer
  keyboard focus from the editor to the terminal after it is ready. Preserve
  exact-client ownership; background updates/restoration must not steal focus.

Implementation requires a bounded source-backed plan/approval and tests for
existing-terminal reuse, creation/readiness, active-file substitutions, trailing
arguments, explicit palette acceptance/cancellation and focus on desktop/mobile.
Preserve existing run/save/draft consent and disconnected/no-replay behavior.

## Deferred — Cefrium 0.13 staging comparison (before CDP work)

User defers this trial to the end of the plan, immediately before remaining
CDP/MCP work (2026-10-25). No SDK upgrade or build is authorized now.

Compare current validated Cefrium 0.9 staging APK (166.8 MiB, SHA256
4db25163e2da4526db8425b99de1282a3f93d67b84bab949c61e94c350283814)
against 0.13.0 with equivalent source/settings, allowing required compatibility
adaptations to be explicitly recorded. The 0.12 fixes inherited by 0.13 remove
overly broad Chromium consumer keep rules, so larger native libraries alone do
not determine final APK size. Measure compressed native libraries, DEX, resources
and total APK; do not assume upstream optimization percentages apply to TE2.
Audit dependency changes and query-origin/subframe-policy migration, preserve
security guards, then obtain bounded implementation/build approval. Preserve
baseline APK and R8 mapping before replacement; verify manifest/resources,
signature/alignment and runtime parity. Missing-manifest packaging cause remains
unproven and separate. Require adequate disk headroom or an approved alternate
build host; last local observation was only 1.5 GiB free, not build-ready.
Primary release evidence: https://cefrium.com/releases/.

## Deferred — remaining console / native-debug MCP work

User defers the rest of this workstream on 2026-10-25. Keep implemented quiet
registration/eval policy and the current Cefrium socket fix; its APK live
acceptance remains open while the user builds/tests. Native CDP targets/eval/
on-demand errors through MCP, ALS producer/snapshot changes, broader producer
audit and client-local disk history all remain backlog, not the next task.
Do not require native debugger replacement to keep the working console control
lane. Gecko debugging stays on the user's other branch. Resume only on explicit
reprioritization and concrete approval; preserve prior contracts/evidence above.

## Deferred — native CEF DevTools transport

User requests end-of-list deferral (2026-10-25), not implementation or a release
blocker. Retain the current process-owned socket/CDP relay fix.

Investigate replacing the embedded inspector's socket discovery/WebSocket relay
with CEF's native `SendDevToolsMessage` / `ExecuteDevToolsMethod` and
`AddDevToolsMessageObserver` APIs. These still carry CDP; they do not require an
active remote-debugging session. Check whether the pinned Cefrium SDK exposes
the bindings before proposing JNI/upstream work. Qualify browser ownership,
iframe/session coverage, inspector request/event routing, threading, observer
disposal and renderer lifecycle parity. Do not assume a speedup or slowdown.
Preserve external CDP access where useful; no console-bridge dependency or
debugger-policy change. Resume only with a bounded source-backed plan/approval.
## Restored extension views: readiness admission

Preserve persisted sidebar visibility/order/placement while the WBA starts.
Backend sidebar projections carry transient per-surface readiness; saved URLs
are not evidence that a fresh extension-host surface exists. All frontend mount
paths wait for their matching surface confirmation and resume through normal
sidebar-state notifications. Reset admission on WBA session loss without deleting
saved membership. Cold resync is non-pruning until primary activation completes;
individual available views may mount during staggered activation.

## Final candidate evaluation — GekkoTron

User requests this as the final candidate to examine for the upcoming release
(2026-10-26), after the other selected work. GekkoTron is the user's independent
desktop/mobile Electron/GeckoView port. It may not yet be ready. Its name records
the requested project, not a renderer replacement already adopted by TE2.

Before any integration, inspect the current source/API and build state; qualify
client/preload bridges, local/remote launch, asset routing, identity, scale/input,
debugging and lifecycle/security boundaries. Obtain a bounded trial/build plan,
adequate disk headroom and grouped device acceptance approval. Compare complete
artifact size and functionality against the existing clients. Do not migrate
Android or replace a shipped renderer under this scheduling note. Defer if the
candidate is not ready; adoption and release-blocking status require a separate
user decision. Existing deferred work does not automatically resume ahead of it.
