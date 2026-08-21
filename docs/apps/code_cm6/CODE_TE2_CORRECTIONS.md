# CODE_TE2.md — Proposed Corrections

This document catalogs every discrepancy found between
`docs/apps/code_cm6/CODE_TE2.md` and the current source. Sections are
ordered by their appearance in the original document.

Status note: `Code TE2.md status` entries describe the pre-application state
that this correction pass was written against. After applying the corrections,
use `CODE_TE2.md` as the updated source-facing document.

---

## Section 0 — High-level map

### 0.1 `main.js` → `main.ts`

**Problem:** The high-level map and many subsequent sections reference
`app/apps/file_editor_cm6/main.js` as the host shell entrypoint. This file
does not exist. The actual host source entrypoint is
`app/apps/file_editor_cm6/main.ts` (52 KB), confirmed by `build.mjs` line 42:
`entryPoints: ['main.ts']`.

**Locations in doc:** Lines 86, 91, 277–282, 542, 945, 1470 (Section 21 key
files), 1986–1987 (Section 19 key files), 2157, 3007.

**Fix:** Replace all `main.js` source-path references with `main.ts`. The
served bundle remains `static/dist/host.js`.

### 0.2 Editor Socket.IO namespace `/editor` → `/rpc/editor`

**Problem:** Line 95 says `namespace /editor`. The worker Socket.IO server
registers only `/rpc/editor` (`socketio_gateway.py` line 22,
`editor_rpc_socketio.py`). There is no `/editor` Socket.IO namespace. The
doc's own Section 6.5 correctly uses `/rpc/explorer` for Explorer, so the
editor namespace should be `/rpc/editor` for consistency.

**Locations in doc:** Lines 95, 269, 940–941, and throughout Section 6
(lines 526–752).

**Fix:** Change all editor namespace references from `/editor` to
`/rpc/editor`. The path `/editor_ws/socket.io` remains correct as a legacy
alias.

### 0.3 Explorer namespace `/explorer` → `/rpc/explorer` (section 9 only)

**Problem:** Section 9 line 941 says `Explorer Socket.IO: namespace
/explorer`. Source registers `/rpc/explorer` only. The doc's own Section 6.5
(line 760) already correctly says `/rpc/explorer`, so Section 9 is internally
inconsistent.

**Fix:** Change line 941 from `/explorer` to `/rpc/explorer`.

### 0.4 `static/js/explorer.ts` no longer exists

**Problem:** Lines 284–290 list
`app/apps/file_editor_cm6/static/js/explorer.ts` as the "Served explorer
entrypoint." The `static/js/` directory does not exist. Explorer source now
lives entirely under `src/explorer/`, which is bundled into `host.js`.

**Fix:** Remove the `static/js/explorer.ts` entry. Replace with a reference to
`src/explorer/` as the Explorer frontend source tree, bundled into
`static/dist/host.js`.

---

## Section 1 — Key files: Host decomposition status

### 1.1 `src/host/` has been migrated to `main_page/frontend/`

**Problem:** The "Host decomposition status" table (lines 293–323) lists 25
modules under `src/host/`. That directory does not exist. All modules have
been migrated to `main_page/frontend/`:

- 20 modules exist at `main_page/frontend/` with the same relative structure
  (e.g. `src/host/boot/boot-sequence.ts` →
  `main_page/frontend/boot/boot-sequence.ts`).
- 3 modules were relocated and renamed:
  - `src/host/app-context.ts` → `main_page/frontend/core/app-context.ts`
  - `src/host/utils.ts` → `main_page/frontend/core/utils.ts`
  - `src/host/api/client.ts` → `main_page/frontend/core/api-client.ts`
- 1 module (`src/host/ui/edit-tracker.ts`) does not exist anywhere in the
  source tree — it appears to have been removed.

**Fix:** Update the table to reflect `main_page/frontend/` paths. Remove the
`edit-tracker.ts` entry or mark it as removed. Update the "Remaining
high-value decomposition targets" subsection accordingly.

### 1.2 `src/host/` is no longer excluded from the strict-TS lane

**Problem:** Line 373 says "`src/host/` is still excluded from the current
app strict-TS lane in `tsconfig.json`." Since `src/host/` doesn't exist and
`main_page/frontend/**/*.ts` is explicitly included in `tsconfig.json`
(lines 35–36), the host modules are now ON the strict-TS lane.

