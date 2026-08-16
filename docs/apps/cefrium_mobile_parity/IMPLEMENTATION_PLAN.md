# Cefrium Parity And Mobile Semantics Plan

## Objective

Bring the isolated Cefrium Android client up to the shared behavior already
proven by the GeckoView client. Use Cefrium's public API where it is complete
and narrow app-owned Chromium integration shims where Cefrium omits required
host wiring. At the same time, remove renderer-specific assumptions from Code
TE2's mobile frontend and consolidate the native Android chrome semantics
shared by both renderers.

## Authority Boundaries

- `PersistentNetworkService` owns Android relay, Run Target, UI IPC, native
  console, and stable installation identity state.
- `AndroidFrameworkRelay` owns the browser-facing loopback origin and any
  relay-level HTTP policy.
- Each Activity owns only renderer presentation, native chrome, and callbacks
  into the shared service.
- Code TE2 emits renderer-neutral intent. It must not infer GeckoView from the
  generic native-app URL marker.
- Cefrium gaps must remain explicit when the pinned public API cannot implement
  them safely. The isolated module now pins the only currently published
  Cefrium release, `0.7.0`.

## Phase 1: Explicit Renderer Identity

1. Replace the `gv_native=1 means GeckoView` frontend inference with an
   explicit native renderer marker and capability contract.
2. Install Cefrium's origin-gated query handler before loading framework pages.
3. Expose stable client-identity read/reset through that handler using the same
   Android installation identity owned by the persistent service.
4. Keep Electron, Cefrium, GeckoView, and ordinary browser identity providers
   distinct. A failed native provider must fail explicitly rather than silently
   adopting browser-local identity.

## Phase 2: Native Tools And Health Parity

1. Move renderer-neutral Tools state and remote-app health decisions into the
   shared Android source set.
2. Persist Cefrium Tools overlay visibility and selected supported tab.
3. Add a persistent Cefrium Processes browser loaded from the relay's `/fws`
   path.
4. Apply GeckoView's authoritative remote-app fallback rule to Cefrium: only
   three consecutive authoritative unhealthy snapshots return to the launcher;
   transport or invalid-payload failures preserve the app and reset the count.
5. Keep the current Inspector placeholder honest until Phase 5 proves and
   implements the actual Cefrium/Chromium inspection transport. The absence of
   the GeckoView transport is not evidence that Cefrium itself has no usable
   equivalent.

## Phase 3: Run Profile Dev Runtime

1. Carry Code TE2's existing `RunProfileRuntimeMetadata` through the
   origin-gated Cefrium query bridge.
2. Retain and release exact surface policy by `surfaceId` in Android-owned
   runtime state.
3. Report cache and console-injection capabilities explicitly. Cefrium's public
   request API cannot mutate response headers, and Run Target listeners do not
   pass through `AndroidFrameworkRelay`; do not add a partial raw-HTTP parser to
   the byte-for-byte relay.
4. Inject the TE2 console bridge only if a future Cefrium API can prove the
   exact marked child-frame origin and transform a complete HTML response
   without violating streaming, compression, CSP, or content-length semantics.
   Until then, retain registration for lifecycle/ownership and report both
   instrumentation capabilities as unsupported.

## Phase 4: Mobile UI And Semantic Cleanup

1. Consolidate shared native labels, dimensions, action descriptions, and
   Tools-tab semantics while retaining renderer-specific browser containers.
2. Give native actions stable accessibility descriptions and avoid emoji-only
   semantics without a textual label.
3. Replace Gecko-specific frontend naming with renderer/capability checks.
4. Preserve existing responsive Code TE2 layout, Monaco touch selection,
   special-key dock, and visual-viewport behavior. This phase is cleanup, not an
   unsolicited visual redesign.

## Phase 5: Cefrium Inspector And Target Ownership

1. Start Chromium's app-private `DevToolsServer` and relay its abstract-domain
   socket through a dynamically allocated loopback-only TCP listener.
2. Connect one browser-level CDP control channel, enable
   `Target.setDiscoverTargets`, and attach to the selected page target with a
   flattened session. Framework Socket.IO and UI IPC are not CDP transports.
3. Keep target ownership browser-wide. Independent Cefrium browser instances
   are page targets; Code TE2 Sidebar iframes remain frames/execution contexts
   inside the owning page target and are inspected through that target.
4. Render the authoritative target picker in Kotlin and preserve its selected
   target in Android-owned Tools state.
5. Host the existing packaged Inspector frontend in a separate persistent
   Cefrium browser. Its exact local asset document exchanges raw CDP messages
   through `cefriumQuery`; the Inspector browser itself is excluded from the
   selectable target list.
6. Defer the first Inspector runtime/browser startup until the main Cefrium
   browser completes a real framework-relay document navigation and the
   persisted Tools state actually exposes the Inspector tab. Once started, keep
   that runtime/browser persistent while the Tools drawer is hidden.
