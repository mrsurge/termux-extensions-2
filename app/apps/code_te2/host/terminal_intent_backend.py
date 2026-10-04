"""Fresh terminal intents with project and exact-client presentation fences."""
from __future__ import annotations

from pathlib import Path
from dataclasses import dataclass
from time import monotonic
import uuid

@dataclass(frozen=True)
class TerminalChoice:
    client_id: str
    directory: str
    project: Path
    generation: int | None
    operation_id: str
    source_context: dict[str, object] | None
    requester_app_id: str | None
    expires: float


_pending_choices: dict[str, TerminalChoice] = {}


async def resolve_terminal_destination(params: dict[str, object], *, client_id: str) -> dict[str, object]:
    token, destination = params.get("requestId"), params.get("destination")
    if not isinstance(token, str) or destination not in (None, "drawer", "sidebar"):
        raise ValueError("invalid terminal destination reply")
    pending = _pending_choices.get(token)
    if pending is not None and pending.client_id == client_id and pending.expires <= monotonic():
        _pending_choices.pop(token, None)
        pending = None
    if pending is None or pending.client_id != client_id:
        raise ValueError("terminal destination request is no longer active")
    _pending_choices.pop(token)
    if destination is None:
        return {"cancelled": True}
    from ..worker_services.event_bus import current_project_generation
    if current_project_generation(pending.project) != pending.generation:
        raise ValueError("project changed during terminal creation")
    return await open_directory_terminal(
        directory=pending.directory, destination=destination, client_id=client_id,
        operation_id=pending.operation_id, expected_project_root=pending.project,
        expected_project_generation=pending.generation, source_context=pending.source_context,
        requester_app_id=pending.requester_app_id,
    )


def cancel_terminal_destination(client_id: str) -> None:
    for token, pending in tuple(_pending_choices.items()):
        if pending.client_id == client_id:
            _pending_choices.pop(token, None)


async def open_directory_terminal(
    *, directory: str, destination: str, client_id: str, operation_id: str,
    expected_project_root: Path | None = None,
    expected_project_generation: int | None = None,
    source_context: dict[str, object] | None = None, requester_app_id: str | None = None,
) -> dict[str, object]:
    from ..explorer.services import file_ops
    from ..ui_ipc import sidebar_ws
    from ..worker_services.event_bus import current_project_generation

    if destination not in {"ask", "sidebar", "drawer"} or not operation_id.strip():
        raise ValueError("invalid terminal intent")
    project = (expected_project_root or file_ops.get_project_root()).resolve()
    generation = expected_project_generation if expected_project_generation is not None else current_project_generation(project)
    target = Path(directory).expanduser().resolve(strict=True)
    if not target.is_dir():
        raise ValueError("Terminal target must be a directory")

    def validate() -> None:
        sidebar_ws.require_live_sidebar_host(client_id)
        if source_context is not None:
            resolved, _ = sidebar_ws.resolve_sidebar_request_client(
                {"target": source_context}, requester_app_id=requester_app_id or "",
                require_presentation=True,
            )
            if resolved != client_id:
                raise ValueError("terminal caller does not match client")
        if file_ops.get_project_root().resolve() != project or current_project_generation(project) != generation:
            raise ValueError("project changed during terminal creation")

    validate()
    if destination == "ask":
        from ..ui_ipc.notifications import emit_ui_ipc_rpc_notification
        now = monotonic()
        for token, pending in tuple(_pending_choices.items()):
            if pending.expires <= now:
                _pending_choices.pop(token, None)
        if len(_pending_choices) >= 64 or any(p.client_id == client_id for p in _pending_choices.values()):
            raise ValueError("terminal destination choice is already pending")
        token = uuid.uuid4().hex
        _pending_choices[token] = TerminalChoice(client_id, str(target), project, generation,
            operation_id, source_context, requester_app_id, now + 120)
        try:
            await emit_ui_ipc_rpc_notification("ui.terminal.destination", {
                "requestId": token, "directory": str(target),
            }, client_instance_id=client_id)
        except BaseException:
            _pending_choices.pop(token, None)
            raise
        return {"pending": True}
    if destination == "sidebar":
        from .sidebar_app_backend import open_sidebar_app
        return await open_sidebar_app(
            app_id="terminal", params={"cwd": str(target), "new_session": uuid.uuid4().hex},
            client_id=client_id, operation_id=operation_id, expected_project_root=project,
            source_context=source_context, requester_app_id=requester_app_id,
        )
    from ..terminal_backend import _create_terminal_shell_data
    from ..ui_ipc.notifications import emit_ui_ipc_rpc_notification
    from ..ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN

    result = await _create_terminal_shell_data(cwd=str(target), client_id=client_id)
    # A successful creation is not replayed or rolled back if its caller leaves.
    validate()
    await emit_ui_ipc_rpc_notification(
        UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN, result, client_instance_id=client_id,
    )
    return result