**Fix:** Update the "Current host TS migration state" section to reflect
that the host lane is now included in strict TypeScript checking.

### 1.3 `nicegui_editor/editor_app.py` references are stale

**Problem:** Section 1 line 518 and Section 5 line 518 reference
`app/apps/file_editor_cm6/nicegui_editor/editor_app.py` for
`/editor/check_cache`. Current source has no `nicegui_editor/` route owner for
this endpoint. `/editor/check_cache` is implemented by
`monaco_editor/editor_backend.py` and delegates to
`monaco_editor/editor_backend_services/cache_routes_service.py`; the Monaco
frontend caller is `monaco_editor/editor_open_cache_fetch_utils.ts`.

**Fix:** Replace the NiceGUI reference with the Monaco editor backend route and
cache service. Also update text that says `/editor/*` routes still live in
NiceGUI; they are Monaco editor backend HTTP routes now.

---

## Section 1.5 — Build outputs

### 1.5.1 `static/dist/editor.js` does not exist

**Problem:** Lines 363–364 state:
```
- Host bundle: `static/dist/host.js` (entry: `main.js`, format: ESM)
- Editor bundle: `static/dist/editor.js` (entry: `monaco_editor/m_editor_app.ts`, format: IIFE)
```

`build.mjs` has no editor bundle configuration. There is no
`static/dist/editor.js` in the dist directory. The inline Monaco runtime and
editor application are statically bundled into `host.js` via the import chain
`main.ts` → `host-boot-runtime.ts` → `inline_host.ts` → dynamic import of
`m_editor_app.ts`. `build.mjs` uses `bundle: true` so this chain is followed.

**Fix:** Remove the `editor.js` build output line. Update the host bundle
entry to `main.ts`. Add a note that the editor runtime is bundled into
`host.js`, not a separate output.

### 1.5.2 `worktrees/vscode-te2-diff/build_monaco_te2.sh` does not exist

**Problem:** Section 7 line 875 recommends:
```
cd worktrees/vscode-te2-diff && ./build_monaco_te2.sh
```
This script does not exist anywhere in the worktree or repository.

**Fix:** Remove the recommended build command or replace with the actual
build steps (gulp editor-distro, etc.) as separate commands.

### 1.5.3 `te2-lang/` output directory missing

**Problem:** Section 7 line 869 references
`worktrees/vscode-te2-diff/out-monaco-editor-core/te2-lang/` as a build
output. The `out-monaco-editor-core/` directory contains only `esm/`,
`LICENSE`, `README.md`, `monaco.d.ts`, `package.json`, `version.txt` — no
`te2-lang/` subdirectory.

**Fix:** Verify whether `te2-lang/` is produced by a separate build step not
documented here, or remove the reference.

---

## Section 5 — Current milestone: diagnostics

### 5.1 `diagnostics_bridge.py` watcher fanout attribution is stale

**Problem:** Line 43 says
"`diagnostics_bridge.py` remains relevant for normalized explorer/problems
diagnostics and watcher fanout."

`diagnostics_bridge.py` lives at the top level of `file_editor_cm6/` (not
under `monaco_editor/` or `explorer/`). Its module docstring confirms it
owns "WBA diagnostics projection for Explorer/backend surfaces" — the
diagnostics-projection claim is accurate. However, it contains **zero
watcher code**. Watcher fanout now lives in `wba_event_bridge.py`
(`_handle_watcher_file_changes` line 102, `_handle_watcher_enospc` line 60)
and `workspace_events.py` (`publish_file_change_event` line 133).

**Fix:** Remove "and watcher fanout" from line 43. Add a note that watcher
fanout is owned by `wba_event_bridge.py` / `workspace_events.py`.

---

## Section 6.5 — Explorer Socket.IO transport

### 6.5.1 `search:query` event does not exist

**Problem:** Line 779 lists `search:query` as a client→server event type for
"Full-text search." This event does not exist anywhere in source. The actual
search system uses:

- Logical JSON-RPC method `explorer.search.run` (aliased to legacy
  `search:run`) defined in `explorer/transport/rpc_contract.py` line 82.
- Progressive search backed by the framework `service.search` pipe
  (`search.files.start`, `search.content.start`, `search.job.cancel`) — see
  `explorer/search.py`.
