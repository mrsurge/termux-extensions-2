# Pipe Plans, Contracts, And Tracker

This directory is the working home for the `file_editor_cm6` pipe-service migration.

The current direction is contract-first:

1. Settle the JSON-RPC envelope, NIDs, request ids, DTOs, codec, and stdout/stderr discipline.
2. Make existing in-process producers generate the future DTOs.
3. Make existing consumers accept the future DTOs.
4. Cut the origin over to framework-supervised stdio service shells.

## Active Documents

- `FILE_EDITOR_CM6_PIPE_SERVICE_MIGRATION_PLAN.md` - migration plan and expected source surface.
- `PIPE_SERVICE_JSON_RPC_CONTRACT_DRAFT.md` - protocol, envelope, NID, request id, codec, and DTO draft.
- `PIPE_SERVICE_CONTRACT_TRACKER.md` - to-do/done/outcome tracker.
- `GIT_PIPE_SUPPLEMENTARY_CONTRACT.md` - current `service.git` method and DTO contract.
- `SEARCH_PIPE_DTO_CONTRACT.md` - current `service.search` file/content/progressive search contract.
- `SEARCH_REPLACE_PIPE_DTO_CONTRACT.md` - planned repo-wide find/replace preview/apply contract.
- `SEARCH_FULL_STACK_BENCHMARK_HARNESS_PLAN.md` - explicit diagnostic benchmark harness contract.

## Superseded Historical Document

- `FILE_EDITOR_CM6_PYGIT2_AND_TYPED_EVENT_BRIDGE_PLAN.md` - moved here from `docs/planning`.

The old plan was skimmed after the new pipe-service direction was drafted.
Durable facts that still support the new contract have been merged into the
active documents. The old file is retained as historical context only.

## Consolidation Rule

Do not carry old event-bus or pygit2-only planning forward just because it exists. Redirect or deprecate old items unless they support the current service-shell contract:

- stdout protocol-only
- stderr logs only
- generated/assigned NIDs for participants
- request ids for request/response routing
- domain DTOs before transport cutover
- framework-owned service lifecycle and event loop
- app hot paths free of direct blocking fs/git/os work

Merged old-plan content:

- project-generation stale-drop requirements
- surface projection lane rules
- bootstrap/replay order
- store authority preservation
- WBA language-intelligence boundary
- git direct-subprocess cleanup target
- Rust portability-through-service-interfaces direction
- correlation id loose thread
- stdout metrics conflict
- `workspace_events.py` side-effect audit

Deprecated or redirected old-plan content:

- old event-bus tracker phases are historical, not active pipe work
- pygit2/GitPython-specific implementation direction is redirected behind `service.git`
- stdout event metrics are invalid for protocol-mode workers/services unless moved off stdout
- low-level fs/git/os execution should not become event-bus command execution
