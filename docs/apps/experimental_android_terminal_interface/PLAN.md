# Experimental Android Terminal Interface Plan

## Status

- Branch: `experimental/android-terminal-interface`
- Starting snapshot: `b8c296c5` (`Gate Terminal mobile key dock`)
- Implementation status: Track A source and automated validation complete;
  Android live acceptance pending
- Release baseline: not yet published; merge it into this branch before final
  validation

## Objective

This branch has two experimental tracks:

1. Give the xterm-based terminal surfaces robust mobile touch selection with
   visible, draggable selection handles and predictable scroll/selection
   gestures.
2. Determine whether a real Android file-descriptor transport can connect a
   Termux-hosted TE2 runtime to the GeckoView and Cefrium clients without using
   localhost TCP as the cross-application data plane.

The work is successful if the touch interaction is demonstrably better and the
file-descriptor investigation produces either a verified transport prototype or
reproducible evidence explaining why the proposed production path is not viable.

## Constraints

- Preserve the current standalone Terminal and Code TE2 terminal-drawer
  protocol semantics.
- Do not change production transport behavior until the descriptor probe passes
  independently on a physical Android device.
- Keep experimental transport behavior disabled by default.
- Do not introduce polling.
- Do not silently fall back from an explicitly selected descriptor transport to
  localhost networking.
- Preserve remote-client networking. A same-device native transport cannot
  replace the network path for a client connected to TE2 on another device.
- Keep GeckoView and Cefrium behavior aligned unless a renderer API requires a
  documented adapter.
- Do not edit generated Android asset copies by hand. Rebuild and bundle only at
  an approved publication/acceptance point.
- Merge the pending release baseline before final validation so this branch does
  not ship from the older `0.2.342` snapshot accidentally.

## Current Architecture Findings

### Terminal touch input

- Both terminal surfaces use the same vendored xterm 5.3.0 browser artifact at
  `app/static/vendor/xterm/xterm.js`.
- Editable xterm source is in the nested `worktrees/xterm-te2` repository on its
  `te2-android-ime` branch.
- The standalone Terminal initializes xterm in
  `app/apps/terminal/src/main.ts`.
- The Code TE2 drawer initializes xterm in
  `app/apps/code_te2/main_page/frontend/host-terminal-drawer.ts`.
- Both surfaces load an identical app-owned copy of
  `touch_to_mouse_handler.js` from their respective
  `vendor/android-terminalapp-assets-js` directories.
- The existing helper already distinguishes scroll from long-press selection,
  synthesizes xterm mouse selection, and disables browser touch behavior during
  a captured gesture.
- The Code TE2 drawer also has an older local touch handler. Its app-wide helper
  is loaded with `__fileEditorCm6TerminalHelpersActive = false`, so ownership is
  currently split and must be reconciled rather than stacking two active
  gesture systems.
- xterm's public API already provides `onSelectionChange`, `hasSelection`,
  `getSelectionPosition`, `clearSelection`, `select`, `selectLines`,
  `buffer.active.viewportY`, and buffer-cell width inspection.
- xterm's internal `MouseService` maps client coordinates by measured CSS cell
  width/height, adds a half-cell horizontal selection offset, clamps to the
  viewport, and adds `viewportY` to produce buffer coordinates.
- The published `IBufferCellPosition` comments call positions one-based, but
  xterm 5.3.0's implementation and tests return zero-based selection positions.
  The helper must follow observed implementation semantics and lock them down in
  tests.

### Android process boundary

Live package inspection on the current device established:

- Termux and Termux:API share UID `10321` and the Termux signing identity.
- GeckoView runs as UID `10438`.
- Cefrium runs as UID `10439`.
- The TE2 clients use a different signing identity from Termux.
- Android SELinux is enforcing.

Therefore, shared-UID filesystem or binder shortcuts are not available. Any
cross-application IPC component must be explicitly exported and authenticate
the caller.

The existing `PersistentNetworkService` is intentionally `exported=false` and
returns an in-process `LocalBinder`; it is not a cross-application IPC surface.
The existing `AndroidFrameworkRelay` is a loopback HTTP/WebSocket proxy and is
the component the experiment is evaluating, not an FD handoff mechanism.

### Why AIDL and one ParcelFileDescriptor are sufficient

Android AIDL can return `ParcelFileDescriptor` across a Binder transaction. The
kernel duplicates the underlying descriptor into the receiving process.
`ParcelFileDescriptor.createReliableSocketPair()` creates two connected,
full-duplex endpoints. The Android service can retain one endpoint and return
the other, so one returned `ParcelFileDescriptor` is sufficient for one
bidirectional session.

