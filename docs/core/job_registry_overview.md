# Job Registry Overview

The Job Registry is a lightweight background-execution framework for short-lived
operations (think archive extraction, multi-file copy/move tasks, etc.).
Framework shells remain the tool for long-running daemons; jobs focus on tasks
that should run asynchronously but finish within minutes.

## Key Concepts

- **Job** – An asynchronous unit of work tracked by ID, status, message, and
  optional progress/result payloads.
- **Job Status** – `pending`, `running`, `succeeded`, `failed`, or `cancelled`.
- **Job Handlers** – Python callables registered via
  `@register_job_handler("job_type")` in `app/jobs.py`. Handlers receive a
  `JobContext` that exposes helpers for progress updates, cancellation checks,
  and marking completion.
- **Persistence** – Job metadata is stored under
  `~/.cache/termux_extensions/jobs.json`. On restart, running/pending jobs are
  marked as failed so the UI can surface that interruption.

## API Endpoints

All endpoints live under `/api/jobs`.

| Method | Path                        | Purpose                         |
| ------ | --------------------------- | ------------------------------- |
| POST   | `/api/jobs`                 | Create a new job                |
| GET    | `/api/jobs`                 | List all known jobs             |
| GET    | `/api/jobs/<id>`            | Fetch details for a single job  |
| POST   | `/api/jobs/<id>/cancel`     | Request cancellation            |
| DELETE | `/api/jobs/<id>`            | Remove a finished job record    |

Create job payload example:

```json
{
  "type": "noop",
  "params": { "duration": 2.5, "message": "Testing" }
}
```

Successful creation returns `202 Accepted` and includes the initial job state.

## Frontend Helper

`app/static/js/jobs_client.js` exports utilities for polling the registry and
cancelling/deleting jobs. Example usage:

```js
import { createJobPoller } from '/static/js/jobs_client.js';

const poller = createJobPoller({
  interval: 2000,
  onUpdate: (jobs) => console.log(jobs),
});

poller.start();
```

Jobs can also be cancelled or removed programmatically:

```js
import { cancelJob, deleteJob } from '/static/js/jobs_client.js';
await cancelJob('job-1234');
await deleteJob('job-1234');
```

## Notifications

The new toast/notification module (`app/static/js/te_ui.js`) exposes:

- `window.teUI.toast(message, { variant, duration })` for transient toasts.
- `window.teUI.notify({ id, title, message, progress })` for persistent cards.
- `window.teUI.dismiss(id)` to remove a card.

Each page now loads `te_ui.js`, ensuring notifications behave consistently across
the launcher and app shell. Persistent cards are not yet stored automatically;
apps can use `window.teUI.getActiveNotifications()` with `teState` if they need
persistence.

## Next Steps

1. Implement real job handlers for archive extraction and bulk file operations.
2. Wire the Archive Manager and File Explorer flows to `POST /api/jobs` instead
   of performing long-running work inline.
3. Layer in a poller (via `jobs_client.js`) or WebSocket channel to update
   persistent notification cards with progress/completion info.
