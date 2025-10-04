# Toast Notifications & Job Registry Plan

> Markdown conversion of the original document. Code samples are fenced with proper languages so they render correctly in most markdown viewers.

---

## 1. Architecture Overview

### 1.1 Notification System Architecture

The notification system introduces a unified toast/notification component available in both the launcher (main index) and the app shell contexts. A global `window.teUI` notification module will manage two types of notifications:

- **Ephemeral toasts** – short‑lived messages (e.g., 3 seconds) that auto‑dismiss. Example: “File deleted”, “Settings saved”.
- **Persistent notification cards** – longer‑lived messages (e.g., ongoing tasks or important results) that remain until the user dismisses them. They may include a description, optional progress indicator, and a close/dismiss control. Ideal for background job statuses (e.g., “Extracting archive…”) or completion results (“Archive extracted successfully”).

**Components & Data Flow**

- A notification container is appended to the DOM (in both `index.html` and `app_shell.html`).

```html
<!-- Mount this near the end of the body in both index.html and app_shell.html -->
<div id="te-notifications"></div>
```

- The global `window.teUI` exposes methods to create notifications. For example:

```js
// te_ui.js
if (!window.teUI) window.teUI = {};

// Ephemeral toast
window.teUI.toast = (message, duration = 3000, type = "info") => {
  // create a transient .toast node and auto-remove after duration
};

// Persistent notification card
window.teUI.notify = (options) => {
  // create/update a .te-notification-card element (with close/cancel)
};
```

- **DOM behavior**: Ephemeral toasts are created as `<div class="toast">` and auto‑removed. Persistent cards are created with additional structure (e.g., `<div class="te-notification-card">`), optional progress, and a close button that removes the card.
- **Styling & theming**: Use existing theme variables so notifications blend into the app (dark mode, etc.). Set a high `z-index` so notifications are not obscured. Consider bottom‑center for toasts and bottom‑right stacking for cards.
- **Persistence across reloads**: Persistent notification state is stored via `window.teState` (backed by `/api/state`) under a key like `notifications.active`. On page load, restore and re-render any saved persistent notifications. Ephemeral toasts are not persisted.
- **Uniform behavior**: `te_ui.js` is included by both pages to ensure `window.teUI.toast`/`notify` exist everywhere.
- **Failure handling**: If `teUI.toast` is called before the container exists, create the container on the fly. Limit notification volume (toasts auto‑remove; cards are a handful and user‑dismissed).

**Example CSS (indicative)**

```css
#te-notifications {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2000;
  pointer-events: none;
}
.te-notification-card {
  background: var(--card);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  margin-top: 8px;
  pointer-events: auto;
  min-width: 200px;
  max-width: 320px;
}
.te-notification-card.success { border-color: var(--success); }
.te-notification-card.error { border-color: var(--destructive); }
.te-notification-card .message { display:block; font-size:0.9em; margin-bottom:4px; }
.te-notification-card .progress-bar {
  width:100%; height:4px; background: var(--muted);
  border-radius:2px; margin:4px 0; overflow:hidden;
}
.te-notification-card .progress-fill {
  height:100%; width:0%; background: var(--primary);
  transition: width 0.3s;
}
.te-notification-card .close-btn {
  background:none; border:none; color:var(--foreground);
  float:right; font-size:1.2em; cursor:pointer;
}
```

**Example card structure**

```html
<div class="te-notification-card" data-job-id="job42">
  <button class="close-btn" title="Dismiss or Cancel">×</button>
  <span class="message">Copying files to /Download…</span>
  <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
</div>
```

**Restore & persist notifications**

```js
// On load
const saved = await teState.get('notifications.active', []);
saved.forEach(data => teUI.notify(data));

// On add/remove
const list = /* …recompute cards… */
await teState.set('notifications.active', list);
```

**Optional cancel/dismiss behavior**

```js
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.te-notification-card .close-btn');
  if (!btn) return;
  const card = btn.closest('.te-notification-card');
  const jobId = card?.dataset?.jobId;
  const running = card?.dataset?.status === 'running';
  if (jobId && running) {
    try { await teFetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' }); } catch {}
  }
  card.remove();
  // update persisted state
});
```

---

### 1.2 Job Registry System Architecture

