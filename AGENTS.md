# AGENTS.md instructions for `/data/data/com.termux/files/home/mrselect6`

## Delegation Rule

Sub-agent rule: If this session/task was delegated by another Codex agent, do not follow the repository workflow/orchestration steps below unless explicitly told to do so. Execute only the assigned subtask and return results to the parent agent.

Parent/orchestrator rule: The workflow/orchestration steps below are intended for the top-level agent coordinating work.

## Safety Protocol

### Unsandboxed Execution

- **Mandate:** I operate in an unsandboxed environment. All file-system changes and commands happen directly on the user's system.
- **Express consent required:** I will **NEVER** make codebase or file-system changes without the user's explicit consent for a specific plan. There is no implied consent.

### Shared Framework Server

- I will **NEVER** restart the shared main framework server (`python -m app.main`) for feature work, verification, or debugging unless the user explicitly tells me to do that exact action.
- I will treat the main `app.main` process as shared infrastructure that may be serving the harness and other active agents/projects.
- If I think a restart is needed, I will stop and ask first.

## Standard Approval Workflow

I follow an approval-based workflow for new repo tasks so the user stays in control.

### Step 1: Restate and Confirm

1. Restate the prompt in a clear, structured way. This is the **Prompt Approval** stage.
2. For bug fixes, summarize the reported issue.
3. For features or changes, outline the requested behavior.
4. For Markdown instructions, summarize the document goals and implied actions.
5. Do not proceed until the user explicitly approves the restatement.

### Step 2: Investigate and Propose a Plan

1. After prompt approval, inspect the relevant code and docs.
2. Produce a concrete, actionable plan.
3. Present that plan for **Final Approval**.
4. Do not execute the plan until the user explicitly approves it.

### Step 3: Execute the Approved Plan

- Execute only the approved plan.
- If the investigation changes the plan materially, stop and ask for approval again.
- Preserve user changes. Do not revert unrelated work.

### Step 4: Same-Task Followups

- After the initial workflow is complete, same-task interaction may become more fluid.
- The core rule still applies: before making further changes, get explicit approval for the new change.

### Approval Tool Hierarchy

When requesting prompt approval or final plan approval for this repo, use this order:

1. built-in harness user-input or approval tool, when available
2. MCP user-input or approval tool, when no built-in tool is available
3. plain assistant message only when no approval tool is available

Before asking the user anything, check which built-in and MCP user-input / approval tools are actually available in the current tool inventory.

If a choice-capable approval tool such as `ask_user` is available, include at least one explicit button/choice option. Freeform input may supplement the choices, but freeform alone does not satisfy this requirement.

## Inquiries

Questions are handled case by case.

- If the answer is already known, answer directly.
- If the question requires reading files/code, restate the question first to confirm the target before continuing.
- If the user asks for read-only inspection, keep it read-only.

## Workflow Scope

- This workflow governs work on this repo.
- This repo is also a tool/platform used to work on other repos.
- Do not assume downstream target repos, sibling worktrees, or related repos inherit this repo's workflow or approval rules unless those repos explicitly define them.
- `android/` is read-only by default. Inspecting is fine; modifying, moving, deleting, or formatting files under `android/` requires explicit approval for that directory.

## User Direct Statements

If the user makes a direct statement about this repo's code, architecture, or runtime behavior, treat that statement as authoritative unless an actual code reference proves otherwise.

Do not question the user from documentation, stale memory, or assumptions. If the user appears wrong, push back only with the exact code path that proves it.

## Repo Basics

This repo is the TE2 framework/workspace repo. The main user-facing workspace app is `file_editor_cm6` / Code TE2: a Monaco-editor workspace with Explorer, host toolbar/menus, sidebar shortcut windows, terminal surfaces, diagnostics, draft/review flows, and the Workbench Adapter (WBA).

Use these references before guessing:

- `.repo_memory.md` for concise current repo memory
- `AGENTS.md` for the repo workflow gate
- `docs/apps/code_cm6/CODE_TE2.md` for Code TE2 orientation
- `docs/planning/FILE_EDITOR_CM6_OWNERSHIP_BOUNDARY_CONTRACT.md` for workspace ownership/RPC reference material
- `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md` for the broader direction

Source wins over docs if they disagree. `.repo_memory.md` and current source are the first check for current repo facts; planning docs can lag implementation.

## Important Acronyms

- WBA = Workbench Adapter, the Node/code-server adapter under `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/`.
- FWS = Framework-Shells, the shell/runtime orchestration system and sibling package maintained with this repo family.

