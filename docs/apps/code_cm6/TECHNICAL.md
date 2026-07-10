# Code TE2 Technical Orientation

This file replaces the retired Python-framework-era deep dive. It is a compact
orientation page; current source remains authoritative.

## Runtime Context

Code TE2 is the `file_editor_cm6` application running behind the Rust/Axum TE2
framework. Rust owns the app catalog, lifecycle, proxying, readiness, framework
services, and Ferrous Framework-Shells integration.

The app backend remains a manifest-launched Python app worker. That worker is an
application process started and managed by Rust/Ferrous, not a Python framework
or compatibility runtime.

There is no TE2 Python supervisor, IPC process registry, or `app.main` framework
process in the supported architecture.

## Current Process Shape

```text
packaged Python launcher
  -> console/FastMCP Python sidecar
  -> Rust/Axum TE2 server
       -> native Ferrous Framework-Shells manager
       -> manifest-launched file_editor_cm6 app worker
       -> Code TE2 support shells such as WBA, code-server, terminals, and runners
```

The sidecar exists because Axum proxies the current TE2 console and FastMCP
surfaces to their Python implementation. It does not own framework lifecycle.

## Code TE2 Ownership

- `app/apps/file_editor_cm6/main.py` assembles the app worker.
- `app/apps/file_editor_cm6/main.ts` is the host frontend entrypoint.
- `app/apps/file_editor_cm6/main_page/frontend/` owns host/main-page UI.
- `app/apps/file_editor_cm6/monaco_editor/` owns the editor frontend and editor
  backend services.
- `app/apps/file_editor_cm6/src/explorer/` owns the Explorer frontend.
- `app/apps/file_editor_cm6/explorer/` owns Explorer backend behavior.
- `app/apps/file_editor_cm6/ui_ipc/` owns host/sidebar IPC backend behavior.
- `app/apps/file_editor_cm6/workbench_protocol_proxy/` owns the WBA boundary.

Frontend surfaces send intent only over their assigned RPC lane. Durable state,
cross-surface orchestration, open-file authority, and project state remain
backend-owned.

## Current References

- `AGENTS.md` for workflow, source map, ownership, and RPC invariants.
- `.repo_memory.md` for concise durable runtime facts.
- `docs/apps/code_cm6/CODE_TE2.md` for the detailed editor wiring reference.
- `docs/planning/FILE_EDITOR_CM6_OWNERSHIP_BOUNDARY_CONTRACT.md` for ownership
  and RPC reference material.
- `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md` for longer-term
  direction.

Some detailed planning documents intentionally preserve migration history. If
they describe the deleted Python framework or conflict with current source,
they are historical evidence rather than a runtime contract.