A lightweight backend job manager handles short‑lived operations (≈5 seconds to 5 minutes), e.g. copy/move or archive extraction. It tracks job lifecycle and exposes status to the frontend.

**Job Manager (backend)**

- In‑memory registry (e.g., dict of job ID → metadata/state) with persistence to disk (e.g., `~/.cache/termux_extensions/jobs.json`).
- On startup, reload state. Mark previously running jobs as `aborted/unknown` if they didn’t complete.
- Execution via Python threads (or a thread pool). File operations are I/O‑heavy, so GIL contention is minimal.
- Isolation: validate and constrain paths to `$HOME`.
- Progress tracking: expose basic counters (e.g., `completed/total`). For extraction, progress can be coarse (spinner while running; success/failure at end).
- Communication: frontend polls `GET /api/jobs` every 1–2 seconds (MVP). SSE/WebSockets can be future enhancements.
- Restart behavior: jobs don’t survive a full server restart. Persist records and mark interrupted jobs. Optionally store child PIDs if using detached subprocesses.
- Limits: cap concurrent jobs (e.g., 3–5). Reject or queue additional requests.
- Cancellation: set a cancel flag; kill child process if applicable.
- Retention: prune old/finished jobs (e.g., last N or 24 hours) to keep the registry small.

**Integration with Notifications**

- Each job creation triggers a persistent card on the frontend (by job ID). Polling updates progress/status and final outcome. Dismiss removes the card and deletes the record (via API).

---

## 2. API Endpoints Specification

### 2.1 Notifications

No dedicated endpoints for basic notifications (client‑side + `teState` persistence via `/api/state`).

### 2.2 Job Registry API

Base path: `/api/jobs`

**Create job**

`POST /api/jobs`

```json
{
  "type": "<jobType>",
  "params": { /* job-specific */ }
}
```

Supported types and params:

- **copy**
  - Multi:
    ```json
    {"sources":["/path/src1","/path/src2"],"dest":"/dest/dir/"}
    ```
  - Single:
    ```json
    {"source":"/path/srcFile","dest":"/dest/dir/newName.ext"}
    ```
- **move** – same shapes as `copy`.
- **extract**
  ```json
  {
    "archive":"/path/to/file.zip",
    "dest":"/dest/dir/",
    "options": {"password": null, "overwrite": "rename"}
  }
  ```

**Response (on success)**

```json
{"ok": true, "data": {"job_id": "job42", "status": "running", "message": "Extracting foo.zip…"}}
```

**List jobs**

`GET /api/jobs`

```json
{
  "ok": true,
  "data": [
    {
      "id": "job42",
      "type": "copy",
      "status": "running",
      "progress": {"completed_files": 5, "total_files": 10},
      "message": "Copying 10 items to /Downloads"
    }
  ]
}
```

**Get a job**

`GET /api/jobs/<id>`

```json
{"ok": true, "data": {"id": "job42", "type": "extract", "status": "completed", "result": {"detail": "Archive extracted to /path"}}}
```

**Cancel a job**

`POST /api/jobs/<id>/cancel`

```json
{"ok": true, "data": {"id": "job42", "status": "canceled"}}
```

**Delete a job record**

`DELETE /api/jobs/<id>`

```json
{"ok": true, "data": null}
```

**Notes**

- Path validation confines operations to `$HOME`.
- Mutating operations follow the same local‑app trust model as the rest of the UI.

---

## 3. Frontend Integration Plan

### 3.1 UI Placement & State Management

- **Mount container** in both templates (see HTML snippet above).
- **Include** `te_ui.js` as a module in both `index.html` and `app_shell.html`.
- **Restore** persistent notifications from `teState` on load; **persist** changes on add/remove.
- **Start polling** `/api/jobs` when there is at least one active/running job; stop when none remain.

**Polling update behavior**

```js
const tick = async () => {
  const res = await teFetch('/api/jobs');
  for (const job of res.data) {
    teUI.notify({ id: job.id, message: job.message, persistent: true, status: job.status, progress: job.progress });
  }
  // stop polling if no running jobs
};
```

- **App refresh policy** (File Explorer): optionally refresh the current directory on completion when the destination/source matches the open path.

### 3.2 File Explorer changes (examples)

