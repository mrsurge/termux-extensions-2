# Terminal Testing xterm Mobile Plan

## Purpose

This document replaces the earlier hterm-specific soft-keyboard plan for `app/apps/terminal_testing`.

The new direction is:
- use xterm as the frontend terminal renderer
- keep the existing broker transport direction intact
- keep the type-safe TypeScript/esbuild frontend backbone
- keep the TE2 console bridge initialization path
- use the Android helper JavaScript files in `~/downloads/android-terminalapp-assets-js-20260407-223402/` as reference patterns for mobile-specific terminal behavior

This is a frontend planning document. It does not change the backend transport contract.

## Why xterm Is The Better Practical Fit Here

For this repo and this embedding, xterm is currently the lower-risk option.

Reasons:
1. The downloaded Android helper scripts are already shaped for xterm.
   - `ctrl_key_handler.js` uses `attachCustomKeyEventHandler(...)`
   - `touch_to_mouse_handler.js` explicitly references an xterm.js upstream issue
   - the scripts call `term.input(...)`, which assumes an xterm-like terminal surface and control model
2. `terminal_testing` already has a working transport and resize path.
   - the problem to solve is frontend input behavior, not broker throughput or resize fidelity
3. hterm appears more sensitive to the current app-shell/iframe embedding.
   - that increases uncertainty and debugging cost across Chromium and GeckoView
4. xterm gives us a more explicit and familiar extension surface for mobile-specific patches.

## What Stays The Same

The following parts of `terminal_testing` remain the active direction:
- Rust-backed broker transport
- JSON-RPC input to broker
- JSONL output/replay from broker
- replay and resize semantics already established for the broker track
- app-local TypeScript frontend build
- minified esbuild output under `static/dist/`
- TE2 console bridge initialization
- accessory key strip for terminal-only keys

This means the migration is a renderer/input-layer change, not a transport rewrite.

## What Changes

The frontend renderer/input direction becomes:
- xterm instead of hterm
- xterm mobile behavior extended with small targeted helper logic
- ordinary text continues to use the terminal's native text-entry path
- accessory controls remain separate for terminal-only actions

The downloaded helper scripts should be treated as reference inputs, not as blindly copied final code.

## Helper Scripts And Their Role

Directory:
- `~/downloads/android-terminalapp-assets-js-20260407-223402/`

Useful files:
1. `ctrl_key_handler.js`
   - useful reference for Android soft-keyboard `keyCode 229` handling when synthesizing Ctrl combinations
   - relevant to the accessory-bar Ctrl workflow
2. `touch_to_mouse_handler.js`
   - useful reference for optional touch-to-mouse bridging later, especially for long-press/selection behavior
3. `terminal_close.js`
   - app-specific close sequence reference only
4. `terminal_disconnect.js`
   - app-specific disconnect lifecycle reference only

Interpretation:
- `ctrl_key_handler.js` is the strongest candidate for reuse or adaptation
- `touch_to_mouse_handler.js` is a secondary candidate for later selection work
- the others are not central to the current mobile typing problem

## Frontend Direction For `terminal_testing`

### 1. Renderer

Use xterm as the terminal surface for `app/apps/terminal_testing`.

Expected benefits:
- reuse known terminal behavior already present in this repo
- easier comparison to the existing drawer and standalone terminal app
- direct fit for the downloaded Android helper patterns

### 2. Type-Safe Backbone

Keep the current frontend structure:
- `app/apps/terminal_testing/src/main.ts`
- `app/apps/terminal_testing/build.mjs`
- `app/apps/terminal_testing/tsconfig.json`
- `app/apps/terminal_testing/static/dist/main.js`

Do not regress to an untyped ad hoc frontend.

### 3. Console Bridge

Keep the current explicit console bridge initialization path.

That includes:
- ensuring `/static/vendor/socket.io.min.js` is available before bridge init if needed
- keeping the bridge startup in the `terminal_testing` frontend rather than pushing a new app-shell contract right now

### 4. Accessory Keys

Keep the accessory strip for terminal-only controls:
- Ctrl
- Tab
- Esc
- arrows

These remain separate from ordinary text input.

### 5. Ctrl Strategy

Adopt the `ctrl_key_handler.js` idea as the mobile Ctrl reference model.

Preferred shape:
- accessory-bar Ctrl toggles a frontend state flag
- next suitable typed character is converted into the corresponding control byte
- Android `keyCode 229` / composed-input path is handled explicitly if needed in xterm's key hook path

### 6. Selection Strategy

Do not start by rebuilding custom selection behavior.

Initial xterm direction:
- ordinary typing first
- stable keyboard behavior first
- optional touch-to-mouse / long-press selection bridging later only if needed

That is where `touch_to_mouse_handler.js` becomes relevant.

## Phase Plan

### Phase 1: Planning Reorientation

1. Replace the hterm-specific plan with this xterm/mobile plan.
2. Update the broader terminal planning document so `terminal_testing` is explicitly xterm-oriented on the frontend.
3. Preserve the transport plan and TypeScript/frontend build assumptions.

### Phase 2: xterm Frontend Migration Plan

Planned implementation scope:
1. remove hterm-specific frontend imports and runtime assumptions
2. restore an xterm-based renderer in `terminal_testing`
3. keep the broker websocket/JSON-RPC/JSONL contract unchanged
4. keep resize logic, adapting it to xterm fit semantics as needed
5. keep the console bridge intact
6. wire the accessory strip back into xterm-compatible helpers
7. introduce the Ctrl helper behavior using the Android reference script as a guide

### Phase 3: Mobile Behavior Hardening

After xterm is restored and basic typing works:
1. validate ordinary soft-keyboard typing
2. validate accessory Ctrl handling on Android
3. validate held backspace/delete behavior against the current broker batching model
4. consider optional touch-to-mouse bridging for selection if needed

## Decision Criteria

Keep the xterm direction if all of the following are true:
- soft keyboard behavior is more stable than the hterm embedding path
- ordinary text input works without large focus hacks
- Ctrl accessory behavior can be implemented cleanly
- resize semantics remain good enough
- Chromium and GeckoView behavior is easier to reason about than the hterm path

Reconsider only if:
- xterm cannot be made to behave acceptably on mobile in this embedding
- the helper patterns do not translate cleanly into the broker-backed `terminal_testing` app

## Working Assumptions For The Next Agent Pass

1. The broker transport stays intact.
2. The renderer/input layer is the only major frontend direction change.
3. The TypeScript backbone and console bridge are retained.
4. The Android helper scripts are reference material, not literal drop-in final code.
5. Ctrl synthesis is the first helper pattern to adopt; touch-to-mouse is a later option.