- Result events: `explorer.search.results.updated`,
  `explorer.search.started`, `search.job.progress`, `search.job.result`,
  `search.job.done`, `search.job.error` — see
  `explorer/services/search_sessions.py`.

**Fix:** Replace the `search:query` row with the actual search methods:
`explorer.search.run`, `explorer.search.more`, `explorer.search.moreInFile`,
`explorer.search.cancel`. Note that content/name search is backed by the
progressive `service.search` pipe, not a synchronous explorer bus event.

---

## Section 9 — Debugging checklist

### 9.1 SUBAPPS mount list is incomplete

**Problem:** Lines 934–938 show only 3 SUBAPPS mounts:
```python
SUBAPPS = [
    ("/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/editor_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/explorer_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
]
```

The actual `main.py` (lines 299–305) has **5** mounts:
```python
SUBAPPS = [
    ("/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/editor_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/explorer_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/ui_ipc_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
    ("/terminal_ws/socket.io", FILE_EDITOR_CM6_ASGI_APP),
]
```

**Fix:** Update the SUBAPPS snippet to include all 5 mounts.

### 9.2 Editor namespace and Explorer namespace

**Problem:** Line 940 says `Editor Socket.IO: namespace /editor` and line 941
says `Explorer Socket.IO: namespace /explorer`. Both should be `/rpc/editor`
and `/rpc/explorer` respectively (see items 0.2 and 0.3 above).

---

## Section 14–16 — `vscode_api` historical sections

### 14.1 `vscode_api` has been fully removed

**Problem:** Sections 14–16 describe `vscode_api` as a service with
transport, shell manager, shellspec, and server. All of these have been
removed:

- No `vscode_api_transport.py`, `vscode_api_shell_manager.py`,
  `vscode_api_server.mjs`, or `vscode_api.yaml` exist anywhere in the repo.
- `manifest.json` services list contains only
  `sidebar_backchannel_uds` — no `vscode_api`.
- The only `vscode_api` reference in live source is a legacy config-key
  migration in `project_sidecar.py` (lines 993/1006/1028) that reads the old
  `vscode_api` sidecar field, migrates it to `workbench_extensions`, and
  deletes it.

The doc itself labels these sections "Historical" (lines 1142, 1223), so
this is acknowledged. However, Section 14's "Files to remove" table (lines
1183–1185) describes files that should be removed — these have already been
removed. Section 16 discusses "vscode_api shell" as a future target, which is
no longer the plan.

**Fix:** No content change needed if the "Historical" framing is considered
sufficient. Consider adding a one-line note at the top of Section 14 stating
that all described removals have been completed and `vscode_api` no longer
exists in any form in the source tree.

---

## Section 19 — File watcher pipeline

### 19.1 Watcher handler attribution to `diagnostics_bridge.py` is stale

**Problem:** Section 19 repeatedly attributes watcher event handling to
`diagnostics_bridge.py`:

- Line 1933: "→ diagnostics_bridge.py WS handler"
- Line 1981: "diagnostics_bridge.py: `watcher/enospc` and
  `watcher/fileChanges` handlers"
- Line 2007: "diagnostics_bridge.py: IPC watcher path hook"

None of these are accurate. `diagnostics_bridge.py` has zero watcher code.
The watcher handlers live in `wba_event_bridge.py`:

- `_handle_watcher_file_changes` (line 102)
- `_handle_watcher_enospc` (line 60)
- Dispatched at lines 159–163

The external-edit-detection path (`handle_external_file_change`) is in
`workspace_events.py` (line 118).

**Fix:** Replace all `diagnostics_bridge.py` references in Section 19 with
`wba_event_bridge.py` and `workspace_events.py` as appropriate. The
`diagnostics_bridge.py` references in the "Key files" list (line 2007) should
be replaced with `wba_event_bridge.py`.

### 19.2 "code-server's native filesystem/IPC path" understates watchexec

**Problem:** Line 45 says "File watching still relies on code-server's native
filesystem/IPC path, with the same triple-fallback watcher policy." This
understates the active watchexec framework shell alternative. There is a full
`watchexec_shell_manager.py` (235 lines) managing a watchexec subprocess via
`shellspec/watchexec.yaml#watchexec-poll`. The doc's own Section 19 (line
1960) documents this — the summary at line 45 should acknowledge it.

**Fix:** Update line 45 to say "File watching supports code-server's native
IPC watcher, an optional watchexec poll-based shell, inotify-limit raising,
or manual refresh — see Section 19 for the full mode policy."

