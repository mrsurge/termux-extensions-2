# AGENTS.md

These instructions govern work in this repository. Current source code is the
architecture authority. Documentation and `.repo_memory.md` are orientation
aids and must be corrected when source proves them stale.

## Delegation

- These workflow rules apply to the top-level agent coordinating a task.
- A delegated sub-agent should perform only its assigned subtask and report to
  its parent unless the parent explicitly delegates workflow coordination too.

## Safety And Approval

This repository is commonly used in an unsandboxed environment.

- Never change repository or filesystem state without explicit user approval
  for a concrete plan.
- Preserve user changes and untracked files. Do not revert unrelated work.
- Use `$TEMPDIR` for scratch data when it is set. Otherwise use a clearly named
  workspace-local scratch directory. Do not hard-code `/tmp`.
- Treat `android/` as read-only unless the approved plan explicitly includes
  Android changes.
- Never restart or terminate the shared TE2 framework runtime unless the user
  explicitly approves that action. The shared runtime is the Rust TE2 server
  launched by `te2` / `app.cli.run_rust_framework`, not `app.main`.

## Approval Workflow

For a new repository task:

1. Restate the requested outcome and obtain prompt approval.
2. Investigate read-only and derive a source-backed plan.
3. Present the concrete edit and validation scope for final approval.
4. Execute only the approved scope.
5. Stop for new approval if investigation or implementation materially changes
   the plan.

Use a built-in approval/input tool when available, then an MCP choice-capable
tool such as `ask_user`, and plain chat only when neither exists. An approval
prompt must include at least one explicit choice.

Questions that can be answered without repository inspection may be answered
directly. A user-requested read-only inspection must remain read-only.

## User Statements And Source Authority

- Treat direct user statements about this repository as authoritative unless a
  current source path proves otherwise.
- Source wins over prose. Do not challenge the user from planning documents,
  stale memory, or historical paths.
- `docs/planning/` records designs and implementation history. It is not a
  declaration that every described path or phase is still current.
- Generated bundles are validation/publication artifacts, not editable source,
  unless the task explicitly targets generated output.

## Current Runtime Architecture

The supported framework is Rust-first:

```text
te2 / te2-rust
  -> app/cli/run_rust_framework.py
  -> rust-spike/app/bootstrap.py
  -> Rust server under rust-spike/rust/
       + Python runtime bridge for TE2 console/MCP
       + Python app workers launched through Framework-Shells/Ferrous
```

`rust-spike/` is a historical directory name. Its server is the current TE2
framework implementation, not an optional Python-framework experiment.

Python remains intentionally in these roles:

- CLI/bootstrap discovery in `app/cli/`
- runtime bridge services in `app/te2_runtime_mounts.py`,
  `app/te2_console_runtime.py`, and `app/te2_mcp/`
- manifest/scaffolding helpers in `app/extensions/apps/`
- app-worker and pipe support in `app/libs/`
- app backends under `app/apps/`

This is a hard framework cutover, not a Python compatibility arrangement.
Outside app code, retain Python only when the packaged Rust launcher, the
Axum-proxied console/FastMCP sidecar, or a Rust-launched app worker imports it.
Do not recreate the removed Python framework, supervisor, IPC server, app
lifecycle, generic-extension runtime, or duplicate Git provider. Framework
lifecycle, proxying, app registry, bookmarks/settings/state, Git, filesystem,
and search services are Rust-owned.

## Source Map

Framework and packaging:

- `pyproject.toml` — Python package metadata and `te2` entrypoints
- `requirements.txt` — Python runtime dependencies
- `app/cli/run_rust_framework.py` — installed CLI/bootstrap locator
- `rust-spike/app/bootstrap.py` — cached Rust build and launch orchestration
- `rust-spike/app/runtime_bridge.py` — Python console/MCP sidecar
- `rust-spike/rust/crates/te2-rust-spike-server/src/` — framework source
- `app/templates/` and `app/static/` — framework-served frontend assets
- `app/apps/` — built-in apps and app workers

Code TE2:

- `app/apps/file_editor_cm6/main.py` — app-worker assembly
- `app/apps/file_editor_cm6/main.ts` — host frontend entrypoint
- `app/apps/file_editor_cm6/main_page/frontend/` — host/main-page source
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts` — editor entrypoint
- `app/apps/file_editor_cm6/monaco_editor/` — editor UI and backend services
- `app/apps/file_editor_cm6/src/explorer/` — Explorer frontend
- `app/apps/file_editor_cm6/explorer/` — Explorer backend and RPC transport
- `app/apps/file_editor_cm6/ui_ipc/` — host/sidebar IPC backend
- `app/apps/file_editor_cm6/host/` — host-owned backend actions
- `app/apps/file_editor_cm6/workbench_protocol_proxy/` — WBA/code-server bridge

Open-file authority is backend-owned through `ProjectSidecar.last_file`,
`open_state_backend.py`, and editor open services. Frontend `currentPath` values
are projections, not cross-client authority.

## Code TE2 Ownership Boundary

Frontend surfaces initiate user intent and render state. Durable authority,
cross-surface orchestration, and project/editor state changes belong in backend
hooks or services.

- Host/main page owns toolbar and menu intent, sidebar and terminal drawer
  shells, preferences UI, save/run/draft-discard initiation, and host panels.
- Editor frontend owns Monaco rendering, active-document behavior, editor
  commands, file-scoped decorations, mentions, draft diff, and review UI.
- Explorer frontend owns tree rendering, Explorer menus, project/file navigation
  intent, and Explorer presentation.
- Sidebar windows own activation, Sidebar IPC, cwd/project sync, sidebar
  mentions, and sidebar-originated effects through backend hooks.
- Terminal backends own shell/session selection and execution.
- WBA owns code-server intelligence, extension-host interaction, diagnostics
  production, and language features.

If one surface needs another surface to act, use:

```text
surface frontend
  -> its own RPC lane
  -> its backend
  -> target backend hook/service
  -> target surface notification
