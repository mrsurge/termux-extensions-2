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
2. Persist Cefrium's selected supported Tools tab. Scope overlay visibility to
   one native app-header session and start each new header with Tools closed.
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
6. Scope Inspector runtime/browser lifetime to one native app-header appearance.
   Start it in the background after the main Cefrium browser completes a real
   framework-relay app document navigation, and retain it while Tools is hidden,
   another Tools tab is selected, or the app is backgrounded. Destroy it when
   the header disappears or the app returns to the launcher.
7. Treat the Inspector document's `client_ready` query as its readiness
   authority. Browser-wide loading callbacks include Chii child-frame loads and
   must never clear client readiness or target-generation delivery; doing so
   creates a `target_reset` -> iframe recreation -> load callback feedback loop.
8. On the first gear open in each header session, force-reselect the first
   available target exactly once, including an already-active sole target. If
   discovery has not produced a target, retain the one-shot request until it
   does. This intentionally executes the proven target-switch reset path.
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

## Phase 8: Deterministic Model Transitions

This is a cross-client Code TE2 correction. Cefrium and Gecko expose the race
more readily because mobile scheduling stretches the interval between two
competing open paths; the intended result is one deterministic transaction on
every renderer.

1. Make the post-visible-verification `openFileFlow` call the sole canonical WBA
   open for a foreground file transition. Visible open completion remains
   independent of WBA acknowledgement.
2. Restrict `editor.modelReady` to backend notification. It must not initiate a
   second WBA open or hydrate the complete provider snapshot.
3. Remove `te2.resync` from the Python `modelReady` handler. Full WBA provider
   and webview resync is reserved for genuine frontend connection/reconnection,
   not ordinary model switches.
4. Make WBA same-path, same-generation opens idempotent. A duplicate must not
   reread disk, replace full text, clear dirty state, increment the document
   version, emit another active-document transition, or invalidate prewarmed
   semantic tokens.
5. Create and attach the replacement Monaco model before disposing the detached
   previous model. Disposal must never briefly leave the visible editor bound
   to a disposed model.
6. Preserve the existing draft-safe foreground synchronization barrier and the
   authoritative Python open-state projection. This phase removes duplicate
   work; it does not move active-file authority into the browser or WBA.
7. Add transaction-scoped timing and focused regression coverage proving one
   visible verification, one canonical WBA open, no per-open global resync, and
   no same-generation full-text replacement.

## Phase 9: Rust Proxy And Pipe Scheduling

The Rust framework is already a multi-threaded Tokio server. The first fixes
must remove synchronous work from its request and async dispatch hot paths;
adding processes or worker threads before that would preserve the underlying
contention while adding state-coordination complexity.

1. Retain the loaded `AppRegistry` in `AppState` behind shared read ownership.
   Refresh it only through explicit registry reload rather than reconstructing
   it during every dynamic app-proxy request.
2. Build an in-memory running-app index from one startup Framework-Shells
   snapshot plus existing start/stop/lifecycle events. Proxy lookup must not
   scan every FWS metadata directory, parse every `meta.json`, and probe
   `/proc/<pid>/stat` for each request.
3. Preserve exact app-worker identity and stale-process handling while moving
   those checks to lifecycle reconciliation. A request may perform a bounded
   validation only when its indexed entry is ambiguous or stale, not as the
   normal path.
4. Replace direct blocking Ferrous pipe writes from async dispatch tasks with
   one bounded, ordered writer queue and dedicated blocking writer task/thread
   per app-worker pipe bridge.
5. Define queue backpressure and shutdown behavior explicitly: required
   responses and ordered events cannot reorder or disappear; a closed or failed
   writer fails pending sends deterministically and does not block a Tokio
   worker indefinitely.
6. Re-run proxy/direct latency and file-switch traces after both changes. Tune
   Tokio worker count or consider process separation only if evidence still
   shows scheduler starvation after synchronous scans and writes are removed.

## Validation

Code TE2:

```bash
cd app/apps/code_te2
npm run typecheck
node build.mjs
```

Rust framework:

```bash
cd framework/rust
cargo fmt --all -- --check
cargo check -p te2-server
cargo test -p te2-server
```

Focused regression coverage must additionally exercise duplicate foreground
open coalescing, true WBA reconnect resync, dynamic app-proxy lookup after app
start/stop/reload, ordered pipe delivery, writer failure, and queue shutdown.

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
- Console/Processes selected-tab state survives Activity recreation; Cefrium
  overlay visibility resets for each new app-header session.
- Cefrium remote-app fallback matches GeckoView's authoritative health rule.
- Registered Cefrium dev-runtime surfaces are validated and retained by exact
  `surfaceId`, with cache and console-injection capabilities reported as false.
- A source-backed Inspector decision identifies the real Cefrium/Chromium
  transport and whether Sidebar surfaces are targets, frames, or execution
  contexts. A working implementation is browser-wide unless the runtime proves
  profile-scoped attachment is necessary.
- Cefrium starts its Inspector only after the main app page completes its first
  relay-origin navigation. The first gear open force-reselects the first target
  once, including a self-selection, while overlay close and app background keep
  the session alive. Launcher return removes the header and destroys the
  Inspector runtime/browser/targets.
- Focusing Monaco Find or Replace does not change the Cefrium visual viewport
  scale or leave the page zoomed.
- Cefrium native context actions execute against ordinary editable/selected
  content and do not conflict with Monaco's custom touch menu.
- Header mutation and console-injection gaps remain explicit rather than being
  conflated with the separate native Inspector transport.
- A foreground file transition performs one canonical WBA open only after the
  expected Monaco URI is attached and visible. `modelReady` causes no provider
  replay, duplicate document open, disk reread, or dirty-state reset.
- Genuine WBA frontend reconnect still receives the complete provider/webview
  resync projection, while ordinary file switches do not.
- Dynamic app proxying resolves from current in-memory registry/runtime state;
  the normal request path performs no complete FWS metadata or `/proc` scan.
- Ferrous app-worker pipe output preserves strict ordering without performing a
  blocking write on a Tokio runtime worker.
- Mobile local file-switch and proxied-request latency no longer depends on a
  timing race that a faster desktop processor merely hides.
- GeckoView comparison tests/build continue to pass.
