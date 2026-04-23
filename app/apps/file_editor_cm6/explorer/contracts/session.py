# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ExplorerSessionContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class ExplorerListParams(TypedDict):
    rel: str


class ExplorerSessionNoParams(TypedDict, total=False):
    pass


class ExplorerOpenDirsParams(TypedDict):
    dirs: list[str]


def parse_list_params(payload: object) -> ExplorerListParams:
    envelope = _as_object(payload)
    return {"rel": _parse_optional_string(envelope.get("rel")) or "."}


def parse_refresh_params(payload: object) -> ExplorerSessionNoParams:
    _as_object(payload)
    return {}


def parse_open_dirs_params(payload: object) -> ExplorerOpenDirsParams:
    envelope = _as_object(payload)
    return {"dirs": _parse_string_list(envelope.get("dirs"))}


def _parse_optional_string(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _parse_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in cast(list[object], value):
        if isinstance(item, str):
            result.append(item)
    return result


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