- **Archive extraction** – call `POST /api/jobs` with `{type:"extract", params:{...}}`; show persistent card immediately; rely on polling for completion; optional auto‑refresh on finish.
- **Copy/Move** – submit a single job with all sources; show progress `completed/total`; final card summarizes success/fail counts; optional auto‑refresh.
- Continue to use `teUI.toast` for quick errors/confirmations.

### 3.3 Archive Manager & other apps

- Switch any long‑running operations to the job API.
- Keep legacy endpoints temporarily for backward compatibility.

---

## 4. Rollout Strategy (Phases)

1. **Phase 0 – Prep & review**: confirm assumptions; identify touch points; no external libs needed.
2. **Phase 1 – Fix toast visibility**: ensure `teUI.toast` works in app shell.
3. **Phase 2 – Cards & persistence**: implement container, `te_ui.js`, card UI, and `teState` integration; stack and accessibility.
4. **Phase 3 – Backend JobManager**: threads, persistence, endpoints, validation, cancellation, limits; basic progress; tests.
5. **Phase 4 – Connect UI & API**: refactor File Explorer/Archive flows to job API; immediate card on create; remove synchronous waits; refresh policy.
6. **Phase 5 – Test & refine**: UI flows, cancellation, restart scenarios, performance; docs/changelog.
7. **Phase 6 – Deploy**: update both backend and frontend together; keep deprecated endpoints during transition.

---

## 5. Implementation Checklist & File Changes

**Frontend templates**

- `app/templates/index.html`
  - Add `#te-notifications` container.
  - Include `<script type="module" src="/static/js/te_ui.js"></script>`.
  - Remove/relocate any inline `window.teUI.toast` to the shared module.
  - Add CSS for cards (or include shared CSS).

- `app/templates/app_shell.html`
  - Add container & include `te_ui.js`.
  - Ensure any `host.toast = window.teUI.toast` style bindings resolve to the shared implementation.
  - Add CSS for cards (or include shared CSS).

**New frontend script**

- `app/static/js/te_ui.js`
  - Initialize `window.teUI.toast` and `window.teUI.notify`.
  - Create/manage card DOM; track by `id` (e.g., job ID).
  - Persist to `teState`; restore on load.
  - Poll `/api/jobs` while active jobs exist; update progress/status.
  - Wire close/cancel behavior.

**Backend**

- `app/jobs.py`
  - `JobManager` (create, update, cancel, delete; load/save registry; prune history).
  - Threaded executors for `copy`, `move`, `extract`.
  - Path validation against `$HOME`.

- Routes (e.g., in `app/main.py` via a Blueprint `jobs_bp`):
  - `POST /api/jobs`
  - `GET /api/jobs`
  - `GET /api/jobs/<id>`
  - `POST /api/jobs/<id>/cancel`
  - `DELETE /api/jobs/<id>`

**Compatibility**

- Keep legacy synchronous endpoints temporarily; UI migrates to jobs API.
- Guard polling to degrade gracefully if `/api/jobs` is unavailable (rare in controlled rollouts).

---

## 6. Future Enhancements (Stretch)

- **Push updates**: SSE/WebSockets for instant job events; optional general server notifications.
- **Job dependencies & batching**: groups/sequencing; combined progress.
- **Enhanced progress**: integrate with `7z` output; bytes/sec; ETA.
- **Persistent notifications across sessions**: show “completed while away”.
- **Android/system notifications**: via service worker or Termux APIs.
- **Notification center**: bell icon + panel; grouping/compression of completed jobs.
- **Extend job types**: unify downloads (Aria2) into the same notification UX.
- **Logs & details**: expandable card/log links; per‑file errors.
- **Concurrency policies**: per‑type constraints (e.g., serialize extracts to same target).
- **UI polish**: animations, icons, sound cues.

---

## Open Questions & Assumptions

- **Auto‑refresh**: conservative (manual refresh), with optional auto when destination/source equals current path.
- **Restarts**: interrupted jobs are flagged; not guaranteed to survive full app restarts.
- **Performance**: Python file ops OK for MVP; shell offload possible later if needed.
- **Cancel UI**: single button doubles as cancel when running and dismiss when done; can split later if confusing.

---

### Example Progress Shapes

```json
{"completed_files": 5, "total_files": 10}
```

```json
{"phase": "running"}
```

```json
{"detail": "Archive extracted to /path"}
```