7. Treat the Inspector document's `client_ready` query as its readiness
   authority. Browser-wide loading callbacks include Chii child-frame loads and
   must never clear client readiness or target-generation delivery; doing so
   creates a `target_reset` -> iframe recreation -> load callback feedback loop.
8. Treat initial display, return from another Tools tab, and Activity resume as
   idempotent Inspector activation barriers. Reassert `client_ready` when the
   document is not connected; otherwise replay the complete target snapshot and
   active generation. The Inspector document must ignore a replay of its current
   generation rather than recreating Chii.
9. Reconnect the browser control channel event-wise and republish target
   creation, mutation, destruction, attachment, and protocol messages. No
   framework or target polling is permitted.
10. Keep Run Profile `devRuntime` limited to its existing cache/console policy;
   it neither owns nor gates Inspector attachment.

## Phase 6: Monaco Find-Widget Focus Zoom

1. Reproduce the zoom on the live Cefrium worker and record
   `visualViewport.scale`, layout/visual viewport dimensions, active element,
   computed find-input font size, viewport metadata, and browser zoom state
   before and after focus.
2. Compare the find widget with the already-correct Monaco textarea path and
   locate the previous mobile-focus zoom correction. Determine whether Cefrium
   is applying Chromium's small-input focus zoom, a desktop/mobile emulation
   scale, or a renderer-level page zoom.
3. Prefer the narrowest standards-based frontend fix when the behavior is tied
   to the find input, such as a mobile-only effective input font size that does
   not visually enlarge the widget. Use a Cefrium page-policy/browser setting
   only if the browser is overriding otherwise-correct page geometry.
4. Do not disable keyboard focus, find-widget layout, browser accessibility
   overrides, or Monaco's desktop behavior as a side effect.
5. Validate Find and Replace, focus/blur, keyboard open/close, orientation,
   pinch-zoom policy, and `visualViewport.scale === 1` on Cefrium. Compare Gecko
   and ordinary Chromium so a shared CSS change does not regress either.

## Phase 7: Native Context Menu And Selection Magnifier

1. Obtain Cefrium's package-private Chromium `WebContents` through one narrow
   same-package shim. Cefrium creates `SelectionPopupControllerImpl` with an
   empty host callback, which is why native selection ActionMode is absent.
2. Install an application callback that delegates every ActionMode operation
   to Chromium's own `ActionModeCallbackHelper`. Cut, Copy, Paste, Select All,
   link, and navigation behavior remain Chromium-owned rather than recreated
   in JavaScript.
3. Verify long press in Monaco, ordinary text inputs, selected document text,
   and links. The Monaco touch extension may continue to own its custom mobile
   menu, but it must not disable Cefrium's native menu outside that surface.
4. Enable Chromium's existing SurfaceControl magnifier before installing the
   ActionMode callback. Do not create a parallel application-owned magnifier.

## Validation

Code TE2:

```bash
cd app/apps/code_te2
npm run typecheck
node build.mjs
```

Android, after confirming at least 2 GiB free:

```bash
cd android
./gradlew :cefrium:testDebugUnitTest
./gradlew :cefrium:assembleDebug
./gradlew :app:testGeckoDebugUnitTest
./gradlew :app:assembleGeckoDebug
```

Bundled Android asset publication and shared TE2 framework restart remain
outside this slice. Cefrium APK installation is separately approved.

## Acceptance Criteria

- Cefrium no longer waits for or identifies itself through Gecko-only bridges.
- Cefrium has stable native installation identity across page reloads.
- Console/Processes Tools state survives overlay close and Activity recreation.
- Cefrium remote-app fallback matches GeckoView's authoritative health rule.
- Registered Cefrium dev-runtime surfaces are validated and retained by exact
  `surfaceId`, with cache and console-injection capabilities reported as false.
- A source-backed Inspector decision identifies the real Cefrium/Chromium
  transport and whether Sidebar surfaces are targets, frames, or execution
  contexts. A working implementation is browser-wide unless the runtime proves
  profile-scoped attachment is necessary.
- Cefrium starts its Inspector only after the main page completes its first
  relay-origin navigation. A stable target generation loads the Chii frontend
  once and remains delivered across child-frame load notifications. Every
  activation reconciles the existing Inspector client and authoritative target
  snapshot without requiring a different target to be created or selected.
- Focusing Monaco Find or Replace does not change the Cefrium visual viewport
  scale or leave the page zoomed.
- Cefrium native context actions execute against ordinary editable/selected
  content and do not conflict with Monaco's custom touch menu.
- Header mutation and console-injection gaps remain explicit rather than being
  conflated with the separate native Inspector transport.
- GeckoView comparison tests/build continue to pass.
