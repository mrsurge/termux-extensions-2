# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast, override


@dataclass(frozen=True)
class ExplorerExtensionMenuContractError(Exception):
    message: str

    @override
    def __str__(self) -> str:
        return self.message


class ExplorerExtensionMenuResolveParams(TypedDict):
    rel: str


class ExplorerExtensionCommandParams(TypedDict):
    rel: str
    selected_rels: list[str]
    command: str


def _object(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise ExplorerExtensionMenuContractError("params must be an object")
    return {str(key): value for key, value in cast(dict[object, object], payload).items()}


def _rel(value: object) -> str:
    if not isinstance(value, str):
        raise ExplorerExtensionMenuContractError("rel is required")
    rel = value.strip()
    if not rel:
        raise ExplorerExtensionMenuContractError("rel is required")
    return rel


def parse_extension_menu_resolve_params(
    payload: object,
) -> ExplorerExtensionMenuResolveParams:
    params = _object(payload)
    return {"rel": _rel(params.get("rel"))}


def parse_extension_command_params(payload: object) -> ExplorerExtensionCommandParams:
    params = _object(payload)
    command = params.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ExplorerExtensionMenuContractError("command is required")
    selected_raw = params.get("selected_rels", [])
    if not isinstance(selected_raw, list):
        raise ExplorerExtensionMenuContractError("selected_rels must be an array")
    selected: list[str] = []
    for value in cast(list[object], selected_raw):
        if not isinstance(value, str) or not value.strip():
            raise ExplorerExtensionMenuContractError(
                "selected_rels must contain non-empty strings"
            )
        selected.append(value.strip())
    if len(selected) > 1000:
        raise ExplorerExtensionMenuContractError("too many selected Explorer entries")
    return {
        "rel": _rel(params.get("rel")),
        "selected_rels": selected,
        "command": command.strip(),
    }
