"""Fresh terminal intents with project and exact-client presentation fences."""
from __future__ import annotations

from pathlib import Path
import uuid


async def open_directory_terminal(
    *, directory: str, destination: str, client_id: str, operation_id: str,
    expected_project_root: Path | None = None,
    source_context: dict[str, object] | None = None, requester_app_id: str | None = None,
) -> dict[str, object]:
    from ..explorer.services import file_ops
    from ..ui_ipc import sidebar_ws
    from ..worker_services.event_bus import current_project_generation

    if destination not in {"sidebar", "drawer"} or not operation_id.strip():
        raise ValueError("invalid terminal intent")
    project = (expected_project_root or file_ops.get_project_root()).resolve()
    generation = current_project_generation(project)
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
