# Cefrium Parity And Mobile Semantics Tracker

## Status

- Branch: `feature/cefrium-parity-mobile-ui`
- Base: synchronized `main` at `1b1e80b6`
- State: implementation and automated validation complete; initial native
  Inspector activation accepted, with remaining context-action/lifecycle QA

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
- [x] Cefrium Inspector now initializes directly from a persisted visible
  Inspector tab after the app page loads; it no longer requires opening
  Processes, selecting FWS, and then switching back to the app target.

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
  delivered target generations across child-frame loads, and defer first
  Inspector startup until the main relay-origin page has loaded and Inspector
  is visible.
- [x] Add unit coverage for the deferred-start and one-delivery-per-generation
  lifecycle gates; `:cefrium:testDebugUnitTest` and `:cefrium:assembleDebug`
  pass.
- [x] Reconcile every Inspector activation edge: a not-yet-ready document
  explicitly reasserts `client_ready`, while an established document receives
  the authoritative target snapshot and current generation. Duplicate
  generation replay is idempotent and does not recreate Chii.
- [ ] Verify hidden, reopened, navigated, detached where applicable, and removed
  Sidebar surface lifecycle.

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

## Deferred

- The completed parity slice, Cefrium Find zoom correction, and direct initial
  Inspector activation have live user acceptance. Broader hidden/reopened
  Inspector lifecycle, native context actions, and magnifier still require
  targeted device QA.
- Cefrium Run Profile cache-header mutation and cross-origin console injection
  remain deferred until the SDK exposes response mutation or child-frame/CDP
  control. The native registry reports both capabilities as false.
- Broad visual redesign follows live Cefrium inspection rather than being
  inferred during this parity slice.
