# Cefrium Parity And Mobile Semantics Tracker

## Status

- Branch: `feature/cefrium-parity-mobile-ui`
- Base: synchronized `main` at `1b1e80b6`
- State: Cefrium parity implementation and automated validation complete;
  native Inspector app-header lifecycle and initial target reselection accepted.
  Cross-client model-transition and Rust scheduling fixes are implemented and
  automated validation is complete; post-restart latency traces remain pending.

## Source-Backed Findings

- [x] Cefrium already shares `PersistentNetworkService`,
  `AndroidFrameworkRelay`, Run Target listeners, UI IPC, native console,
  settings, assets, clipboard permission, context menus, and renderer recovery.
- [x] Before this branch, Code TE2 interpreted `gv_native=1` without Electron
  as Gecko, causing Cefrium to wait on a Gecko-only identity bridge.
- [x] Cefrium 0.7.0 exposes a page query handler suitable for exact-origin
  native commands.
- [x] Cefrium lacks Tools persistence, the Processes browser, and GeckoView's
  remote-app health fallback.
- [x] Cefrium's high-level wrapper does not expose CDP, but its bundled
  Chromium runtime includes `DevToolsServer`, browser target discovery, and
  flattened target sessions. A narrow app-private bridge is sufficient.
- [x] Cefrium request interception can observe or block requests but cannot
  safely provide Gecko-style response-header mutation or child-frame script
  injection by itself.
- [x] The Rust server is already multi-threaded: the inspected release runtime
  used 18 Tokio worker threads. Process splitting is not the first remedy for
  the observed mobile latency.
- [x] Before the deterministic-transition fix, foreground model switching had
  two WBA open initiators. The
  `modelReady` path starts a WBA open and full provider/webview resync before the
  open transaction performs its canonical post-visibility WBA open.
- [x] On a slower client, the first open can settle before the second reaches
  WBA, turning coalescing into a real same-file reopen. That path rereads disk,
  replaces full text with `dirty=false`, emits another active-document change,
  and forces draft, diagnostic, and semantic-token recovery work.
- [x] Live WBA traces captured duplicate open sequences, including one
  same-file reopen whose full-text replacement advanced the model from v1 to
  v2. Provider hydration ranged from roughly 150 ms to 1.66 s, while ordinary
  WBA document-open processing was generally 1-6 ms.
- [x] Before the Rust scheduling fix, dynamic app proxy lookup reloaded app
  registry state and scanned
  Framework-Shell metadata plus `/proc` process state synchronously on the
  request path. The inspected runtime had 169 metadata records.
- [x] Before the Rust scheduling fix, app-worker pipe reads ran through
  `spawn_blocking`, but async dispatch could still invoke the blocking
  pipe-write function directly on a Tokio worker.

## Implementation

- [x] Add explicit renderer/capability projection to Android app URLs.
- [x] Add origin-gated Cefrium identity read/reset query commands.
- [x] Update Code TE2 identity resolution and tests.
- [x] Share native Tools state and remote-app health models.
- [x] Add Cefrium Processes browser and persistent Tools selection.
- [x] Add Cefrium remote-app health fallback.
- [x] Add Cefrium Run Profile surface registration/release.
- [x] Prove relay-owned exact-origin no-store policy is not safely available:
  Run Target listeners bypass `AndroidFrameworkRelay`, and Cefrium cannot
  mutate response headers.
- [x] Prove safe child-frame console injection is unavailable through the
  public Cefrium API and report that capability as false.
- [x] Consolidate shared native mobile labels/styles/content descriptions.
- [x] Remove remaining Gecko-specific frontend semantics from generic native
  mobile paths.
- [x] Update the isolated Cefrium plugin and SDK pin from removed `0.6.3` to the
  currently published `0.7.0` artifact.
- [x] Preserve the established Gecko installation identity for older APKs that
  receive the new frontend through OTA with only `gv_native=1`; retain strict
  failure for unknown explicit renderers and forward valid markers in the app
  shell.

## Validation

- [x] Focused Code TE2 native identity/Run Target tests (9 passed after legacy
  Gecko OTA compatibility coverage).
- [x] Code TE2 typecheck.
- [x] Code TE2 bundle build.
- [x] Cefrium unit tests.
- [x] Cefrium debug assembly.
- [x] GeckoView comparison unit tests.
- [x] GeckoView comparison debug assembly.
- [x] `git diff --check` across editable source and documentation.
- [x] Deterministic-transition focused tests: 32 passed.
- [x] Python `editor_ws.py` bytecode compilation.
- [x] Rust formatting and default/native-feature checks.
- [x] Rust native-feature suite: 80 passed, 4 benchmark tests ignored.
- [ ] Full generated-artifact `git diff --check`: the canonical esbuild output
  contains upstream Monaco/highlight.js template-literal lines with significant
  trailing spaces. The source/build validation passes; do not rewrite those
  embedded strings merely to silence Git's whitespace heuristic.

## Live Acceptance

- [x] User accepted the completed pre-investigation Cefrium parity slice on a
  live device on 2026-08-15.
- [x] Explicit Cefrium identity and legacy Gecko OTA identity both load Code
  TE2 with their stable native installation identity; WBA/extension-host state
  no longer enters the wrong bridge or times out.
- [x] Cefrium native launcher/relay behavior, Console and Processes Tools
  surfaces, persisted Tools state, remote-app health behavior, and Run Target
  registration operate correctly in the live application.
- [x] The shared changes did not regress the live GeckoView comparison client.
- [x] Cefrium Inspector now starts in the background after the app page loads.
  The first gear open force-reselects the first available target once, so the
  user no longer has to open Processes or manually switch away and back.
