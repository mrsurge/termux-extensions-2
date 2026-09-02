# Terminal Input, Lifecycle, And Drawer Transport Tracker

Status: implementation in progress; Phase 1 live acceptance complete
Plan: `docs/apps/terminal/IMPLEMENTATION_PLAN.md`

## Investigation

- [x] Confirm current standalone raw MessagePack stream and Node broker source.
- [x] Capture the exact failing Gboard event sequence after a new prompt.
- [x] Prove the reported first-character loss is not a connection race.
- [x] Identify the cleared helper textarea plus key code `229` guard gap.
- [x] Capture the stuck-composition space-plus-dash event sequence.
- [x] Prove one textarea dash was duplicated by xterm's keypress fallback.
- [x] Establish Android textarea input as the sole printable-text authority.
- [x] Measure current Code TE2 shell-list, describe, and history latency.
- [x] Trace duplicate Code TE2 HTTP list/history requests.
- [x] Confirm existing Code TE2 `/terminal` Socket.IO namespace and FWS lifecycle bridge.
- [x] Confirm standalone list is REST/manual-refresh based.
- [x] Confirm live active terminal card is not marked active.
- [x] Identify stale standalone terminal documentation.

## Phase 1: Android Printable-Input Ownership

- [x] Remove the disproven speculative connection/listener changes.
- [x] Restore a missing guarded projection on key code `229`.
- [x] Add the exact cleared-textarea first-character regression.
- [x] Route Android printable key events through cumulative textarea input.
- [x] Bypass upstream keypress emission only in Android custom input mode.
- [x] Preserve non-text and modified keydown handling.
- [x] Add ordinary printable-input and Gboard commit-echo regressions.
- [x] Add a Terminal-level Android keypress ownership regression.
- [x] Run the full xterm TypeScript build.
- [x] Package the xterm UMD artifact.
- [x] Run all ten xterm Android transaction tests.
- [x] Run all 154 additional Terminal unit tests.
- [x] Publish the generated xterm JS to TE2's tracked vendor asset.
- [x] Run standalone Terminal typecheck.
- [x] Run standalone Terminal broker/protocol tests.
- [x] Build the standalone Terminal frontend.
- [x] Force-load the rebuilt same-version asset for live acceptance.
- [x] Repeat the exact prompt-boundary Gboard reproduction live.
- [x] Repeat space plus one dash in stuck composition mode in both terminals.

## Phase 2: Standalone Lifecycle Socket

- [ ] Add Terminal-owned `sio_service.json` and manifest declaration.
- [ ] Mount the app-worker Socket.IO server/namespace.
- [ ] Require strict `msgpack-v1` application payloads.
- [ ] Add one FWS reconnect snapshot and event-only lifecycle bridge.
- [ ] Retain compact standalone terminal shell facts in memory.
- [ ] Emit one complete revisioned list snapshot on client connect.
- [ ] Move create/stop/kill/restart/remove/refresh commands to Socket.IO.
- [ ] Broadcast lifecycle snapshots to every connected Terminal client.
- [ ] Remove standalone shell-list mutation HTTP calls from the frontend.
- [ ] Add two-client create/exit/remove tests.
- [ ] Add reconnect snapshot and stale-revision tests.

## Phase 3: Code TE2 Socket-Only Drawer

- [ ] Define typed Socket.IO command and bootstrap DTOs.
- [ ] Move list/create/activate/title/remove from HTTP to `/terminal`.
- [ ] Move history/bootstrap from HTTP to `/terminal`.
- [ ] Correlate bootstrap by shell id and bind generation/request id.
- [ ] Emit shell identity before noncritical list decoration work.
- [ ] Keep live output buffered only until correlated history/bootstrap applies.
- [ ] Generalize the existing FWS bridge to retain terminal shell facts.
- [ ] Build project lists from sidecar membership plus retained FWS facts.
- [ ] Remove sequential shell metadata scans from register/menu paths.
- [ ] Remove all terminal API `fetch()` calls from `host-terminal-drawer.ts`.
- [ ] Preserve project-switch rebind behavior without polling.
- [ ] Add protocol, reconnect, and stale-bind tests.
- [ ] Record before/after localhost drawer readiness latency.

## Phase 4: Two-Row Standalone Keys

- [ ] Render row one: `ESC`, `MINIBAR`, `-`, `HOME`, `UP`, `END`, `PGUP`.
- [ ] Render row two: `TAB`, `CTRL`, `ALT`, `LEFT`, `DOWN`, `RIGHT`, `PGDN`.
- [ ] Bind `MINIBAR` to the shell-list drawer only.
- [ ] Add independent visible Ctrl and Alt state.
- [ ] Support combined Ctrl+Alt synthetic key dispatch.
- [ ] Consume only one-shot modifiers after a non-modifier action.
- [ ] Preserve terminal textarea focus for every soft-key action.
- [ ] Add synthetic key/modifier unit tests.
- [ ] Validate Gboard and hardware-key behavior live.

## Phase 5: Client-Local Active Card

- [ ] Make `state.activeId` the sole standalone active-card input.
- [ ] Rerender after restore, select, snapshot, exit, and removal.
- [ ] Remove click-only imperative active-class mutation.
- [ ] Add `aria-current` semantics.
- [ ] Strengthen active styling without conflating it with process-alive status.
- [ ] Verify two clients can display different active cards.

## Documentation

- [ ] Rewrite `docs/apps/terminal/terminal_app.md` to match current source.
- [ ] Update `docs/apps/code_te2/CODE_TE2.md` with socket-only drawer semantics.
- [ ] Update `.repo_memory.md` with condensed terminal invariants.
- [ ] Remove or correct any stale terminal transport statements discovered during implementation.

## Final Validation

- [x] Standalone `npm run typecheck` passes.
- [x] Standalone `npm test` passes.
- [x] Standalone `npm run build` passes.
- [ ] Code TE2 `npm run typecheck` passes.
- [ ] Code TE2 `node build.mjs` passes.
- [ ] Twenty rapid first-character attempts pass on mobile.
- [ ] Code TE2 existing-shell drawer is ready in under one second on localhost.
- [ ] Browser network inspection shows no terminal control/history HTTP requests.
- [ ] Multi-client lifecycle acceptance passes without polling.
- [ ] Git diff contains no unrelated or generated-source edits outside approved publication outputs.
