# Framework-Shells Integration

This document describes the current TE2 integration boundary. The supported
framework is the Rust/Axum server under `rust-spike/rust/`; the deleted Python
framework, supervisor, and IPC process registry are not compatibility paths.

## Ownership

- Rust creates and owns the native Ferrous Framework-Shells manager.
- `rust-spike/rust/crates/te2-rust-spike-server/src/launcher.rs` renders
  manifest shellspecs and starts app workers through that native manager.
- `rust-spike/rust/crates/te2-rust-spike-server/src/apps_lifecycle.rs` owns app
  start, open, quit, readiness, and lifecycle event publication.
- `rust-spike/rust/crates/te2-rust-spike-server/src/runtime_bridge.rs` exposes
  the FWS dashboard, Socket.IO, WebSocket, and `/api/framework_shells` surfaces
  through the Rust server.

There is no separate TE2 IPC server and no Python supervisor coordinating
shutdown. Framework termination and app-group shutdown are Rust/Ferrous-owned.

## Launch Flow

1. `app.cli.run_rust_framework` loads `rust-spike/app/bootstrap.py`.
2. The bootstrap prepares Framework-Shells environment and secret material,
   builds or reuses the fingerprinted Rust binary, and launches it.
3. The Rust server initializes its native Ferrous manager.
4. App start/open resolves the manifest and shellspec in Rust.
5. Ferrous renders and starts the requested shells, preserving app/subgroup
   metadata and pipe configuration.

Manifest-declared Python app workers are application processes, not a Python
framework fallback. Their normal shellspec command is
`python -m app.libs.app_worker`; Rust/Ferrous remains their lifecycle owner.

## Public Surfaces

The Rust server proxies the Ferrous-hosted runtime at these route families:

- `/fws` and `/fws/...`
- `/ws/fws` and `/ws/fws/...`
- `/fws_ws/socket.io` and descendants
- `/api/framework_shells` and descendants

Exact request and response contracts come from the active Ferrous package and
the Rust proxy implementation. Do not restore old Python manager APIs merely to
match historical documentation.

## Logs And Inspection

Use Framework-Shells/Ferrous metadata and log tools for process state, stdout,
stderr, and optional stdin metadata. TE2 console is a separate frontend/runtime
observability surface and does not represent shell stdio.

For the detailed Framework-Shells tool contract, use the installed package
documentation or `~/.cache/app_server/framework_shells_README.md` on a TE2
development host.

## Source References

- `rust-spike/app/bootstrap.py`
- `rust-spike/rust/crates/te2-rust-spike-server/src/main.rs`
- `rust-spike/rust/crates/te2-rust-spike-server/src/launcher.rs`
- `rust-spike/rust/crates/te2-rust-spike-server/src/apps_lifecycle.rs`
- `rust-spike/rust/crates/te2-rust-spike-server/src/runtime_bridge.rs`
- `app/libs/app_worker.py`