The receiving client cannot be the ordinary Rust/Python TE2 process directly:
it is not an Android component and does not have a normal `Context.bindService`
lifecycle. Termux already proves a suitable packaging pattern through
`termux-am`: a DEX/APK is executed with `/system/bin/app_process` under the
Termux UID. A TE2-specific helper can use the same model to bind explicitly to
the exported service.

After receiving the `ParcelFileDescriptor`, the helper can send its underlying
descriptor to the Rust process over a same-UID Unix-domain handoff socket using
`LocalSocket.setFileDescriptorsForSend`/`SCM_RIGHTS`. The helper can then close
its copy and exit. The steady-state data path becomes:

```text
TE2 Rust server
  <-> duplicated Unix socket descriptor
  <-> Android FD transport service
  <-> native renderer adapter
```

The `app_process` helper is only a descriptor bootstrap, not a long-lived byte
proxy.

### Caller validation

The exported transport service must use an explicit component with no intent
filter. Each AIDL transaction must compare `Binder.getCallingUid()` with the UID
resolved for the installed `com.termux` package. This is stronger than checking
a caller-supplied package name. A service permission can add defense in depth,
but `com.termux.permission.RUN_COMMAND` alone is insufficient because it is a
dangerous permission that can be granted to other apps.

The Termux UID check permits the Termux process and its same-UID official
plugins. Those packages already share Termux's private data authority. No other
UID may obtain a descriptor.

## Track A: Mobile Xterm Selection

### A1. Consolidate gesture ownership

Make the existing `touch_to_mouse_handler.js` the single mobile gesture owner
for both terminal surfaces. Give it an explicit attach/dispose API that receives
the active xterm instance instead of relying on a global terminal reference.

Required behavior:

- ordinary one-finger drag scrolls the terminal;
- long press enters xterm selection;
- double tap keeps the existing word-selection behavior;
- active selection renders start and end handles;
- dragging a handle updates only that endpoint and may cross the fixed endpoint;
- handle drag cannot focus the hidden textarea or send terminal input;
- edge drag scrolls by whole xterm rows and extends the selection into the newly
  revealed buffer rows;
- wide-character continuation cells are normalized with the public buffer cell
  width API;
- handles are hidden when selection is cleared, xterm is disposed, the endpoint
  is not representable, or the device is not touch-first;
- selection geometry is recomputed on xterm scroll, resize, selection change,
  and visual viewport changes;
- all listeners, animation frames, timers, and DOM nodes are disposed with the
  terminal instance.

### A2. Geometry contract

Use `.xterm-screen` as the measured coordinate surface:

```text
cellWidth  = screenRect.width / terminal.cols
cellHeight = screenRect.height / terminal.rows
bufferRow  = viewportRow + terminal.buffer.active.viewportY
```

Horizontal touch mapping must match xterm's selection rule: add half a cell
before division, then clamp the result to `[0, cols]`. Vertical mapping clamps
to visible rows before adding `viewportY`.

Selection endpoints are end-exclusive. Normalize endpoints into document order
and call `terminal.select(startColumn, startRow, linearCellLength)` so xterm
remains the selection-state authority.

Do not infer columns from text length. Combining characters, emoji, and CJK
cells make text length unsuitable for terminal geometry.

### A3. UI treatment

- Reuse the Monaco mobile selection handle visual language without copying its
  editor-specific positioning logic.
- Use a translucent high-contrast handle with a minimum 36 px touch target.
- Keep the visible handle smaller than its hit target.
- Append the handle layer to the xterm root and keep it above canvases/helpers
  without interfering with ordinary terminal pointer events.
- Do not add a permanent viewport-resizing control.

### A4. Validation

- Unit-test coordinate conversion, endpoint ordering, cross-over behavior,
  viewport offsets, edge clamping, and wide-cell normalization.
- Validate existing standalone Terminal protocol and mobile-key tests.
- Typecheck/build `app/apps/terminal` and `app/apps/code_te2`.
- Live-test both terminal surfaces in GeckoView and Cefrium:
  selection, crossing handles, scrolling, scrollback, CJK/emoji, copy, IME
  focus, alternate screen, terminal resize, and reconnect/dispose.

If browser-side measurements diverge from xterm's renderer dimensions in live
testing, stop and add a narrow source-level xterm coordinate API in
`worktrees/xterm-te2`; do not add renderer-specific correction constants.

## Track B: Android FD Transport

### B1. Isolated Binder proof

Add an experimental AIDL service shared by the GeckoView and Cefrium modules.
The service will:

1. validate the Binder caller UID against installed `com.termux`;
2. validate a protocol version;
3. create a reliable socket pair;
4. retain one endpoint in a generation-owned session registry;
5. return one `ParcelFileDescriptor` to the caller;
6. close both ends deterministically on failure, Binder death, service teardown,
   or generation replacement.

The production `PersistentNetworkService` and relay remain unchanged during
this phase.