```

Do not move authority into a frontend for convenience.

## RPC Lanes

Each frontend surface uses only its own lane:

- Editor: namespace `/rpc/editor`, path `/editor_ws/socket.io`
- Explorer: namespace `/rpc/explorer`, path `/explorer_ws/socket.io`
- Host/main page: namespace `/ui_ipc`, path `/ui_ipc_ws/socket.io`
- Sidebar backends: namespace `/sidebar_ipc` on the app Socket.IO service
- Code TE2 terminal: namespace `/terminal`, path `/terminal_ws/socket.io`
- Standalone Terminal app: raw WebSocket `/ws/app/terminal/terminal` (backend
  route `/ws/terminal`), with required `codec=msgpack-v1`
- WBA: namespace `/wba`, path `/wba_ws/socket.io`
- TE2 console: namespace `/te2_console`, path `/te2_console_ws/socket.io`

Sidebar IPC is a backend app API lane. Stateful app frontends publish state to
their own backend; that backend sends typed state/URL commands through Sidebar
IPC. Frontends must not call another surface's private socket or API directly.

The standalone Terminal app has one supported shell implementation:
`shellspec/node_terminal_stream.yaml`. Its persistent Node worker owns
`node-pty`, `xterm-headless`, sequence assignment, and serialized checkpoints.
Browser messages are binary MessagePack WebSocket frames. Framework-Shell pipe
messages are `uint32` big-endian length-prefixed MessagePack frames. Python uses
`msgspec.msgpack`; Node and the browser use `@msgpack/msgpack`. Do not restore
the removed Python/native shell types, JSON/base64 stream codec, log-tail replay,
or reopening of dead terminal shells.

The Terminal Python backend bootstraps its locked production Node dependencies
under `$XDG_DATA_HOME/te2/node_runtime/terminal`, fingerprinted by the package
lock, platform, architecture, and Node ABI. The shellspec receives the exact
resolved Node executable and runtime directory. Source `node_modules` is only a
development fallback; installed Python packages must not depend on it.

## Existing Methods First

- Search for an existing method, backend hook, RPC helper, or UI convention
  before adding a new one.
- Reuse named methods and patterns supplied by the user.
- Avoid parallel implementations of established runtime behavior.

## Build And Validation

For Code TE2 frontend source changes:

```bash
cd app/apps/file_editor_cm6
npm run typecheck
node build.mjs
```

The app serves generated bundles from `static/dist/`, but source remains the
authority. Android bundled-asset publication is separate and requires explicit
approval.

The primary Android application is the GeckoView `:app` module. The isolated
`:cefrium` application module evaluates Cefrium without applying its
resource-generating Gradle plugin to Gecko variants. It reuses shared Android
source and packaged assets but owns its activity, layout, manifest, and stable
loopback relay. Check for at least 2 GB of free disk before either Android
build. Validate the new module with `:cefrium:testDebugUnitTest` and
`:cefrium:assembleDebug`; retain `:app:testGeckoDebugUnitTest` and
`:app:assembleGeckoDebug` as the primary-renderer comparison.

For Rust framework work, preserve the target cache and validate proportionally
with Cargo formatting/check/tests. Do not delete `rust-spike/rust/target/` as a
routine cleanup step.

Smoke tests must begin as their own command. Do not prepend setup with `&&` to a
smoke command unless the user explicitly approves that shape.

## Search Discipline

Use `rg --files` for discovery and targeted `rg` searches. Avoid blind searches
through generated or high-noise roots:

- `node_modules/`
- `build/` and `**/build/`
- `worktrees/`
- `app/apps/*/static/dist/`
- `app/static/vendor/`
- `android/app/build/`
- maps, minified files, and bundles

Use `rg --no-ignore` / `rg -uuu` or an explicit path only when one of those
trees is the intended target. For known bundled JS, keep formatting inspection
stream-only; do not write prettified copies without approval.

## Runtime Inspection

- Inspect exact current workers and FWS shells instead of assuming a stale
  process or iframe shape.
- Use TE2 console tools for browser/runtime state and FWS tools for process and
  shell state.
- Do not blame browser cache without concrete header or asset evidence.
- Backend edits do not authorize a shared framework restart. Ask first.

## Repo Memory And Agent Log

- `.repo_memory.md` contains concise durable facts, not task history. Keep it
  synchronized with verified architectural changes.
- Agent logs are for short-lived coordination and handoff. Prefix repo summaries
  with `[TE2]` when an agent-log tool is used.
- Do not store a durable repo fact only in transient memory or an agent log.

## Working Principle

When a required prerequisite is missing, identify and address that prerequisite
within the approved scope instead of treating it as a reason to abandon the
requested outcome.

## Parallelization

Don't do it with the `ask_user` mcp tool. This is all. You may do it with any other task.
