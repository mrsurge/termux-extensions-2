# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict, cast, override

JsonObject = dict[str, object]
SearchMode = Literal["name", "content", "changes"]
DiffBaseMode = Literal["none", "head", "detached"]


@dataclass(frozen=True)
class ExplorerSearchReviewContractError(Exception):
    message: str

    @override
    def __str__(self) -> str:
        return self.message


class SearchRunParams(TypedDict):
    mode: SearchMode
    query: str
    correlationId: str
    isRegex: bool
    isCaseSensitive: bool
    isWholeWords: bool
    includePattern: str
    excludePattern: str
    useIgnoreFiles: bool


class SearchMoreLimit(TypedDict):
    maxMatchesPerFile: int
    maxMatchesTotal: int


class SearchMoreParams(TypedDict):
    searchId: str
    projectGeneration: int
    cursor: str
    limit: SearchMoreLimit


class SearchMoreInFileParams(TypedDict):
    searchId: str
    projectGeneration: int
    relativePath: str
    cursor: str
    maxMatches: int


class SearchCancelParams(TypedDict):
    searchId: str | None
    reason: str


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
    matchText: str
    lineRanges: list[SearchTextRange]
    snippetRanges: list[SearchTextRange]


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


class SearchProviderFileItem(TypedDict):
    path: str
    relativePath: str
    kind: Literal["file", "dir"]
    name: str


class SearchFilesResult(TypedDict):
    dto: Literal["SearchFilesResult"]
    version: Literal[1]
    root: str
    query: str
    items: list[SearchProviderFileItem]
    truncated: bool
    count: int


class SearchTextRange(TypedDict):
    start: int
    end: int


class SearchProviderContentMatch(TypedDict):
    lineNumber: int
    columnNumber: int
    lineText: str
    snippet: str
    matchText: str
    lineRanges: list[SearchTextRange]
    snippetRanges: list[SearchTextRange]


class SearchProviderContentFile(TypedDict):
    path: str
    relativePath: str
    matches: list[SearchProviderContentMatch]


class SearchProviderContentResult(TypedDict):
    dto: Literal["SearchContentResult"]
    version: Literal[1]
    root: str
    query: str
    files: list[SearchProviderContentFile]
    truncated: bool
    fileCount: int
    matchCount: int


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
        "correlationId": _coerce_string(
            envelope.get("correlationId"), "search:run correlationId"
        ),
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


def parse_search_more_params(payload: object) -> SearchMoreParams:
    envelope = _as_object(payload)
    limit = _required_object(envelope.get("limit"), "search:more limit")
    return {
        "searchId": _required_string(envelope.get("searchId"), "search:more searchId"),
        "projectGeneration": _required_int(
            envelope.get("projectGeneration"), "search:more projectGeneration"
        ),
        "cursor": _required_string(envelope.get("cursor"), "search:more cursor"),
        "limit": {
            "maxMatchesPerFile": _required_positive_int(
                limit.get("maxMatchesPerFile"), "search:more limit.maxMatchesPerFile"
            ),
            "maxMatchesTotal": _required_positive_int(
                limit.get("maxMatchesTotal"), "search:more limit.maxMatchesTotal"
            ),
        },
    }


def parse_search_more_in_file_params(payload: object) -> SearchMoreInFileParams:
    envelope = _as_object(payload)
    return {
        "searchId": _required_string(
            envelope.get("searchId"), "search:moreInFile searchId"
        ),
        "projectGeneration": _required_int(
            envelope.get("projectGeneration"), "search:moreInFile projectGeneration"
        ),
        "relativePath": _required_string(
            envelope.get("relativePath"), "search:moreInFile relativePath"
        ),
        "cursor": _required_string(envelope.get("cursor"), "search:moreInFile cursor"),
        "maxMatches": _required_positive_int(
            envelope.get("maxMatches"), "search:moreInFile maxMatches"
        ),
    }


def parse_search_cancel_params(payload: object) -> SearchCancelParams:
    envelope = _as_object(payload)
    search_id_value = envelope.get("searchId")
    search_id = (
        _required_string(search_id_value, "search:cancel searchId")
        if search_id_value is not None
        else None
    )
    return {
        "searchId": search_id,
        "reason": _coerce_string(envelope.get("reason"), "search:cancel reason")
        or "cancelled",
    }


def project_search_files_result(dto: SearchFilesResult) -> SearchNameResult:
    return {
        "mode": "name",
        "query": dto["query"],
        "results": [
            {
                "path": item["path"],
                "rel": item["relativePath"],
                "type": item["kind"],
                "name": item["name"],
            }
            for item in dto["items"]
        ],
        "truncated": dto["truncated"],
        "count": dto["count"],
    }


def project_search_content_result(
    dto: SearchProviderContentResult,
) -> SearchContentResult:
    return {
        "mode": "content",
        "query": dto["query"],
        "results": [
            {
                "path": file_result["path"],
                "rel": file_result["relativePath"],
                "matches": [
                    _project_provider_content_match(match)
                    for match in file_result["matches"]
                ],
            }
            for file_result in dto["files"]
        ],
        "truncated": dto["truncated"],
        "file_count": dto["fileCount"],
        "match_count": dto["matchCount"],
    }


def _project_provider_content_match(match: SearchProviderContentMatch) -> SearchContentMatch:
    return {
        "line": match["lineNumber"],
        "column": max(0, match["columnNumber"] - 1),
        "text": match["lineText"],
        "snippet": match["snippet"],
        "matchText": match["matchText"],
        "lineRanges": _copy_search_ranges(match["lineRanges"]),
        "snippetRanges": _copy_search_ranges(match["snippetRanges"]),
    }


def _copy_search_ranges(ranges: list[SearchTextRange]) -> list[SearchTextRange]:
    copied: list[SearchTextRange] = []
    for range_ in ranges:
        copied.append({"start": range_["start"], "end": range_["end"]})
    return copied


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
        return value
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
    for idx, item in enumerate(cast(list[object], files_value)):
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


def _required_string(value: object, field_name: str) -> str:
    result = _coerce_string(value, field_name).strip()
    if not result:
        raise ExplorerSearchReviewContractError(f"{field_name} is required")
    return result


def _required_object(value: object, field_name: str) -> JsonObject:
    if not isinstance(value, dict):
        raise ExplorerSearchReviewContractError(f"{field_name} must be an object")
    return _as_object(cast(object, value))


def _required_int(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ExplorerSearchReviewContractError(f"{field_name} must be an integer")
    return value


def _required_positive_int(value: object, field_name: str) -> int:
    result = _required_int(value, field_name)
    if result <= 0:
        raise ExplorerSearchReviewContractError(f"{field_name} must be positive")
    return result


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
