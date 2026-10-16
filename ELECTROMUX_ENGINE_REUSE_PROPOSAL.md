# Proposal: browser-engine-backed Electromux runtime

Status: proposed; first investigation after the 0.2.354 release.
Recorded 2026-10-16 at TE2 checkpoint `2e77c843`.
Not a release blocker or permission to replace the accepted embedded Node runtime.

## Objective

Investigate replacing Electromux's separately bundled libnode with a Node-compatible
runtime that reuses the JavaScript engine already shipped by the browser:
Cefrium/CEF's V8 or GeckoView's SpiderMonkey. Preserve useful Electron-compatible
APIs, existing browser hooks and TE2 Termux behavior. Keep generic runtime work
framework-independent; TE2 remains a consumer, not the runtime implementation.

The current Termux APK comparison measured libnode at approximately 26 MB
compressed (87.7 MB uncompressed). This is a gross removal opportunity, not a net
savings prediction: replacement WASM, host bindings and native services cost bytes
and may affect memory, startup and execution speed.
See `docs/apps/release_0_2_354/TERMUX_COMPRESSION_AUDIT.md` for artifact evidence.

## Candidate and evidence boundary

[EdgeJS](https://github.com/wasmerio/edgejs#host-javascript-wasix-package) has an
experimental engine-free WASIX package. Its WASM imports `napi` and
`napi_extension_wasmer_v0`; the host supplies these interfaces using its own engine.
It does not embed V8 or QuickJS in that mode. This is more relevant than simply
compiling another native runtime with another JavaScript engine.

Its [architecture](https://github.com/wasmerio/edgejs/blob/main/ARCHITECTURE.md)
separates engine adaptation from runtime/system bindings. Browser JavaScript
execution alone does not supply Node filesystem, networking, subprocess, module,
event-loop or native-addon semantics. Node compatibility must be demonstrated
against our actual application dependencies, not inferred from the project title.

[GeckoView's bundled WebExtensions](https://mozilla.github.io/geckoview/consumer/docs/web-extensions)
provide background scripts and native messaging: a possible no-fork starting
point, not verified EdgeJS compatibility. CEF exposes
[V8 contexts in renderer/worker threads](https://cef-builds.spotifycdn.com/docs/115.3/classCefV8Context.html);
the corresponding Cefrium bindings still need a source audit. A hidden/offscreen
browser is not necessarily renderer-process-free, and neither surface proves
background execution survives navigation, activity recreation or process loss.

EdgeJS documents [deferred host-JS security and retention work](https://github.com/wasmerio/edgejs/blob/main/SECURITY-HOST-JS-NAPI.md).
Treat host realms, object handles, buffer ownership and capability admission as
explicit engineering gates, not an already-established sandbox.

## First post-release procedure

1. Inventory Electromux's real Node dependencies and native capabilities, including
   filesystem, child processes, streams/FD3, IPC, timers and shutdown. Separate
   generic Electron-subset requirements from TE2 consumer policy.
2. Pin and inspect EdgeJS plus its required host/WASIX implementation. Establish
   the exact browser imports, threading/shared-memory/CSP requirements and native
   services needed; identify any external networking proxy requirement.
3. Audit the pinned GeckoView and Cefrium APIs for a background execution context,
   native capability bridge and lifecycle ownership. Prefer an existing API over
   a fork. Do not assume a Gecko migration or a small fork is necessary/sufficient.
4. Propose an isolated, framework-agnostic sample and obtain implementation scope
   approval. Prove engine reuse without libnode before integrating TE2 or changing
   the production host. Preserve the accepted Node build as the comparison lane.
5. Run the actual controller workload and Electron compatibility sample, then
   compare APK size, startup, idle/peak memory and IPC responsiveness on-device.
   Decide whether to proceed, contribute upstream, fork narrowly, or retain Node.

## Proof-of-concept acceptance gates

- [ ] Identify a feasible engine/context path and document any required fork.
- [ ] Run JS/module loading and asynchronous callbacks without a second JS engine.
- [ ] Prove real filesystem, subprocess, stream/pipe and cancellation semantics;
  arbitrary native Node addons are not assumed compatible.
- [ ] Keep privileged runtime capabilities unavailable to untrusted remote pages;
  preserve exact caller identity and existing browser/CEF hooks.
- [ ] Survive frontend reload/navigation and Android activity recreation with
  explicit runtime ownership; process death has defined recovery, not silent replay.
- [ ] Check long-running handle/buffer cleanup, teardown and bounded resource use.
- [ ] Demonstrate the calculator and TE2 Termux controller workloads without
  breaking the existing embedded-Node application.
- [ ] Measure net downloadable and installed size, memory, startup and interaction
  cost against matched Node-backed builds; report limitations honestly.

## Scheduling and exclusions

Start with the read-only feasibility/dependency audit immediately after this
release, ahead of other deferred platform experiments. This proposal does not add
runtime changes, browser migrations, forks, builds, installation, publication or
Node removal to the current release scope. Future implementation needs its own
approved plan/tracker and independently scoped Electromux changes.
