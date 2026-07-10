# Shared Python App-Worker Libraries

`app/libs/` contains Python support used by current app workers. It is not the
TE2 framework implementation; framework lifecycle and shared filesystem, Git,
search, state, and proxy services are Rust-owned.

Current modules:

- `app_worker.py` — loads one app backend and serves its FastAPI/Socket.IO and
  pipe-facing runtime.
- `pipe_protocol.py` — typed JSONL envelope definitions for Rust/Python pipe
  communication.
- `pipe_runtime.py` — app-worker request, response, and notification dispatch
  over that pipe.
- `jobs.py` — generic in-process background jobs still used by non-Git app work.
- `archiver.py` — safe archive listing/extraction through `libarchive-c`.
- `archiver_service.py` — Archive Manager projections and extraction job
  registration.

Code TE2 Git and search operations use Rust framework services through the pipe
runtime. Do not add local GitPython, filesystem, or search fallbacks here.
