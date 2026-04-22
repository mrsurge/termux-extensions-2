# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ExplorerGitContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class GitNoParams(TypedDict, total=False):
    pass


class GitPathListParams(TypedDict):
    paths: list[str]


class GitRestoreParams(TypedDict):
    path: str
    commit: str


class GitCommitParams(TypedDict):
    message: str
    amend: bool


class GitPushParams(TypedDict):
    remote: str
    branch: str | None
    force: bool


class GitPullParams(TypedDict):
    remote: str
    branch: str | None
    rebase: bool


class GitResetParams(TypedDict):
    commit: str


class GitDiffBaseParams(TypedDict):
    ref: str


class GitListCommitsParams(TypedDict):
    limit: int


def parse_git_status_params(payload: object) -> GitNoParams:
    _as_object(payload)
    return {}


def parse_git_stage_params(payload: object) -> GitPathListParams:
    envelope = _as_object(payload)
    return {"paths": _parse_string_list(envelope.get("paths"))}


def parse_git_unstage_params(payload: object) -> GitPathListParams:
    envelope = _as_object(payload)
    return {"paths": _parse_string_list(envelope.get("paths"))}


def parse_git_stage_all_params(payload: object) -> GitNoParams:
    _as_object(payload)
    return {}


def parse_git_unstage_all_params(payload: object) -> GitNoParams:
    _as_object(payload)
    return {}


def parse_git_restore_params(payload: object) -> GitRestoreParams:
    envelope = _as_object(payload)
    path = _parse_required_string(
        envelope.get("path"),
        missing_message="Restore requires path",
    )
    return {
        "path": path,
        "commit": _parse_optional_string(envelope.get("commit")) or "HEAD",
    }


def parse_git_commit_params(payload: object) -> GitCommitParams:
    envelope = _as_object(payload)
    message = _parse_required_string(
        envelope.get("message"),
        missing_message="Commit message required",
    )
    return {
        "message": message,
        "amend": _coerce_bool(envelope.get("amend"), default=False),
    }


def parse_git_push_params(payload: object) -> GitPushParams:
    envelope = _as_object(payload)
    return {
        "remote": _parse_optional_string(envelope.get("remote")) or "origin",
        "branch": _parse_optional_string(envelope.get("branch")),
        "force": _coerce_bool(envelope.get("force"), default=False),
    }


def parse_git_pull_params(payload: object) -> GitPullParams:
    envelope = _as_object(payload)
    return {
        "remote": _parse_optional_string(envelope.get("remote")) or "origin",
        "branch": _parse_optional_string(envelope.get("branch")),
        "rebase": _coerce_bool(envelope.get("rebase"), default=False),
    }


def parse_git_reset_params(payload: object) -> GitResetParams:
    envelope = _as_object(payload)
    return {"commit": _parse_optional_string(envelope.get("commit")) or "HEAD"}


def parse_git_init_params(payload: object) -> GitNoParams:
    _as_object(payload)
    return {}


def parse_git_set_diff_base_params(payload: object) -> GitDiffBaseParams:
    envelope = _as_object(payload)
    return {"ref": _parse_optional_string(envelope.get("ref")) or "HEAD"}


def parse_git_list_branches_params(payload: object) -> GitNoParams:
    _as_object(payload)
    return {}


def parse_git_list_commits_params(payload: object) -> GitListCommitsParams:
    envelope = _as_object(payload)
    return {
        "limit": _coerce_positive_int(envelope.get("limit"), default=50),
    }


def _parse_required_string(
    value: object,
    *,
    missing_message: str,
) -> str:
    if isinstance(value, str) and value:
        return value
    raise ExplorerGitContractError(missing_message)


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


def _coerce_positive_int(value: object, *, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value if value > 0 else default
    if isinstance(value, str):
        try:
            parsed = int(value.strip())
        except ValueError:
            return default
        return parsed if parsed > 0 else default
    return default


def _coerce_bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return default


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
