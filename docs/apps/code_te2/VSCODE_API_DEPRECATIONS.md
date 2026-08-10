# VSCode API Deprecations and Migration

Purpose:
- Track dead-end transports and safe cutover sequence.

Related docs:
- `docs/apps/code_te2/VSCODE_API_CONTRACT.md`
- `docs/apps/code_te2/VSCODE_API_STATE_OWNERSHIP.md`
- `docs/apps/code_te2/MONACO_WORKBENCH_SPRINT_PLAN.md`

## Current transport status

1. `editor_ws`: active and authoritative for editor/save/draft/session.
2. `vscode_api_ws`: active target transport for language integration.
3. `vscode_rpc_ws`: removed historical compatibility transport.

## Removal status for `vscode_rpc_ws`

1. No new methods/features.
2. No runtime callers are expected.
3. Do not restore this transport as a fallback for WBA/editor intelligence.
4. Any future language-intelligence work belongs on the WBA/direct editor contract.

## Migration checklist

1. Contract parity
- Ensure all required language methods exist on `vscode_api_ws`.

2. Caller migration
- Monaco bridge and tools target `vscode_api_ws` exclusively.

3. Observability parity
- Equivalent status/debug introspection available on `vscode_api_ws`.

4. Cutover guard
- Confirm no runtime consumers depend on removed transports before deleting any remaining docs.

5. Removal
- Done for the `vscode_rpc_ws` service/shell/frontend side-channel.

## Compatibility notes

1. Keep error codes/messages stable across migration.
2. Keep normalized payload shapes stable.
3. Document any unavoidable behavior change in `VSCODE_API_CONTRACT.md`.
