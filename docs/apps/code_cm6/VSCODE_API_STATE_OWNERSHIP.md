# VSCode API State Ownership (TE2)

Purpose:
- Prevent state-boundary regressions while multiple agents implement integration work.

Related docs:
- `docs/apps/code_cm6/VSCODE_API_CONTRACT.md`
- `docs/apps/code_cm6/VSCODE_API_DEPRECATIONS.md`
- `docs/apps/code_cm6/CODE_TE2.md`

## Ownership model

## TE2 editor SSOT owns
1. Current document text shown in Monaco.
2. Draft cache and autosave behavior.
3. Dirty-state semantics and custom draft overlays.
4. Save pipeline and disk writes.
5. Explorer draft status and session persistence.

Transport: `editor_ws` and existing worker routes.

## Workbench adapter sidecar owns
1. Remote mgmt/ext websocket session lifecycle.
2. Provider registration/handle/rpc mapping internals.
3. Language requests to extension host side.
4. Translation into normalized TE2 language payloads.

Transport: `vscode_api_ws`.

## Frontend bridge owns
1. Request dispatch (`hover`, `symbols`, `completion`).
2. Version gating and stale-response rejection.
3. Diagnostics marker projection into Monaco.

No ownership:
- No direct save authority.
- No direct provider-handle logic.

## Synchronization contract

1. Open/change/close are mirrored to language sidecar.
2. TE2 model version is the authoritative freshness key.
3. Sidecar responses are applied only if version still matches.

## Failure-mode policy

1. If sidecar unavailable:
- Keep editing fully functional via TE2 core.
- Degrade language features gracefully.

2. If sidecar returns stale payload:
- Drop it.
- Do not mutate text model from stale language payload.

3. If extension/runtime reset occurs:
- Reconnect sidecar.
- Reopen active document to rehydrate providers.

## Anti-patterns

1. Letting sidecar write files.
2. Coupling draft state to extension-host state.
3. Mixing `editor_ws` events with language sidecar events in one untyped stream.