---

## Section 21 — UI IPC transport

### 21.1 UI IPC is now msgpack-v1 JSON-RPC, not `ui_event` rebroadcast

**Problem:** Section 21 (lines 2107–2165) describes the UI IPC transport as
a thin `ui_event` relay where Python "just rebroadcasts events to all other
clients in the room (skip sender)" using synthetic DOM events
(`synthetic Ctrl+S keydown`, `synthetic click on document.body`).

This is entirely stale. The current UI IPC transport uses:

- Binary `msgpack-v1` codec (`frontend_rpc_codec.py`) — clients must declare
  `rpcCodec: "msgpack-v1"` on connection or are refused
  (`ui_ipc_ws.py` line 162).
- Typed JSON-RPC envelopes (`parse_ui_ipc_rpc_request`,
  `parse_ui_ipc_rpc_notification`) — not loose `ui_event` payloads.
- The inbound handler is `on_rpc` (line 256), which decodes binary
  MessagePack and parses as JSON-RPC.
- Outgoing notifications are encoded via `encode_frontend_rpc_message`.
- The frontend uses `createUiIpcRpcConnection` from
  `main_page/frontend/connections/ui-ipc-rpc.ts` — a typed JSON-RPC
  contract, not a `ui_event` listener.
- `main.js` (referenced in key files line 2157) does not exist — the host
  source is `main.ts`.

**Fix:** Rewrite Section 21 to describe the msgpack-v1 JSON-RPC transport.
Update the architecture diagram, event-type table, key-files list, and
extending section. Remove all references to `ui_event`, synthetic DOM
events, and `main.js`.

---

## Section 25 — Console observability

### 25.1 Console eval event payload missing `timeoutSeconds`

**Problem:** Section 25's event protocol table (line 2617) shows
`console:eval` payload as `{ targetWorkerId, reqId, code }`. The Python
runtime (`te2_console_runtime.py`) now includes `timeoutSeconds` in the
payload. The Code TE2 bridge at `main_page/frontend/console_bridge.js` uses
that timeout, listens for `console:evalCancel`, and performs disconnect
cleanup. The shared static bridge at `app/static/js/te2_console_bridge.js` is
not at the same feature level, so the doc should name the Code TE2 bridge when
describing this behavior.

**Fix:** Update the `console:eval` row to include `timeoutSeconds` in the
payload. Add a `console:evalCancel` row to the event table:
`{ reqId, targetWorkerId }` — sent by server to the worker room when the
Python-side eval times out, allowing the Code TE2 bridge to reject the pending
Promise.

---

## Cross-cutting: Socket.IO canonical path

### CC.1 Canonical public path needs centralized treatment

**Problem:** The doc already mentions the canonical public path
`/api/app/file_editor_cm6/socket.io` in the Socket.IO route proxy section and
Explorer transport section, but the high-level map, editor transport section,
and debugging checklist still emphasize legacy aliases (`/editor_ws/socket.io`,
`/explorer_ws/socket.io`, etc.) and stale per-surface paths. The legacy paths
are aliases for the worker route declared by `sio_service.json`; WBA remains on
its separate public path.

**Fix:** Centralize the canonical topology in Section 0 or Section 0.5: worker
namespaces (`/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`,
`/terminal`) share `/api/app/file_editor_cm6/socket.io`; legacy paths are
explicit aliases; `/wba` uses
`/api/app/file_editor_cm6/services/wba/socket.io`. Update later debug sections
to reference this canonical topology instead of treating aliases as the primary
contract.

---

## Missing sections — Not in CODE_TE2.md at all

The following are significant architecture changes documented in `.repo_memory.md` and verified in source that are **entirely absent** from CODE_TE2.md. They should be added as new sections or integrated into existing ones.

### M1 — msgpack-v1 codec migration

**Repo memory:** "Explorer, editor/Python, direct editor/WBA, and UI IPC require strict `msgpack-v1` application payloads over their existing Socket.IO namespaces. Browser encoding is owned by `src/rpc/codec.ts`; Python encoding, decoding, strict auth validation, and default-off stdout metrics are owned by `frontend_rpc_codec.py`; WBA runtime encoding is owned by `workbench_protocol_proxy/node_workbench_adapter/src/protocol/messagepack-codec.ts`. These migrated lanes have no JSON fallback."

