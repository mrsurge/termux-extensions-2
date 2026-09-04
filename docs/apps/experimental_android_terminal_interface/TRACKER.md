# Experimental Android Terminal Interface Tracker

## Branch And Baseline

- [x] Create `experimental/android-terminal-interface`.
- [x] Record starting snapshot `b8c296c5`.
- [x] Merge the pending release baseline after it is published.
- [x] Confirm the branch contains the release's Terminal, Android, framework,
  and documentation changes before final validation.

## Planning

- [x] Audit current standalone Terminal touch/input ownership.
- [x] Audit current Code TE2 terminal-drawer touch/input ownership.
- [x] Audit xterm selection and buffer APIs.
- [x] Inspect current Android package UIDs, signatures, and SELinux state.
- [x] Confirm one `ParcelFileDescriptor` can represent a full-duplex socket-pair
  endpoint.
- [x] Identify `termux-am`/`app_process` as the Termux-side Android API helper
  precedent.
- [x] Create implementation plan.
- [x] Create implementation tracker.

## Track A: Mobile Xterm Touch Selection

### Gesture ownership

- [x] Define an explicit helper attach/dispose contract.
- [x] Make xterm's source-owned capture/classifier and the shared adapter the
  only active mobile gesture transaction.
- [x] Expose a disposable source-level xterm touch hook to both terminal surfaces.
- [x] Preserve one-finger terminal scrolling.
- [x] Preserve long-press word selection through xterm's own word-boundary
  implementation; finger release must not collapse the selected word.
- [x] Claim touchstart before Cefrium's native context path can blur the IME,
  then replay ordinary xterm mouse input only after a completed tap.
- [x] Preserve double-tap word selection.
- [x] Prevent handle gestures from sending PTY input or stealing IME focus.

### Selection handles

- [x] Render visible start and end handles for active selection.
- [x] Orient the teardrop handles below their selection endpoints.
- [x] Provide at least a 36 px touch target without an oversized visible handle.
- [x] Resolve handle drags three terminal rows above the finger target.
- [x] Position handles from xterm screen geometry and active `viewportY`.
- [x] Update one endpoint while retaining the other.
- [x] Support endpoint crossing.
- [x] Normalize wide-character continuation cells.
- [x] Add whole-row edge autoscroll while dragging.
- [x] Reposition on selection, scroll, resize, font, and visual viewport changes.
- [x] Hide handles for cleared, invalid, off-surface, non-touch, and disposed
  states.
- [x] Dispose DOM, listeners, timers, and animation frames deterministically.

### Selection actions

- [x] Render Copy, Paste, and Select all above the visible selection.
- [x] Keep selection actions from stealing terminal focus.
- [x] Hide selection actions during terminal and handle drags.
- [x] Restore selection actions after the active drag ends.
- [x] Gate handles, selection actions, and custom touch gestures behind the
  established Android/mobile user-agent predicate.

### Surface integration

- [x] Integrate standalone Terminal.
- [x] Integrate Code TE2 terminal drawer.
- [x] Keep helper source copies synchronized or establish one canonical build
  source with generated copies.
- [x] Avoid hand-editing Android bundled asset copies.

### Automated validation

- [x] Test client-point to viewport-cell conversion.
- [x] Test viewport-to-buffer row conversion.
- [x] Test end-exclusive linear selection length.
- [x] Test endpoint ordering and crossing.
- [x] Test edge-scroll transitions.
- [x] Test wide-cell continuation normalization.
- [x] Run standalone Terminal typecheck.
- [x] Run standalone Terminal tests: 22 passed after integration.
- [x] Build standalone Terminal frontend.
- [x] Run Code TE2 typecheck.
- [x] Run the complete Code TE2 browser suite after integration: 287 passed.
- [x] Build Code TE2 frontend.
- [x] Run Code TE2 terminal-screen projection tests after integration: 8 passed.
- [x] Run Electron typecheck, all 100 tests, and compile after integration.
- [x] Run GeckoView and Cefrium debug unit-test tasks after integration.

### Live acceptance

- [x] Pass the initial Android handle, drag-offset, and action-menu smoke test.
- [x] Standalone Terminal on GeckoView.
- [x] Code TE2 drawer on GeckoView.
- [x] Standalone Terminal on Cefrium.
- [x] Code TE2 drawer on Cefrium.
- [ ] Verify selection in scrollback.
- [ ] Verify selection over CJK, emoji, and combining text.
- [ ] Verify handle crossing.
- [ ] Verify edge autoscroll.
- [ ] Verify copy behavior.
- [ ] Verify IME remains stable.
- [ ] Verify resize/reconnect/dispose cleanup.
- [x] Add the required narrow xterm source API and publish the rebuilt browser asset.
- [x] Disable Cefrium main-browser pinch and double-tap zoom through the connected
  Chromium `WebContents`.
- [ ] Suppress the remaining Cefrium page-zoom path; live acceptance proved the
  gesture-manager and ordinary CEF zoom controls are not comprehensive.

## Track B: AIDL And ParcelFileDescriptor Transport

### Android service

