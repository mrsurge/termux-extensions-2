"""One-shot, exact-client consent for opening an existing directory as a project."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time
import uuid


@dataclass(frozen=True)
class _Ticket:
    client: str
    context: dict[str, object] | None
    app: str | None
    path: Path
    identity: tuple[int, int]
    project: Path
    generation: int | None
    expires: float


_tickets: dict[str, _Ticket] = {}


def _validate(ticket: _Ticket) -> None:
    from ..ui_ipc import sidebar_ws
    from ..explorer.services import file_ops
    from ..worker_services.event_bus import current_project_generation
    if ticket.expires <= time.monotonic():
        raise ValueError("Project confirmation expired")
    if ticket.context is not None:
        sidebar_ws.require_live_sidebar_host(ticket.client)
        client, _ = sidebar_ws.resolve_sidebar_request_client(
            {"target": ticket.context}, requester_app_id=ticket.app or "", require_presentation=True,
        )
        if client != ticket.client:
            raise ValueError("Project intent client changed")
    else:
        from ..ui_ipc.ui_ipc_ws import list_ui_ipc_browser_clients
        if ticket.client not in list_ui_ipc_browser_clients():
            raise ValueError("Project target host is disconnected")
    if file_ops.get_project_root().resolve() != ticket.project or current_project_generation(ticket.project) != ticket.generation:
        raise ValueError("Project changed; confirm Open as Project again")
    stat = ticket.path.stat()
    if not ticket.path.is_dir() or (stat.st_dev, stat.st_ino) != ticket.identity:
        raise ValueError("Project directory changed; select it again")


async def handle_project_directory_intent(
    params: dict[str, object], *, client_id: str,
    source_context: dict[str, object] | None = None, requester_app_id: str | None = None,
) -> dict[str, object]:
    from ..explorer.services import file_ops
    from ..worker_services.event_bus import current_project_generation
    from .project_backend import _project_service_deps
    from ..main_page.backend.project_service import lookup_project, open_project

    now = time.monotonic()
    for key, item in tuple(_tickets.items()):
        if item.expires <= now:
            del _tickets[key]
    action = params.get("action")
    if action == "prepare":
        raw = params.get("directory")
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError("Project directory is required")
        target = Path(raw).expanduser().resolve(strict=True)
        if not target.is_dir():
            raise ValueError("Project target must be an existing directory")
        project = file_ops.get_project_root().resolve()
        stat = target.stat()
        ticket = _Ticket(client_id, dict(source_context) if source_context is not None else None,
                         requester_app_id, target, (stat.st_dev, stat.st_ino), project,
                         current_project_generation(project), now + 120)
        _validate(ticket)
        # One pending dialog per client; bounded globally, with lazy expiry.
        for key, item in tuple(_tickets.items()):
            if item.client == client_id:
                del _tickets[key]
        if len(_tickets) >= 64:
            raise ValueError("Too many pending project confirmations")
        token = uuid.uuid4().hex
        deps = _project_service_deps()
        known = lookup_project(deps, str(target)).get("known") is True
        _tickets[token] = ticket
        return {"ok": True, "ticket": token, "path": str(target), "known": known,
                "requiresConfirmation": bool(deps.history.get_active_project()) and target != project}
    raw_token = params.get("ticket")
    pending = _tickets.get(raw_token) if isinstance(raw_token, str) else None
    if pending is None or pending.client != client_id or pending.context != source_context or pending.app != requester_app_id:
        raise ValueError("Project confirmation expired or belongs to another presentation")
    ticket = pending
    if action not in {"commit", "cancel"}:
        raise ValueError("Invalid project intent action")
    # Consume before awaiting any work: uncertain accepted effects cannot replay.
    del _tickets[str(raw_token)]
    if action == "cancel":
        return {"ok": True, "cancelled": True}
    _validate(ticket)
    deps = _project_service_deps()
    active = deps.history.get_active_project()
    if active and ticket.path == Path(active).expanduser().resolve():
        return {"ok": True, "path": str(ticket.path), "unchanged": True}
    known = lookup_project(deps, str(ticket.path)).get("known") is True
    return await open_project(deps, str(ticket.path), require_known_sidecar=known,
                              reason="app_project_open" if known else "app_project_adopt",
                              before_switch=lambda: _validate(ticket))