- [x] User accepted the app-header-scoped Inspector lifecycle and automatic
  same-target nudge on a live Cefrium device on 2026-08-16.

## Inspector And Target Ownership

- [x] Inventory Cefrium 0.7.0 SDK/AAR, generated bindings, runtime switches,
  and official APIs for native DevTools or CDP transport.
- [x] Prove a complete Kotlin-to-Chromium command/event path and identify the
  compatible DevTools frontend.
- [x] Inspect the Cefrium ownership model and determine whether Sidebar slots
  are targets, OOPIFs, ordinary frames, or execution contexts.
- [x] Decide and document browser-wide Inspector ownership versus Run
  Profile-scoped ownership. Default to browser-wide selection for every live
  Sidebar surface; keep `devRuntime` limited to cache/console policy.
- [x] Keep iframe inspection under its browser page target rather than inventing
  a second `surfaceId`-to-CDP target authority.
- [x] Implement the native Tools target picker and Inspector after the
  transport is proven.
- [x] Trace the live Inspector reload loop to Cefrium's browser-wide loading
  callback observing Chii's child iframe and clearing target delivery on every
  nested load.
- [x] Make `client_ready` the Inspector document-readiness authority, preserve
  delivered target generations across child-frame loads, and start the
  background Inspector only after the main relay-origin app page has loaded.
- [x] Add unit coverage for the deferred-start and one-delivery-per-generation
  lifecycle gates; `:cefrium:testDebugUnitTest` and `:cefrium:assembleDebug`
  pass.
- [x] Scope Inspector lifetime to one native app-header appearance. Overlay
  close, tab changes, and app background retain it; launcher return or header
  removal destroys its browser, CDP runtime, targets, and one-shot state.
- [x] Force-reselect the first available target on the first gear open, even
  when that target is already active; defer the one-shot until discovery when
  necessary.
- [ ] Verify detached where applicable and removed Sidebar surface lifecycle.

## Monaco Focus Zoom

- [x] Capture live pre/post-focus viewport, active-element, computed-style, and
  browser zoom evidence for the Monaco Find input.
- [x] Locate and compare the existing Monaco textarea/mobile zoom correction.
- [x] Identify Chromium small-input auto zoom from the 13 px Find textarea.
- [x] Implement a Cefrium-only 16 px effective input size under the explicit
  native renderer marker.
- [x] Verify Find focus keeps `visualViewport.scale === 1` on the live Cefrium
  client. Automated Gecko and frontend comparisons pass.
- [ ] Verify Replace, keyboard lifecycle, orientation, and unchanged Gecko
  and desktop behavior.

## Native Context Menu

- [x] Inspect Chromium's selection implementation and determine whether
  registration, item mapping, Android presentation, or
  Cefrium command execution is failing.
- [x] Restore native Cut/Copy/Paste/Select All and applicable link/navigation
  actions through Chromium's own ActionMode helper.
- [ ] Verify Monaco, ordinary inputs, selected page text, and links without
  interfering with the Monaco touch-extension menu.

## Selection Magnifier

- [x] Determine whether Chromium, Cefrium integration, or app configuration
  suppresses selection magnification.
- [x] Enable Chromium's existing SurfaceControl magnifier; do not add an
  application-owned `Magnifier`.
- [ ] Complete physical-device magnifier acceptance.

## Deterministic Model Transitions

- [x] Make post-visible-verification `openFileFlow` the sole foreground WBA
  open initiator.
- [x] Restrict `editor.modelReady` to backend notification; remove its WBA open
  flush and provider-snapshot hydration.
- [x] Remove Python's per-modelReady `te2.resync`; retain full resync only for a
  genuine WBA frontend connection/reconnection.
- [x] Make same-path, same-generation WBA opens no-op without disk reread,
  full-text replacement, version advance, active-change replay, or semantic
  cache invalidation.
- [x] Attach the replacement Monaco model before disposing the detached prior
  model.
- [x] Add focused tests for one canonical open, reconnect-only resync,
  same-generation idempotence, draft preservation, and model disposal order.
- [ ] Compare mobile and desktop transaction traces after the fix and prove the
  duplicate-open/provider-replay sequence is absent.

## Rust Proxy And Pipe Scheduling

- [x] Store the loaded app registry in shared `AppState` and update it through
  explicit registry reload.
- [x] Maintain a running-app index from startup snapshot and lifecycle events.
- [x] Remove complete FWS metadata and `/proc` scans from the normal dynamic
  app-proxy request path while preserving bounded stale-entry reconciliation.
- [x] Route app-worker pipe output through a bounded ordered writer queue and a
  dedicated blocking writer task/thread.
- [x] Specify and test backpressure, strict ordering, shutdown, and writer-error
  propagation.
- [ ] Re-run direct-versus-proxied request benchmarks and model-switch traces.
- [ ] Consider Tokio worker-count tuning or process separation only if the
  post-fix evidence still shows runtime starvation.

## Deferred

- The completed parity slice, Cefrium Find zoom correction, and app-header-owned
  Inspector activation have live user acceptance. Native context actions and
  magnifier still require targeted device QA.
- Cefrium Run Profile cache-header mutation and cross-origin console injection
  remain deferred until the SDK exposes response mutation or child-frame/CDP
  control. The native registry reports both capabilities as false.
- Broad visual redesign follows live Cefrium inspection rather than being
  inferred during this parity slice.
- Multiprocess proxying and a separate Python worker remain last-resort options.
  They are deferred until deterministic model transitions, cached proxy lookup,
  and nonblocking async pipe dispatch are implemented and remeasured.