**Code TE2.md status:** The doc never mentions `msgpack-v1`, `frontend_rpc_codec.py`, `src/rpc/codec.ts`, or the codec migration at all. Section 21 (UI IPC) still describes the old JSON `ui_event` relay (now stale — see item 21.1). The editor and explorer Socket.IO sections (6, 6.5) describe JSON payloads without mentioning the binary codec.

**Fix:** Add a new section documenting the msgpack-v1 codec migration across the editor, explorer, UI IPC, and WBA lanes. Cover:
- Which namespaces require `msgpack-v1` auth (`rpcCodec: "msgpack-v1"`)
- Browser encoder: `src/rpc/codec.ts`
- Python encoder/decoder: `frontend_rpc_codec.py` with strict auth validation
- WBA encoder: `workbench_protocol_proxy/node_workbench_adapter/src/protocol/messagepack-codec.ts`
- The installed self-contained WBA codec at `dist/protocol/messagepack-codec.mjs`
- `FILE_EDITOR_CM6_RPC_CODEC_METRICS=1` env var for stdout metrics (declared `0` in shellspec)
- No JSON fallback on these lanes
- Sidebar IPC retains its current codec (not migrated)
- Android `UiIpcClient` is also a strict `msgpack-v1` consumer with `msgpack-core`

### M2 — Active-file authority model

**Repo memory:** "Active-file authority is `ProjectSidecar.last_file`, coordinated through `open_state_backend.py` and editor open services. Frontend path variables are projections."

**Code TE2.md status:** Section 4 describes SSOT and drafts but never mentions `last_file` or `open_state_backend.py`. The doc describes "active file" as `_history_store.get_session_state()` with `currentPath`, which is the projection, not the authority.

**Fix:** Add a note in Section 4 clarifying that `ProjectSidecar.last_file` is the active-file authority, `open_state_backend.py` coordinates it, and `currentPath` in session state is a projection.

### M3 — Socket.IO connection semantics (volatile.emit, no recovery)

**Repo memory:** "Code TE2 app-lane outbound traffic uses websocket-only `volatile.emit` with connected-state guards, so Socket.IO's client `sendBuffer` is not used. First-connect startup work may wait for readiness, but after the first connection disconnected RPC requests fail, notifications and terminal input drop, and in-flight requests reject; explicit connect handlers rebuild authoritative state. Python uses a local `AsyncManager` with no disconnected-session recovery, and WBA explicitly leaves `connectionStateRecovery` disabled."

**Code TE2.md status:** Not mentioned. The doc implies persistent reconnection in several places.

**Fix:** Add a section on connection semantics covering:
- `volatile.emit` outbound with connected-state guards (no `sendBuffer`)
- Disconnected behavior: RPC fails, notifications drop, in-flight rejects
- Python `AsyncManager` with no disconnected-session recovery
- WBA `connectionStateRecovery` explicitly disabled
- Explicit connect handlers rebuild authoritative state

### M4 — Code-server installation resolution

**Repo memory:** "Code TE2 resolves one code-server installation for launch, version probing, builtin extensions, and WBA nid extraction. Resolution prefers `TE2_CODE_SERVER_BIN`, then `PATH`, the login shell, NVM installations, `$PREFIX/bin`, and `~/.local/bin`. The resolved launcher directory is prepended to the code-server process `PATH` so NVM's `#!/usr/bin/env node` launcher works even when NVM was not initialized in the app-worker shell."

**Code TE2.md status:** Section 30 documents `te2_rpc_config.json` auto-discovery and mentions `TE2_CODE_SERVER_BIN` once (line 2874) but doesn't describe the full resolution chain or the `PATH` prepending for NVM compatibility.

**Fix:** Add to Section 30 or Section 0.5 the full code-server resolution order and the NVM `PATH` prepend behavior.

### M5 — WBA MessagePack codec bundling

**Repo memory:** "The installed WBA MessagePack codec is one self-contained bundled ESM file at `workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs`. The rest of the WBA module graph remains split, and installed runtimes must not resolve `@msgpack/msgpack` from the development `node_modules` tree."

**Code TE2.md status:** Not mentioned. The doc's WBA sections (0.5, 17) describe the adapter's protocol handling but not the codec bundling constraint.

**Fix:** Add a note in Section 0.5 or Section 17 about the self-contained codec bundle and the constraint against resolving `@msgpack/msgpack` from `node_modules`.

