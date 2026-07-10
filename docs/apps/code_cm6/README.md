# Code TE2 (`file_editor_cm6`)

Code TE2 is TE2's Monaco-based workspace application. It provides the host
toolbar and menus, project Explorer, Monaco editor, sidebar app windows,
terminal surfaces, drafts and review flows, diagnostics, Git UI, and the
Workbench Adapter connection to code-server's extension host.

## Runtime Boundary

- The Rust/Axum TE2 framework owns app discovery, lifecycle, readiness,
  proxying, framework services, and native Ferrous Framework-Shells behavior.
- Rust/Ferrous starts the manifest-declared Python `file_editor_cm6` app worker.
- The app worker owns Code TE2 backend state and its editor, Explorer, UI IPC,
  Sidebar IPC, and terminal application lanes.
- The Node Workbench Adapter owns the code-server/workbench protocol boundary.
- Monaco and the host/Explorer frontends render backend-owned state and send
  user intent over their assigned RPC lanes.

The deleted Python framework, supervisor, and IPC process registry are not part
of this architecture.

## Source Map

- `app/apps/file_editor_cm6/main.py` — app-worker assembly
- `app/apps/file_editor_cm6/main.ts` — host frontend entrypoint
- `app/apps/file_editor_cm6/main_page/frontend/` — host/main-page frontend
- `app/apps/file_editor_cm6/monaco_editor/` — editor frontend and backend
- `app/apps/file_editor_cm6/src/explorer/` — Explorer frontend
- `app/apps/file_editor_cm6/explorer/` — Explorer backend
- `app/apps/file_editor_cm6/ui_ipc/` — host/sidebar IPC backend
- `app/apps/file_editor_cm6/workbench_protocol_proxy/` — WBA implementation
- `app/apps/file_editor_cm6/manifest.json` — app identity and launch metadata
- `app/apps/file_editor_cm6/sio_service.json` — public Socket.IO proxy routes

## References

- `AGENTS.md` — current workflow, ownership, and RPC invariants
- `docs/apps/code_cm6/CODE_TE2.md` — detailed wiring reference
- `docs/apps/code_cm6/STATEFUL_SIDEBAR_APPS.md` — sidebar app integration
- `docs/planning/FILE_EDITOR_CM6_OWNERSHIP_BOUNDARY_CONTRACT.md` — ownership
  reference material
- `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md` — longer-term direction

Current source wins if a historical plan or lower section of an older detailed
document disagrees with it.