### B2. Termux app-process helper

Build a small app-process-compatible APK/DEX artifact containing the same AIDL
interface. It will:

1. run under the Termux UID using `/system/bin/app_process`;
2. bind with an explicit component to the selected GeckoView or Cefrium package;
3. obtain the returned `ParcelFileDescriptor`;
4. connect to a TE2-owned Unix-domain handoff socket under the canonical runtime
   root;
5. pass the descriptor in an ancillary `SCM_RIGHTS` message;
6. close its local copy, unbind, and exit with a machine-readable result.

The helper must have bounded connection/bind timeouts and report permission,
component, protocol, Binder-death, and handoff errors distinctly.

### B3. Rust handoff probe

Add an opt-in Rust-side probe that:

- owns the private handoff socket;
- verifies peer credentials before accepting ancillary descriptors;
- validates a framed session preface;
- exchanges a bidirectional challenge/response over the received descriptor;
- detects EOF and remote close/error;
- never opens a TCP listener;
- emits machine-readable timing and teardown evidence.

This phase proves the descriptor reaches the actual Termux-hosted TE2 process,
not merely another Java helper.

### B4. Renderer transport prototype

Only after B1-B3 pass, attach the Android-retained endpoint to a native renderer
adapter and prototype terminal data/control traffic over the descriptor.

- GeckoView adapter: use the existing native WebExtension messaging ownership.
- Cefrium adapter: use its existing query/native messaging ownership.
- Preserve strict MessagePack framing at the TE2 protocol boundary.
- Measure native bridge serialization separately from FD transport latency.
- Keep the network transport available only as an explicitly selected mode or
  for remote-device connections; do not silently downgrade a failed local FD
  session.

### B5. Full localhost-removal assessment

Terminal transport success alone does not prove that Android's whole local
framework relay can be removed. The final assessment must inventory:

- local APK/OTA asset serving;
- framework HTTP APIs;
- SSE;
- Socket.IO namespaces;
- raw WebSockets;
- run-target proxying;
- native console and UI IPC;
- arbitrary run-profile pages;
- origin, cookie, CSP, and browser security assumptions.

For each surface, document whether it can use the FD multiplexer directly,
requires a frontend transport adapter, still requires renderer-local HTTP, or is
inherently remote-network traffic. Do not claim full localhost elimination until
every active path is accounted for and live-tested.

## Execution Order

1. Create and maintain the tracker.
2. Implement Track A and complete browser/unit validation.
3. Implement B1-B3 as an isolated transport proof.
4. Decide whether B4 is warranted from measured evidence.
5. Complete B5 regardless of the B4 outcome.
6. Merge the pending release baseline.
7. Re-run affected validation and Android live acceptance.
8. Update `docs/apps/code_te2/CODE_TE2.md` and `.repo_memory.md` with only
   verified durable conclusions.

## Validation Commands

Exact commands may be adjusted after source changes identify the narrowest test
targets, but the final gate includes:

```sh
cd app/apps/terminal
npm run typecheck
npm test
npm run build

cd app/apps/code_te2
npm run typecheck
npm run test:transport
node build.mjs

cd android
./gradlew :app:testGeckoDebugUnitTest
./gradlew :cefrium:testDebugUnitTest
./gradlew :app:assembleGeckoDebug
./gradlew :cefrium:assembleDebug
```

The FD probe must additionally run on a physical Android target with SELinux
enforcing and verify both renderer packages independently.

## Decision Gates

### Gate 1: Touch geometry

Proceed without modifying xterm source only if handle placement remains aligned
through font resize, scrollback, wide glyphs, GeckoView, and Cefrium. Otherwise
add the narrow xterm API described in A4.

### Gate 2: Binder acquisition

Proceed to Rust handoff only if the Termux `app_process` helper can bind to both
renderer packages and receive a working `ParcelFileDescriptor` under enforcing
SELinux.

### Gate 3: SCM_RIGHTS handoff

Proceed to renderer integration only if Rust receives the descriptor directly,
the helper exits, and bidirectional traffic continues with deterministic close
behavior.

### Gate 4: Production viability

Recommend production integration only if measured latency, lifecycle recovery,
security, packaging, and renderer adaptation are all better than or materially
safer than the current relay. Otherwise keep the experiment documented and out
of the production path.

## External References

- [Android Interface Definition Language](https://developer.android.com/develop/background-work/services/aidl)
- [Bound services overview](https://developer.android.com/develop/background-work/services/bound-services)
- [ParcelFileDescriptor](https://developer.android.com/reference/android/os/ParcelFileDescriptor)
- [LocalSocket](https://developer.android.com/reference/android/net/LocalSocket)
- [Termux RUN_COMMAND Intent](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent)
- [TermuxAm](https://github.com/termux/TermuxAm)