### M6 — WBA nid extraction version compatibility

**Repo memory:** "WBA nid extraction structurally parses the minified `MainContext` and `ExtHostContext` proxy objects and accepts JavaScript factory identifiers such as both `N` (Code OSS 1.109) and `$` (Code OSS 1.117). When `extHost.protocol.ts` ships with code-server, its declaration order is a fallback and cross-check. The uploaded code-server 4.117 bundle was verified as an exact 160-entry match to its pinned Code OSS commit `10c8e557c8b9f9ed0a87f61f1c9a44bde731c409`."

"WBA language-intelligence requests receive the resolved `ExtHostLanguageFeatures` nid through their runtime adapters. The numeric `94` is retained only as the Code OSS 1.109 fallback in `RPC_DEFAULTS`; no hover, completion, symbol, folding, semantic-token, inlay-hint, inline-completion, or document-color call site hard-codes it."

**Code TE2.md status:** Section 30 documents the nid system but stops at Code OSS 1.109/1.117. The doc doesn't mention that `94` is only a fallback now or that all call sites use named lookups.

**Fix:** Update Section 30 to note that all language-intelligence call sites use named `_rpcIds.ExtHostLanguageFeatures` lookups, and `94` is only the 1.109 fallback in `RPC_DEFAULTS`.

### M7 — Inline editor z-index policy

**Repo memory:** "The inline Monaco editor host remains at `z-index: auto`. Only its `.find-widget` is raised to `z-index: 300`, above drawers and resize handles but below framework dropdowns and modals; editor-container overflow clipping remains intentional."

**Code TE2.md status:** Not mentioned.

**Fix:** Add a brief note in Section 8 (UI knobs) about the z-index policy.

### M8 — Default Monaco font

**Repo memory:** "Code TE2's default Monaco font is the locally vendored `JetBrains Mono Nerd` family under `app/static/fonts/jetbrains/webfonts/`, with regular, italic, bold, and bold-italic faces declared by the app template. Monaco enables `fontLigatures`; a custom font preference can replace the default family."

**Code TE2.md status:** Section 8 mentions "font family (default JetBrains Mono)" (line 899) but doesn't specify the Nerd Font variant, the webfont path, or `fontLigatures`.

**Fix:** Update Section 8 to specify `JetBrains Mono Nerd` from `app/static/fonts/jetbrains/webfonts/` and note `fontLigatures` is enabled.

### M9 — Android Gboard textarea transaction (Monaco)

**Repo memory:** "Android Gboard recomposition handling is authored in `worktrees/vscode-te2-diff` at the Monaco `TextAreaEditContext`/`TextAreaInput` boundary. Android uses a physically detached textarea containing `\u21dd` + the complete model line + two trailing newlines. Native `input` events coalesce to one latest-value read per animation frame; one cumulative UTF-16 range edit is applied before a generation-guarded canonical reseed. Android composition start/update/end events do not gate input or create Monaco's visible composition textarea. Selection-only native movement does not move Monaco, and synthetic taps flush accepted browser-owned text before pointer relocation. ... Monaco native `EditContext` is intentionally disabled when `browser.isAndroid` is true, even if Chromium exposes the API."

**Code TE2.md status:** Section 35 covers the Android GeckoView IME filter (Kotlin InputConnection wrapper) but doesn't mention the Monaco-side Gboard textarea transaction fix in `worktrees/vscode-te2-diff`. The detached textarea, the `EditContext` disable for Android, and the publication path (`editor-distro` → `app/static/vendor/monaco-editor-core/esm` overlay → rebuild `host.js`) are all absent.

**Fix:** Add a new section or extend Section 35 to cover:
- The Monaco `TextAreaEditContext`/`TextAreaInput` boundary fix
- Detached textarea with `\u21dd` prefix
- Per-animation-frame coalescing
- `EditContext` disabled on Android even if Chromium exposes it
- Publication pipeline: `editor-distro` → ESM overlay → bootstrap regen → `host.js` rebuild

### M10 — Code-server readiness as pipeline gate

