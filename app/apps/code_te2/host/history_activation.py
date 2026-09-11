# pyright: strict
"""Secondary-owned activation: commit content, then publish the foreground fact."""
from .history_handoff import handoffs
from .secondary_content_backend import (
    HISTORICAL_REASON, abort_historical_content, begin_historical_content,
    commit_historical_content,
)
from ..open_state_events import publish_client_foreground_changed


async def activate_history_ticket(client_id: str, client_role: str, ticket: str) -> None:
    token = begin_historical_content(client_id, client_role)
    try:
        content = handoffs.take(ticket, token.project_path, token.project_generation)
        activation = commit_historical_content(token, content)
        if activation is None:
            raise ValueError("Historical activation was superseded")
        await publish_client_foreground_changed(activation.open_state, activation.foreground,
            source=HISTORICAL_REASON, project_generation=activation.project_generation,
            project_editor_snapshot=True)
    finally:
        abort_historical_content(token)
