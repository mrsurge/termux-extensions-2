# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, NotRequired, TypedDict, cast

JsonObject = dict[str, object]
SearchMode = Literal["name", "content", "changes"]
DiffBaseMode = Literal["none", "head", "detached"]


@dataclass(frozen=True)
class ExplorerSearchReviewContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class SearchRunParams(TypedDict):
    mode: SearchMode
    query: str
    isRegex: bool
    isCaseSensitive: bool
    isWholeWords: bool
    includePattern: str
    excludePattern: str
    useIgnoreFiles: bool


class ReviewListParams(TypedDict):
    lightweight: bool


class ReviewFilesParams(TypedDict):
    files: list[str]


class SearchNameResultEntry(TypedDict):
    path: str
    rel: str
    type: Literal["file", "dir"]
    name: str


class SearchNameResult(TypedDict):
    mode: Literal["name"]
    query: str
    results: list[SearchNameResultEntry]
    truncated: bool
    count: int


class SearchContentMatch(TypedDict):
    line: int
    column: int
    text: str
    snippet: str


class SearchContentResultEntry(TypedDict):
    path: str
    rel: str
    matches: list[SearchContentMatch]


class SearchContentResult(TypedDict):
    mode: Literal["content"]
    query: str
    results: list[SearchContentResultEntry]
    truncated: bool
    file_count: int
    match_count: int


class SearchChangesBaseCommit(TypedDict, total=False):
    hash: str
    short: str
    subject: str
    author: str
    date: str


class SearchChangesBaseInfo(TypedDict):
    ref: str
    mode: DiffBaseMode
    commit: SearchChangesBaseCommit | None


class SearchChange(TypedDict, total=False):
    rel: str
    path: str
    label: str
    status: str
    statusCode: str
    statusText: str
    summary: JsonObject
    hunks: list[JsonObject]
    isTracked: bool
    renamedFrom: str
    error: str


class SearchChangesResult(TypedDict, total=False):
    mode: Literal["changes"]
    git: bool
    base: SearchChangesBaseInfo
    changes: list[SearchChange]
    truncated: bool
    count: int
    total: int


SearchRunResult = SearchNameResult | SearchContentResult | SearchChangesResult


class ReviewEntry(TypedDict):
    path: str
    rel: str
    has_draft: bool
    timestamp: object
    hunks: list[JsonObject]


class ReviewEntriesPayload(TypedDict):
    entries: list[ReviewEntry]


class ReviewSaveResult(TypedDict):
    saved_count: int
    errors: list[str]


class ReviewDiscardResult(TypedDict):
    discarded_count: int


def parse_search_run_params(payload: object) -> SearchRunParams:
    envelope = _as_object(payload)
    mode = _parse_search_mode(envelope.get("mode"))
    query_value = envelope.get("query")
    if query_value is None:
        query = ""
    elif isinstance(query_value, str):
        query = query_value
    else:
        raise ExplorerSearchReviewContractError("search:run query must be a string")
    return {
        "mode": mode,
        "query": query,
        "isRegex": _coerce_bool(envelope.get("isRegex"), default=False),
        "isCaseSensitive": _coerce_bool(
            envelope.get("isCaseSensitive"), default=False
        ),
        "isWholeWords": _coerce_bool(envelope.get("isWholeWords"), default=False),
        "includePattern": _coerce_string(
            envelope.get("includePattern"), "search:run includePattern"
        ),
        "excludePattern": _coerce_string(
            envelope.get("excludePattern"), "search:run excludePattern"
        ),
        "useIgnoreFiles": _coerce_bool(envelope.get("useIgnoreFiles"), default=True),
    }


def parse_review_list_params(payload: object) -> ReviewListParams:
    envelope = _as_object(payload)
    return {
        "lightweight": _coerce_bool(envelope.get("lightweight"), default=False),
    }


def parse_review_save_params(payload: object) -> ReviewFilesParams:
    return {
        "files": _parse_files(payload, "review:save"),
    }


def parse_review_discard_params(payload: object) -> ReviewFilesParams:
    return {
        "files": _parse_files(payload, "review:discard"),
    }


def _parse_search_mode(value: object) -> SearchMode:
    if value is None:
        return "name"
    if value in ("name", "content", "changes"):
        return cast(SearchMode, value)
    raise ExplorerSearchReviewContractError("Invalid search mode")


def _parse_files(payload: object, command_name: str) -> list[str]:
    envelope = _as_object(payload)
    files_value = envelope.get("files")
    if files_value is None:
        return []
    if not isinstance(files_value, list):
        raise ExplorerSearchReviewContractError(
            f"{command_name} files must be an array of strings"
        )

    files: list[str] = []
    for idx, item in enumerate(files_value):
        if not isinstance(item, str):
            raise ExplorerSearchReviewContractError(
                f"{command_name} files[{idx}] must be a string"
            )
        rel = item.strip()
        if rel:
            files.append(rel)
    return files


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
    raise ExplorerSearchReviewContractError("review:list lightweight must be a boolean")


def _coerce_string(value: object, field_name: str) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    raise ExplorerSearchReviewContractError(f"{field_name} must be a string")


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
