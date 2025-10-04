# Job & Notification Integration – Phase 2 Plan

## Current Snapshot

We now have the shared infrastructure in place:

- `app/static/js/te_ui.js` injects toast + persistent notification cards for both the launcher (`index.html`) and app shell (`app_shell.html`).
- `app/static/js/jobs_client.js` exposes a lightweight poller and cancel/delete helpers; both templates load it so `window.teUI` and `window.jobsClient` are always defined.
- `app/jobs.py` provides the background Job Manager with the `/api/jobs` route set, persistence under `~/.cache/termux_extensions/jobs.json`, and basic cancellation hooks.
- Archive extraction jobs are registered in `app/apps/archive_manager/backend.py` and now emit progress updates by parsing the `NN%` output. Cancellation kills the underlying `7zz` process.
- Archive Manager (`app/apps/archive_manager/main.js`) and File Explorer (`app/apps/file_explorer/main.js`) both enqueue extraction jobs, surface a persistent card (with cancel), and refresh the target directory on completion. Older synchronous extractions remain as fallbacks when the job helper isn’t available.

## Progress Update – 2025-10-04

- Added `bulk_copy` and `bulk_move` job handlers in `app/apps/file_explorer/file_explorer.py` with byte-level progress reporting, cancellation support, and per-item success/error summaries.
- File Explorer multi-select copy/move paths now submit background jobs and reuse the shared notification UI; legacy synchronous loops remain only as a fallback when job orchestration is unavailable.
- Extraction progress streaming switched to a character-buffered reader so 7-Zip `\rNN%` tokens update immediately while non-progress warnings stay out of the toast pipeline.
- Smoke-tested handlers via direct `JobContext` invocation (copy/move) using temporary directories to ensure jobs mark success, emit results, and leave files in the expected locations.

## Immediate Tasks (Validation)

1. **Manual testing**
   - Restart the supervisor so new scripts load (
     ```bash
     python -m app.supervisor
     ```
     ) and ensure only one instance owns port 8080.
   - Trigger extraction from the Archive Manager UI. Confirm:
     - Transient toast “Extraction started.”
     - Persistent card with live percent updates.
     - Cancel button works (card updates to “Extraction cancelled”).
     - On success, toast summarizes destination and filesystem view refreshes if the destination is currently open.
   - Trigger extraction of the same archive via the File Explorer “Extract” menu item. Expect identical card/toast behaviour.
   - Tail `~/.cache/termux_extensions/jobs.json` to verify job records (running → succeeded/cancelled) newline when the job completes.

2. **Edge cases**
   - Archives located outside `$HOME` (should be rejected).
   - Password-protected archives (ensure job surfaces the 7‑Zip error message).
   - Cancelling near completion (confirm we don’t double-fire success toast).

## Next Development Phases

### Phase A – Bulk File Operations via Jobs

Move the heavy file copy/move loops off the main thread:

1. ✅ Add job handlers in `app/apps/file_explorer/file_explorer.py` for `bulk_copy` and `bulk_move` (progress, cancellation, per-item result payloads).

2. ✅ Update File Explorer `copySelected` / `moveSelected` to dispatch background jobs when orchestration is available, falling back to the legacy loops otherwise.

3. 🔄 Validate UI flows in-browser: confirm notification variants for partial failures, ensure cancel stops work-in-flight, and verify refresh behaviour when source/destination views are open.

### Phase B – Notification UX Enhancements

1. Persist active notification cards via `teState` so a refresh keeps them visible.
2. Provide a “Jobs” panel/badge in the UI (optional) to list running/completed jobs.
3. Allow jobs to post completion notifications automatically (e.g., from the job manager when status transitions to `succeeded`/`failed`).

### Phase C – Additional Job Types

1. Hook Archive Manager’s “Test archive” and “Create archive” actions into the registry.
2. Extend File Explorer to queue new jobs (e.g., compression, deletion with progress, remote downloads) as needed.

## Coordination Notes

- `py7za` doesn’t expose the promised `SevenZip` streaming API; we’re staying with the direct `7zz` parsing approach for now.
- All changes remain local until explicit confirmation—no further pushes until tests pass and you give the go‑ahead.
- Markdown references for plan/execution: `docs/job_registry_overview.md`, `docs/job_notification_phase2_plan.md` (this file).

## Open Questions

- Do we want to auto-persist `window.teUI.notify` cards across page reloads (using `window.teState`) before rolling into app integrations?
- How aggressive should auto-refresh be for copy/move jobs (refresh both source and destination?)
- Should the notification cards offer a “View logs” link once jobs finish? (Currently we truncate output.)
- Need visual confirmation that partial-failure jobs surface the warning banner and that toasts/readouts stay legible on mobile.
