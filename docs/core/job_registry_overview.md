# App-Worker Job Helpers

`app/libs/jobs.py` is retained because current Python app backends import its
job manager and handler registration helpers. It is not a Rust framework
service and is not automatically mounted by the framework.

Current consumers include:

- Archive Manager, which creates extraction jobs through the shared manager;
- File Explorer, which registers bulk copy and bulk move handlers.

Jobs are process-local to the Python app-worker environment that imports the
module. Their metadata persists under
`~/.cache/termux_extensions/jobs.json`; interrupted pending/running jobs are
classified when the manager reloads that file.

The module still defines a FastAPI router with `/api/jobs` list/detail/create,
cancel, delete, and event-stream routes. Those routes exist only in an app that
explicitly includes `jobs_bp`; the Rust framework does not discover or mount
them.

Use native Ferrous Framework-Shells for long-running processes. Use Rust
framework-service jobs for work that belongs to a framework provider. Keep
`app.libs.jobs` limited to app-worker behavior until its remaining consumers are
ported or removed.
