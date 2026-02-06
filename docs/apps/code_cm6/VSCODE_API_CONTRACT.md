# VSCode API Contract (TE2)

Purpose:
- Define the single, stable interface between Monaco frontend and the workbench sidecar stack.
- Keep multi-agent implementation work aligned to one contract.

Related docs:
- `docs/apps/code_cm6/VSCODE_API_STATE_OWNERSHIP.md`
- `docs/apps/code_cm6/VSCODE_API_DEPRECATIONS.md`
- `docs/apps/code_cm6/MONACO_WORKBENCH_SPRINT_PLAN.md`
- `docs/apps/code_cm6/CODE_TE2.md`
- `docs/apps/code_cm6/README.md`

## Transport map

Primary transports:
1. `editor_ws`
- Scope: TE2 editor authority only.
- Includes: open/save/draft/autosave/session state.

2. `vscode_api_ws`
- Scope: language intelligence sidecar only.
- Includes: hover, symbols, completion, diagnostics events, adapter/runtime control.

Deprecated transport:
1. `vscode_rpc_ws`
- Compatibility-only during migration.
- No new features.

## Endpoint roles

1. `GET /api/app/file_editor_cm6/vscode_api/discover`
- Discovers runtime endpoint.
- Returns websocket URL and shell identity metadata.

2. `WS /vscode_api_ws?...`
- JSON-RPC 2.0 channel.
- Frontend <-> adapter shell control and language ops.

3. `WS /editor_ws/socket.io` (namespace `/editor`)
- Existing editor/session pipeline.
- Must remain independent from `vscode_api_ws`.

## JSON-RPC baseline

Request/response envelope:
- Request: `{"jsonrpc":"2.0","id":N,"method":"...","params":{...}}`
- Success: `{"jsonrpc":"2.0","id":N,"result":{...}}`
- Error: `{"jsonrpc":"2.0","id":N,"error":{"code":..., "message":"...", "data":...}}`

Notification envelope:
- `{"jsonrpc":"2.0","method":"te2.event","params":{...}}`

## Required methods (minimum stable set)

Connection/runtime:
1. `adapter.connect`
- Params: proxy/upstream/session details needed by adapter runtime.
- Result: connection/session metadata.

2. `adapter.events`
- Params: optional `limit`.
- Result: recent adapter event buffer for debugging.

3. `te2.status`
- Result: active ws/session/provider state snapshot.

Document lifecycle:
1. `vscode.openFile`
- Params: canonical path + authority/context.
- Result: `{ok:true, uri, ...}`

Language features:
1. `vscode.hover`
- Params: `uri`, `lineNumber`, `column` (plus optional timeout/cancel hints).
- Result: normalized hover payload.

2. `vscode.documentSymbols`
- Params: `uri` (or path + authority).
- Result: normalized symbol tree/list.

3. `vscode.completion` (targeted)
- Params: `uri`, position, trigger context.
- Result: normalized completion items.

Event stream:
1. diagnostics update events
- `te2.event` -> `diagnostics/update` normalized payload.

## Normalization rules

1. URI and version discipline
- All request/reply/event payloads must include canonical `uri`.
- Frontend applies results only when `(uri, version)` is current.

2. No raw workbench protocol in frontend
- Frontend receives normalized TE2 payloads only.
- Provider handles/rpc internals stay backend-side.

3. Error codes
- Use stable error codes for timeout, unavailable provider, stale request, not connected.

## Non-goals

1. Do not move save/draft authority to workbench adapter.
2. Do not merge `editor_ws` and `vscode_api_ws` responsibilities.
3. Do not treat trace replay as production protocol.

## Contract change policy

1. Backward compatibility first.
2. Additive changes preferred.
3. Breaking changes require:
- doc update in this file
- deprecation note in `VSCODE_API_DEPRECATIONS.md`
- sprint-plan task reference
