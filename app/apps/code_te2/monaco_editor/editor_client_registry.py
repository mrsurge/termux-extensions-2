# pyright: strict
from __future__ import annotations

from ..client_presentation import ClientPresentationIdentity, ClientRole


_IDENTITY_BY_SID: dict[str, ClientPresentationIdentity] = {}


def register_editor_client(
    sid: str,
    identity: ClientPresentationIdentity,
) -> None:
    _IDENTITY_BY_SID[sid] = identity


def unregister_editor_client(sid: str) -> ClientPresentationIdentity | None:
    return _IDENTITY_BY_SID.pop(sid, None)


def editor_client_identity(sid: str) -> ClientPresentationIdentity | None:
    return _IDENTITY_BY_SID.get(sid)


def connected_editor_client_instance_ids() -> tuple[str, ...]:
    """Return each stable client represented by a live editor connection once."""
    return tuple(
        sorted({identity["clientInstanceId"] for identity in _IDENTITY_BY_SID.values()})
    )


def editor_client_role_for_instance(client_instance_id: str) -> ClientRole | None:
    """Return the live role for one stable editor identity, if connected."""
    roles = {
        identity["clientRole"]
        for identity in _IDENTITY_BY_SID.values()
        if identity["clientInstanceId"] == client_instance_id
    }
    if not roles:
        return None
    return "secondary" if "secondary" in roles else "primary"
