# Shared Python Support Modules

`app/libs/` is not a framework plugin directory. The Rust framework does not
scan it, import every module, or auto-register Python routers.

The remaining modules are imported explicitly by manifest-launched Python app
workers:

- `app_worker.py` starts an app backend module selected by the Rust-rendered
  shellspec.
- `pipe_protocol.py` and `pipe_runtime.py` connect pipe-backed app workers to
  Rust framework-service providers.
- `jobs.py` provides the app-level background-job helpers still used by current
  app backends.
- `archiver.py` and `archiver_service.py` provide archive operations used by
  Archive Manager and File Explorer.

Framework lifecycle, app registry, proxying, Git, filesystem, search,
bookmarks, settings, and state are Rust-owned. Do not add a shared Python module
expecting automatic framework discovery; either import it from an app worker or
implement a framework service in Rust.

See `app/libs/README.md` for the concise module inventory and
`rust-spike/rust/crates/te2-rust-spike-server/src/framework_services/` for
framework-owned service implementations.
