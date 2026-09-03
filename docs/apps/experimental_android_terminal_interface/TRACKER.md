# Experimental Android Terminal Interface Tracker

## Branch And Baseline

- [x] Create `experimental/android-terminal-interface`.
- [x] Record starting snapshot `b8c296c5`.
- [ ] Merge the pending release baseline after it is published.
- [ ] Confirm the branch contains the release's Terminal, Android, framework,
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
- [x] Make the shared touch helper the only active mobile gesture owner.
- [x] Preserve one-finger terminal scrolling.
- [x] Preserve long-press selection.
- [x] Preserve double-tap word selection.
- [x] Prevent handle gestures from sending PTY input or stealing IME focus.

### Selection handles

- [x] Render visible start and end handles for active selection.
- [x] Provide at least a 36 px touch target without an oversized visible handle.
- [x] Position handles from xterm screen geometry and active `viewportY`.
- [x] Update one endpoint while retaining the other.
- [x] Support endpoint crossing.
- [x] Normalize wide-character continuation cells.
- [x] Add whole-row edge autoscroll while dragging.
- [x] Reposition on selection, scroll, resize, font, and visual viewport changes.
- [x] Hide handles for cleared, invalid, off-surface, non-touch, and disposed
  states.
- [x] Dispose DOM, listeners, timers, and animation frames deterministically.

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
- [x] Run standalone Terminal tests: 20 passed.
- [x] Build standalone Terminal frontend.
- [x] Run Code TE2 typecheck.
- [x] Run Code TE2 terminal transport/touch tests: 38 passed.
- [x] Build Code TE2 frontend.

### Live acceptance

- [ ] Standalone Terminal on GeckoView.
- [ ] Code TE2 drawer on GeckoView.
- [ ] Standalone Terminal on Cefrium.
- [ ] Code TE2 drawer on Cefrium.
- [ ] Verify selection in scrollback.
- [ ] Verify selection over CJK, emoji, and combining text.
- [ ] Verify handle crossing.
- [ ] Verify edge autoscroll.
- [ ] Verify copy behavior.
- [ ] Verify IME remains stable.
- [ ] Verify resize/reconnect/dispose cleanup.
- [ ] Decide whether a narrow xterm source API is required.

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

- [ ] Update `docs/apps/code_te2/CODE_TE2.md` after behavior is verified.
- [ ] Update `.repo_memory.md` with concise durable conclusions.
- [ ] Record any xterm fork/source changes and rebuild procedure.
- [ ] Record Android helper build and packaging procedure.
- [ ] Record security and permission requirements.
- [ ] Record measured latency and lifecycle results.
- [ ] Record unresolved limitations without presenting them as completed work.
- [ ] Commit and push only after requested acceptance boundaries are met.