**Repo memory:** "Code-server readiness gates adapter startup." (already in doc Section 5 line 44, but the deeper implications aren't documented)

**Minor:** already partially covered but could be expanded.

### M11 — Search system (progressive pipe-based)

**Repo memory:** "Code TE2 Git and search jobs use Rust pipe services. The old generic Python Git job registration/listener is gone; generic Python jobs remain only for current non-Git app work such as archive extraction."

**Code TE2.md status:** The doc's Section 6.5 lists `search:query` (stale — see item 6.5.1). The progressive search system (`service.search` pipe, `search.files.start`, `search.content.start`, `search.job.cancel`, `search_sessions.py`, 700-match cap, `explorer.search.run`/`explorer.search.more`/`explorer.search.moreInFile` RPC methods) is entirely absent.

**Fix:** Add a new section documenting the search system:
- Progressive search backed by Rust `service.search` pipe
- Methods: `search.files.start`, `search.content.start`, `search.job.cancel`, `search.job.progress`, `search.job.result`, `search.job.done`, `search.job.error`
- Python session cache in `search_sessions.py` (slots dataclasses, tuple ranges)
- `maxMatchesTotal: 700` cap imposed by Python
- Explorer RPC methods: `explorer.search.run`, `explorer.search.more`, `explorer.search.moreInFile`, `explorer.search.cancel`
- Match limit reporting via `matchLimit` and `truncatedReason: "matchLimit"`

### M12 — `te2` console CLI

**Source evidence:** `app/cli/console_cli.py` owns the `te2 console` CLI entry
for `list-workers`, `eval`, `tail`, and `search`.

**Code TE2.md status:** Section 25 documents the console observability system but doesn't mention the `te2 console` CLI subcommands (`list-workers`, `eval`, `tail`, `search`).

**Fix:** Add to Section 25 the CLI interface: `te2 console list-workers`, `te2 console eval --worker <id> (--code | stdin)`, `te2 console tail [--worker] [--limit] [--level]`, `te2 console search "query" [--worker] [--limit] [--level]`.

### M13 — Console eval promise handling improvements

**Recently added:** The Code TE2 main-page console bridge now has
`Promise.race` timeout, `console:evalCancel` signal, disconnect cleanup, and a
`_pendingEvals` map. The Python runtime passes `timeoutSeconds` in the eval
payload and emits `console:evalCancel` on timeout. Late results are logged. Do
not imply the shared static bridge has identical behavior unless it is updated
separately.

**Code TE2.md status:** Section 25's event table doesn't include `console:evalCancel` or `timeoutSeconds` in the `console:eval` payload.

**Fix:** Already covered in item 25.1 above, but reinforce here that this is a net-new feature, not just a field addition.


---

## Second current-architecture pass — missing late additions

### S1 — Run Profiles and runtime launchers

**Problem:** `CODE_TE2.md` had only the draft-save transaction summary. It did not document the broader runtime launcher shape: project-local `.code_te2/run_profiles.json`, supported runners (`pagePreview`, `node`, `python`, `custom`), profile matching/conflict rejection, shell managers, sidebar URL behavior, or the Page Preview default profile flow.

**Fix:** Expand Section 37 to cover the config schema, runner dispatch, shell managers, save policies, confirmation/revalidation, and Run Profiles modal ownership.

### S2 — Electron desktop client integration

**Problem:** `CODE_TE2.md` did not cover the active desktop client. Current source and repo memory identify `desktop_client/electron_spike/` as the active Linux desktop client, with `desktop_client/ui.py` retained only as a behavioral reference.

**Fix:** Add a Desktop Client section covering the Electron shell runtime shape, relay/assets, `window.te2Electron`, console worker labels, native commands, offline behavior, and validation owner docs.

### S3 — WBA logical documents and multi-file extension handling

**Problem:** The document did not explain the retained WBA logical-document registry or the sidecar-to-WBA reconciliation system that supports multi-file extension-host behavior while keeping visible editor open non-blocking.

**Fix:** Add a WBA Logical Documents section covering Python metadata-first reconcile, WBA `document-registry.ts`, `vscode.logicalDocuments.reconcile`, `vscode.logicalDocuments.hydrate`, active/background/provisional roles, draft-aware materialization, extension activation, and language resolution.

### S4 — Code Inspector and navigation

**Problem:** The document did not cover the current Code Inspector projection path or the direct Go to Definition path.

**Fix:** Add a Code Inspector and Navigation section covering WBA provider dispatch, backend-retained projections, `/ui_ipc` projection, call-hierarchy lifecycle, source-preview enrichment, and direct editor-to-WBA Go to Definition.