- [ ] Add shared AIDL interface.
- [ ] Enable/include AIDL generation in GeckoView and Cefrium modules.
- [ ] Add dedicated exported FD transport service to both manifests.
- [ ] Use an explicit component with no intent filter.
- [ ] Resolve installed `com.termux` UID and reject every other Binder caller.
- [ ] Validate protocol version before descriptor allocation.
- [ ] Create and return one reliable full-duplex socket-pair endpoint.
- [ ] Retain the Android endpoint in a generation-owned registry.
- [ ] Implement deterministic session replacement and teardown.
- [ ] Cover caller rejection, allocation failure, Binder death, and service
  destruction.

### Termux app-process helper

- [ ] Define a reproducible APK/DEX build artifact and source location.
- [ ] Include the same AIDL interface on the client side.
- [ ] Bind explicitly to GeckoView.
- [ ] Bind explicitly to Cefrium.
- [ ] Add bounded bind/acquisition timeout.
- [ ] Receive `ParcelFileDescriptor` under the Termux UID.
- [ ] Connect to the TE2 private Unix-domain handoff socket.
- [ ] Send the descriptor with `SCM_RIGHTS` plus a bounded metadata frame.
- [ ] Close the helper's descriptor copy, unbind, and exit.
- [ ] Emit machine-readable success/failure output.

### Rust handoff probe

- [ ] Add private runtime-root Unix-domain listener.
- [ ] Set restrictive socket permissions.
- [ ] Validate peer UID/credentials.
- [ ] Receive exactly one ancillary descriptor.
- [ ] Reject malformed, missing, duplicate, or excess descriptors.
- [ ] Validate protocol/session preface.
- [ ] Exchange bidirectional challenge/response.
- [ ] Verify traffic continues after the helper exits.
- [ ] Verify EOF and remote error behavior.
- [ ] Emit latency and lifecycle evidence.
- [ ] Confirm no TCP listener or localhost socket participates in the probe.

### Physical-device validation

- [ ] Run with SELinux enforcing.
- [ ] Validate GeckoView package independently.
- [ ] Validate Cefrium package independently.
- [ ] Capture package UID and caller-validation evidence.
- [ ] Capture descriptor handoff evidence.
- [ ] Capture bidirectional framing evidence.
- [ ] Capture close/reconnect evidence.

## Renderer Prototype

- [ ] Gate this phase on a successful Binder plus SCM_RIGHTS proof.
- [ ] Define strict MessagePack native bridge framing.
- [ ] Prototype GeckoView WebExtension adapter.
- [ ] Prototype Cefrium query/native adapter.
- [ ] Route one terminal stream without localhost TCP.
- [ ] Measure FD transport separately from native-message serialization.
- [ ] Validate reconnect and app background/restore.
- [ ] Keep experimental selection explicit; do not silently fall back.

## Full Localhost-Removal Assessment

- [ ] Inventory APK/OTA local asset delivery.
- [ ] Inventory framework HTTP APIs.
- [ ] Inventory SSE.
- [ ] Inventory app Socket.IO namespaces.
- [ ] Inventory raw WebSockets.
- [ ] Inventory run-target proxying.
- [ ] Inventory UI IPC and native console.
- [ ] Inventory arbitrary run-profile pages.
- [ ] Record browser-origin, cookie, CSP, and security dependencies.
- [ ] Classify every path as FD-ready, frontend-adapter-required,
  renderer-local-HTTP-required, or inherently remote-networked.
- [ ] State whether complete localhost elimination is proven, partially viable,
  or not viable.

## Documentation And Handoff

- [x] Update `docs/apps/code_te2/CODE_TE2.md` with the implemented Track A
  behavior and the unresolved Cefrium zoom limitation.
- [x] Update `.repo_memory.md` with concise Track A contracts.
- [x] Record the xterm fork/source changes and rebuild procedure, including
  source branch `te2-mobile-touch-routing` at
  `1d71ed0732d592980eb0960ce3da001213d2636e`.
- [ ] Record Android helper build and packaging procedure.
- [ ] Record security and permission requirements.
- [ ] Record measured latency and lifecycle results.
- [ ] Record unresolved limitations without presenting them as completed work.
- [ ] Commit and push only after requested acceptance boundaries are met.

## TE2 0.2.344 Release Integration

- [x] Fast-forward the release branch from the complete 11-commit Track A stack
  without rebasing or creating a synthetic merge commit.
- [x] Preserve exact first-party dependency pins: Framework-Shells `0.0.63`
  and Agent Log Server `0.2.123`.
- [x] Synchronize release-facing source metadata to `0.2.344` and Android
  version code `20344`.
- [x] Rebuild Code TE2 and standalone Terminal, then materialize a fresh Android
  asset seed from those canonical outputs.
- [x] Re-run Electron typecheck/tests/compile and construct the packaged
  Electron runtime from the synchronized source candidate.
- [x] Build and audit synchronized GeckoView and Cefrium staging APKs.
- [x] Complete the release Track A live-acceptance gate against the exact
  synchronized APKs on both the Motorola and Pixel. The extended text-shape and
  lifecycle torture checks above remain separately tracked where not reported.
- [ ] Fast-forward `main`, create the immutable `0.2.344` tag, build clean Linux
  and Termux artifacts, and publish PyPI/GitHub only after live acceptance.
