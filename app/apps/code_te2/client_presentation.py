from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Literal, TypedDict, cast
from urllib.parse import parse_qs


CLIENT_INSTANCE_ID_PATTERN = re.compile(r"^client_[a-z0-9]{12,64}$")
WINDOW_ID_PATTERN = re.compile(r"^window_[a-z0-9]{20,64}$")
ClientRole = Literal["primary", "secondary"]


class ClientPresentationIdentity(TypedDict):
    clientInstanceId: str
    windowId: str | None
    clientRole: ClientRole


def normalize_client_instance_id(value: object) -> str | None:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    return normalized if CLIENT_INSTANCE_ID_PATTERN.fullmatch(normalized) else None


def normalize_window_id(value: object) -> str | None:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    return normalized if WINDOW_ID_PATTERN.fullmatch(normalized) else None


def normalize_client_role(value: object) -> ClientRole:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    return "secondary" if normalized == "secondary" else "primary"


def client_presentation_room(client_instance_id: str) -> str:
    normalized = normalize_client_instance_id(client_instance_id)
    if normalized is None:
        raise ValueError("invalid_client_instance_id")
    return f"code_te2:client:{normalized}"


def client_presentation_identity_from_environ(
    environ: object,
    *,
    required: bool = True,
) -> ClientPresentationIdentity | None:
    if not isinstance(environ, Mapping):
        if required:
            raise ValueError("client_identity_required")
        return None
    raw_environ = cast(Mapping[object, object], environ)
    query_string = str(raw_environ.get("QUERY_STRING") or "")
    query = parse_qs(query_string, keep_blank_values=False)
    client_instance_id = normalize_client_instance_id(
        (query.get("client_instance_id") or [""])[0]
    )
    if client_instance_id is None:
        if required:
            raise ValueError("client_identity_required")
        return None
    return {
        "clientInstanceId": client_instance_id,
        "windowId": normalize_window_id((query.get("window_id") or [""])[0]),
        "clientRole": normalize_client_role(
            (query.get("client_role") or ["primary"])[0]
        ),
    }


__all__ = [
    "CLIENT_INSTANCE_ID_PATTERN",
    "WINDOW_ID_PATTERN",
    "ClientPresentationIdentity",
    "ClientRole",
    "client_presentation_identity_from_environ",
    "client_presentation_room",
    "normalize_client_instance_id",
    "normalize_client_role",
    "normalize_window_id",
]
