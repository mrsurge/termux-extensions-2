# Prompt Brief: Toast Notifications & Job Registry

## Context
- Repository: `termux-extensions-2` — Flask backend + touch-friendly frontend for managing Termux sessions, helpers, and apps.
- Current pain points:
  1. **Toasts never render**: `window.teUI.toast(...)` calls succeed silently, but no UI appears. Likely a missing/hidden toast container or styling clash across launcher/app shell.
  2. **Short-lived operations lack lifecycle handling**: Archive extraction / bulk copy / large downloads run inline. No centralized progress, history, or restart awareness. Framework shells are *too heavy* for these transient tasks (they’re reserved for daemons like Open Interpreter or aria2 RPC).

## Goals for Deep-Research Model
Produce a fully scoped plan that:
1. **Delivers a reliable, persistent toast/notification system**
   - Survives page reloads (e.g. via cache/state store).
   - Works uniformly in launcher view *and* app shell.
   - Supports both transient “toast” popups and longer-lived dismissible cards.
   - Plays nicely with existing styling/theme variables (`app_shell.html` layout).

2. **Defines a lightweight job registry for short-lived tasks**
   - API endpoints for creating/listing/canceling jobs; consistent `{ ok, data }` envelope.
   - Execution model (threads, asyncio, subprocess wrapper, etc.) suited for 5s–5min jobs.
   - Progress & log capture surfaced to clients (polling, SSE, or WebSocket).
   - Persistence strategy so jobs survive brief restarts (cache file under `~/.cache/termux_extensions/`).
   - Security & rate limiting considerations (jobs should stay inside `$HOME`).
   - Guidance for integrating Archive Manager & File Explorer (e.g., extract/copy flows).

## Known Constraints & References
- Toasts currently invoked via `window.teUI.toast` from various apps; investigate `app/templates/index.html`, `app/templates/app_shell.html`, and `app/static/js/*` for implementation details.
- Job manager should not consume existing framework-shell quota; see `docs/framework_shells.md` for baseline lifecycle patterns worth emulating.
- Frontend apps load through the shared app shell `app/templates/app_shell.html` and expect helpers in `app/static/js/`.
- Backend is Flask; core helper modules live under `app/`. Existing APIs sit under `/api/...` and use the `{ ok, data|error }` convention.

## Deliverables Requested From the Model
1. Architecture overview for both systems (components, data flow, persistence, failure handling).
2. Endpoint specs (methods, payloads, response examples) for the notifications and job registry APIs.
3. Frontend integration plan (where to mount UI, state management, render patterns, progressive enhancement).
4. Rollout strategy: incremental steps, testing approach, migration/compat notes.
5. Implementation checklist & file touch list (backend modules, templates, JS helpers, docs).
6. Optional: suggestions for future enhancements (e.g., WebSocket push, job dependencies) clearly marked as stretch.

## Tone & Format Guidelines
- Output as a structured markdown proposal with numbered sections, subsections, and clearly labeled action items.
- Keep to < 3,000 words; concise but thorough.
- Call out any assumptions or open questions.

