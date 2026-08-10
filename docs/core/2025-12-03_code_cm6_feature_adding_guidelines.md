# Code TE2 Feature Guidelines

This document replaces the retired NiceGUI/CodeMirror-era feature guide. Code
TE2 now uses Monaco and typed backend-owned RPC lanes.

## Start With Ownership

- Host/main-page UI belongs under `main_page/frontend/` and sends intent over
  `/ui_ipc`.
- Editor UI belongs under `monaco_editor/` and sends intent over `/rpc/editor`.
- Explorer UI belongs under `src/explorer/` and sends intent over
  `/rpc/explorer`.
- Sidebar app backends use `/sidebar_ipc`; app frontends publish state through
  their own backend.
- Workbench language intelligence uses the direct adapter-owned `/wba` lane.

Durable state, project switching, file-open authority, and cross-surface
orchestration remain backend-owned. A frontend never calls another frontend's
private socket or API directly.

## Reuse Existing Seams

Before adding a method or transport, search for the current backend hook, RPC
contract, renderer helper, modal, drawer control, and state projector. New
cross-surface behavior follows:

```text
surface frontend
  -> that surface's RPC lane
  -> that surface's backend
  -> target backend hook/service
  -> target surface notification
```

Framework-wide Git, filesystem, and search work belongs in Rust framework
services. App-worker projections consume those providers through the existing
pipe boundary.

## Source And Build Rules

- Edit TypeScript/JavaScript source, not `static/dist/` output.
- After changing frontend source under `app/apps/file_editor_cm6/`, run
  `cd app/apps/file_editor_cm6 && node build.mjs`.
- Keep Android asset publication separate; do not publish bundled Android
  assets unless that is the explicit task.
- Validate the narrowest relevant backend/RPC tests and type checks before
  broad runtime testing.

## Current References

- `AGENTS.md` for the complete ownership and RPC contract.
- `docs/apps/code_te2/CODE_TE2.md` for detailed wiring.
- `docs/apps/code_te2/STATEFUL_SIDEBAR_APPS.md` for sidebar integration.
- `docs/planning/FILE_EDITOR_CM6_OWNERSHIP_BOUNDARY_CONTRACT.md` for ownership
  reference material.
- `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md` for direction.

Current source wins when an older implementation note conflicts with these
boundaries.
