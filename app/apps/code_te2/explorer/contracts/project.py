# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ExplorerProjectContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class ProjectOpenParams(TypedDict):
    path: str


class ProjectCreateParams(TypedDict):
    parent_path: str
    name: str


class ProjectListParams(TypedDict, total=False):
    pass


class GitCloneParams(TypedDict):
    url: str
    target_path: str
    branch: str | None
    depth: int | str | None


def parse_project_open_params(payload: object) -> ProjectOpenParams:
    envelope = _as_object(payload)
    path = _parse_required_string(
        envelope.get("path"),
        missing_message="Path required",
    )
    return {"path": path}


def parse_project_create_params(payload: object) -> ProjectCreateParams:
    envelope = _as_object(payload)
    parent_path = _parse_optional_string(envelope.get("parent_path"))
    name = _parse_optional_string(envelope.get("name"))
    if parent_path is None or name is None:
        raise ExplorerProjectContractError(
            "Project create requires parent_path and name"
        )
    return {
        "parent_path": parent_path,
        "name": name,
    }


def parse_project_list_params(payload: object) -> ProjectListParams:
    _as_object(payload)
    return {}


def parse_git_clone_params(payload: object) -> GitCloneParams:
    envelope = _as_object(payload)
    url = _parse_required_string(
        envelope.get("url"),
        missing_message="URL is required",
    )
    target_path = _parse_required_string(
        envelope.get("target_path"),
        missing_message="target_path is required",
    )
    return {
        "url": url,
        "target_path": target_path,
        "branch": _parse_optional_string(envelope.get("branch")),
        "depth": _coerce_depth(envelope.get("depth")),
    }


def _parse_required_string(
    value: object,
    *,
    missing_message: str,
) -> str:
    if isinstance(value, str) and value:
        return value
    raise ExplorerProjectContractError(missing_message)


def _parse_optional_string(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _coerce_depth(value: object) -> int | str | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value:
        return value
    return None


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