## Current Source Map

Core framework and app entrypoints:

- `app/main.py` - TE2 framework entrypoint
- `app/apps/file_editor_cm6/main.py` - `file_editor_cm6` app worker
- `app/apps/file_editor_cm6/main.ts` - main host frontend entrypoint
- `app/apps/file_editor_cm6/manifest.json` - app manifest
- `app/apps/file_editor_cm6/sio_service.json` - Socket.IO service topology
- `app/apps/file_editor_cm6/socketio_gateway.py` - app Socket.IO gateway

`file_editor_cm6` frontend and backend areas:

- `app/apps/file_editor_cm6/main_page/frontend/` - host/main-page frontend
- `app/apps/file_editor_cm6/monaco_editor/` - Monaco editor frontend and editor backend services
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts` - active editor frontend entrypoint
- `app/apps/file_editor_cm6/src/explorer/` - Explorer frontend
- `app/apps/file_editor_cm6/explorer/` - Explorer backend services and RPC transport
- `app/apps/file_editor_cm6/ui_ipc/` - host/sidebar IPC backend
- `app/apps/file_editor_cm6/host/` - host-owned backend actions
- `app/apps/file_editor_cm6/workbench_protocol_proxy/` - code-server/WBA integration

Open-file and project state authority:

- `app/apps/file_editor_cm6/open_state_backend.py`
- `app/apps/file_editor_cm6/project_sidecar.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/open_service.py`

Generated or bundled outputs such as `app/apps/file_editor_cm6/static/dist/` are not the source of truth unless the task explicitly targets built assets.

## `file_editor_cm6` Ownership Boundary

The boundary rules below are for the `file_editor_cm6` workspace app.

Frontend surfaces initiate user intent and render state. Durable authority, cross-surface orchestration, and project/editor state changes belong in backend hooks or backend services.

Surface ownership:

- Host/main page owns toolbar/menu initiation, sidebar and terminal drawer shells, preferences UI, save/run/draft discard initiation, and host-level panels.
- Editor frontend owns Monaco rendering, active-document behavior, editor commands, file-scoped decorations, editor mentions, draft diff UI, and editor review interactions.
- Explorer frontend owns tree rendering, Explorer context menus, project/file navigation intent, and Explorer-scoped presentation.
- Sidebar shortcut/windows lane owns sidebar window activation, sidebar IPC, cwd/project sync, sidebar mentions, and sidebar-originated editor/project effects through backend hooks.
- Terminal backend owns shell/session selection and execution.
- WBA owns code-server/workbench intelligence such as language features, diagnostics production, and extension-host interaction.

Do not move authority into a frontend because it is convenient. If a surface needs another surface to do something, the surface sends intent on its own lane; its backend calls the appropriate backend hook.

## RPC Lane Rules

Each `file_editor_cm6` frontend element MUST use only its own RPC lane. No frontend should directly call another frontend's socket, namespace, or private API.

Current lanes:

- Editor frontend -> `/rpc/editor` namespace, Socket.IO path `/editor_ws/socket.io`; backend in `monaco_editor/editor_rpc_dispatch.py`, `monaco_editor/editor_ws.py`, and editor backend services.
- Explorer frontend -> `/rpc/explorer` namespace, Socket.IO path `/explorer_ws/socket.io`; backend in `explorer/transport/rpc_socketio.py`, `explorer_runtime.py`, and Explorer handlers/services.
- Host/main-page frontend -> `/ui_ipc` namespace, Socket.IO path `/ui_ipc_ws/socket.io`; backend in `ui_ipc/rpc_dispatch.py` and `host/*`. UI IPC owns host/sidebar frontend UI updates and URL-apply commands.
- Sidebar shortcuts/windows -> `/sidebar_ipc` namespace on the app Socket.IO service, currently reached through the UI IPC Socket.IO path; backend in `ui_ipc/sidebar_ws.py` and sidebar RPC contract files. For stateful sidebar app windows, Sidebar IPC is a backend-only app API lane: app frontends send state to their own backend, and app backends send app lane data plus the exact URL to open over Sidebar IPC.
- Terminal frontend/shell surfaces -> `/terminal` namespace, Socket.IO path `/terminal_ws/socket.io`; backend terminal services and routes.
- WBA/code-server intelligence -> `/wba` namespace, Socket.IO path `/wba_ws/socket.io`; Node adapter side owns this lane.
- TE2 console -> `/te2_console` namespace, Socket.IO path `/te2_console_ws/socket.io`; framework-owned console/debug lane.

Examples of respecting the boundary:

- Explorer open: Explorer UI sends `explorer.editor.open` on the Explorer RPC lane. The Explorer backend resolves the request, calls the editor backend open hook, and the editor backend records sidecar/open state and emits editor/open-state updates through the editor lane. Explorer UI does not call the editor socket directly.
- Editor mention: Editor UI sends `editor.mention.request` on the editor RPC lane. The editor backend relays to the sidebar mention system, which fans out through `/sidebar_ipc`. Editor UI does not speak to `/sidebar_ipc` directly.
- Host diagnostics mention: Host UI sends `ui.host.diagnostics.mention` on `/ui_ipc`. The host backend calls the sidebar mention helper. Host UI does not bypass its lane.
- Stateful sidebar app URL update: app frontend constructs the state URL, posts it to its own app backend, and the app backend sends `sidebar.window.openUrl` over `/sidebar_ipc`. UI IPC applies the persisted URL to the sidebar frontend iframe stack.

If a new action crosses domains, model it as: surface frontend -> that surface's RPC lane -> that surface's backend -> target backend hook/service -> target surface notification on its own lane.

## Open File Authority

Active open-file authority is backend-owned. The durable sidecar value is `ProjectSidecar.last_file`, coordinated by `open_state_backend.py` and editor open services.

Do not treat transient frontend values such as `currentPath` as the cross-client source of truth. They are projections of backend state.

## Existing Methods First

- If the user names an existing method, function, or pattern, reuse it.
- If an existing method likely exists, search for it before inventing a new one.
- Do not reimplement a local convention. If the codebase has a drawer toggle, Explorer scroll method, RPC helper, or backend hook, use that path.

## Build and Formatting

If frontend source under `app/apps/file_editor_cm6/` changes, rebuild before testing:

```bash
cd app/apps/file_editor_cm6 && node build.mjs
```

Rationale: the app serves built bundles from `static/dist/`.

- Smoke tests must start as their own command. Do not chain setup before a smoke with `&&` unless the user explicitly approves it.
- Chaining after a smoke step is acceptable.
- After follow-up build work, rerun smoke as a separate command when feasible.
- Prettier is installed and in `PATH`; use it for Markdown/JS/TS formatting when appropriate.

Android asset publication is separate from normal live app work. Only run the Android bundled-asset publication chain when the user explicitly asks to republish bundled Android assets.

## Search Discipline

Use targeted search. Prefer `rg --files` for discovery, then search only the source directories relevant to the task.

No blind content searches in high-noise/generated roots unless the user explicitly asks:

- `node_modules/`
- `build/`
- `worktrees/**/build/`
- `app/apps/file_editor_cm6/static/dist/`
- `app/static/vendor/`
- `android/app/build/`
- `*.map`, `*.min.js`, `*.min.css`, `*.bundle.js`

For known minified/bundled files, keep inspection stream-only:

```bash
prettier /path/to/file.js 2>/dev/null | nl -ba | rg -n "pattern"
```

For unknown files, first narrow candidates:

```bash
rg -l -g'*.js' -g'!*.map' "anchor" app/apps/file_editor_cm6
```

Then prettify only those candidates. Do not write fallback formatted files unless the user explicitly approves it.

## Runtime Inspection

When debugging live Code TE2 behavior, inspect the exact current worker/runtime instead of assuming a stale worker or old iframe shape.

- For app/WBA process facts, use FWS/live shell visibility when available.
- For `file_editor_cm6` host/editor frontend state, the relevant runtime is usually the main page workspace surface.
- Do not reload or restart shared runtime infrastructure without explicit user approval.
- Do not blame browser cache without concrete evidence such as headers proving a stale asset.

## Agent Log

Use the agent log for coordination with other agents and verified edit summaries when the user asks or when a verified round of work should be recorded.

- Prefer the agent-log MCP tool if available.
- All repo summaries posted to the agent log must start with `[TE2]`.
- Agent log is for coordination/status, not long-lived architecture memory.

## Repo Memory

`.repo_memory.md` is the concise durable memory file for this repo. Use it when resuming after context loss, handoff, or uncertainty about current architecture.

Prefer focused repo-memory updates over long one-off summaries. Do not preserve stale facts when current source or user direction supersedes them.

## Core Working Principle

There is no "we can't do this unless we do that, so we're not doing it." There is only, "we can't do this unless we do that, so we're going to do that."
