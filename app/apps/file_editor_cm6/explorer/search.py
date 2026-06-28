from importlib import import_module
from pathlib import Path
from typing import Literal, Protocol, TypedDict, cast

from app.libs import pipe_runtime

from ..stores import get_history_store
from ..worker_services import git_service as worker_git_service
from ..worker_services.git_service import GitChangeEntry
from .contracts.search_review import (
    JsonObject,
    SearchChange,
    SearchChangesBaseCommit,
    SearchChangesBaseInfo,
    SearchChangesResult,
    SearchRunParams,
)


class DiffPayload(TypedDict, total=False):
    summary: JsonObject
    hunks: list[JsonObject]
    error: str


class CollectDiffFn(Protocol):
    def __call__(self, project_root: Path, rel_path: str, *, base_ref: str) -> object: ...


SEARCH_SERVICE_TARGET_NID = 2300
SEARCH_SERVICE_TARGET_NAME = "service.search"
SEARCH_SERVICE_ORIGIN_NAME = "file_editor_cm6.explorer.search"


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _json_object_list(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        return []
    result: list[JsonObject] = []
    for item in cast(list[object], value):
        if isinstance(item, dict):
            result.append(_json_object(cast(object, item)))
    return result


CHANGE_RESULT_LIMIT = 40
STATUS_TEXT_MAP = {
    'M': 'Modified',
    'A': 'Added',
    'D': 'Deleted',
    'R': 'Renamed',
    'C': 'Copied',
    'U': 'Conflict',
    '?': 'Untracked',
    '!': 'Ignored',
}

def _resolve_diff_base(project_path: str | None) -> str:
    base = get_history_store().get_diff_base(project_path)
    return base.strip() if base else 'HEAD'

def _diff_base_payload(project_path: str | None) -> SearchChangesBaseInfo:
    base_ref = _resolve_diff_base(project_path)
    mode: Literal["none", "head", "detached"] = 'none'
    commit_info: SearchChangesBaseCommit | None = None
    
    if project_path:
        root_path = Path(project_path)
        if root_path.exists() and worker_git_service.is_git_repository(root_path):
            mode = 'head' if base_ref == 'HEAD' else 'detached'
            commit = worker_git_service.get_commit_info(root_path, base_ref)
            if commit:
                commit_info = {
                    "hash": commit.hash,
                    "short": commit.short_hash,
                    "subject": commit.summary,
                    "author": commit.author,
                    "date": commit.date,
                }
        else:
            mode = 'none'

    return {
        "ref": base_ref,
        "mode": mode,
        "commit": commit_info,
    }

def _status_meta_from_code(code: str) -> tuple[str, str]:
    if not code:
        return '', STATUS_TEXT_MAP['?']
    if code in ('??', '!!'):
        key = '?' if code == '??' else '!'
        short = '?' if code == '??' else '!'
        return short, STATUS_TEXT_MAP[key]
    compact = code.replace(' ', '')
    primary = compact[0] if compact else '?'
    key = primary if primary in STATUS_TEXT_MAP else '?'
    return primary, STATUS_TEXT_MAP[key]


def _change_entry_sort_key(entry: GitChangeEntry) -> tuple[int, str]:
    """Keep tracked changes visible before untracked files consume the result cap."""
    compact = entry.code.replace(" ", "")
    if "U" in compact:
        priority = 0
    elif compact in ("??", "?"):
        priority = 2
    elif compact in ("!!", "!"):
        priority = 3
    else:
        priority = 1
    return priority, entry.path.replace("\\", "/")

async def start_file_search(
    root: Path,
    query: str,
    *,
    project_generation: int | None,
    correlation_id: str,
) -> JsonObject:
    """Start framework service.search file search; no local producer or fallback."""
    data = await _call_search_provider(
        "search.files.start",
        {
            "root": str(root),
            "projectGeneration": project_generation,
            "correlationId": correlation_id,
            "query": query,
            "maxResults": 500,
            "includeHidden": False,
            "useIgnoreFiles": True,
            "includePatterns": [],
            "excludePatterns": [],
        },
        root=root,
    )
    result = _json_object(data)
    if result.get("dto") != "SearchJobStarted":
        raise RuntimeError("Pipe RPC returned unexpected search.files.start DTO")
    return result


def _parse_glob_patterns(raw: str) -> list[str]:
    patterns: list[str] = []
    for chunk in raw.replace('\n', ',').split(','):
        pattern = chunk.strip()
        if pattern:
            patterns.append(pattern)
    return patterns


async def start_content_search(
    root: Path,
    params: SearchRunParams,
    *,
    project_generation: int | None,
    correlation_id: str,
) -> JsonObject:
    """Start framework service.search content search; no local producer or fallback."""
    data = await _call_search_provider(
        "search.content.start",
        {
            "root": str(root),
            "projectGeneration": project_generation,
            "correlationId": correlation_id,
            "query": params["query"],
            "isRegex": params["isRegex"],
            "isCaseSensitive": params["isCaseSensitive"],
            "isWholeWords": params["isWholeWords"],
            "includePatterns": _parse_glob_patterns(params["includePattern"]),
            "excludePatterns": _parse_glob_patterns(params["excludePattern"]),
            "useIgnoreFiles": params["useIgnoreFiles"],
            "contextChars": 75,
            "presentationWindow": {
                "maxInitialMatchesPerFile": 10,
                "maxInitialMatchesTotal": 50,
            },
        },
        root=root,
        project_generation=project_generation,
        correlation_id=correlation_id,
    )
    result = _json_object(data)
    if result.get("dto") != "SearchJobStarted":
        raise RuntimeError("Pipe RPC returned unexpected search.content.start DTO")
    return result


async def cancel_search_job(
    *,
    root: Path,
    search_id: str,
    job_id: str,
    project_generation: int | None,
    reason: str,
) -> JsonObject:
    data = await _call_search_provider(
        "search.job.cancel",
        {
            "dto": "SearchJobCancelRequest",
            "version": 1,
            "root": str(root),
            "projectGeneration": project_generation,
            "searchId": search_id,
            "jobId": job_id,
            "reason": reason,
        },
        root=root,
        project_generation=project_generation,
        correlation_id=search_id,
        op_id=job_id,
    )
    result = _json_object(data)
    if result.get("dto") != "SearchJobCancelResult":
        raise RuntimeError("Pipe RPC returned unexpected search.job.cancel DTO")
    return result


async def _call_search_provider(
    method: str,
    params: JsonObject,
    *,
    root: Path,
    project_generation: int | None = None,
    correlation_id: str | None = None,
    op_id: str | None = None,
) -> object:
    return await pipe_runtime.call_async(
        method,
        params,
        target_nid=SEARCH_SERVICE_TARGET_NID,
        target_name=SEARCH_SERVICE_TARGET_NAME,
        workspace_root=str(root),
        project_generation=project_generation,
        origin_name=SEARCH_SERVICE_ORIGIN_NAME,
        correlation_id=correlation_id,
        op_id=op_id,
    )


def _collect_diff(project_root: Path, rel_path: str, *, base_ref: str) -> DiffPayload:
    module = import_module("app.apps.file_editor_cm6.diff_helper")
    fn_obj = cast(object, module.__dict__.get("collect_diff"))
    if not callable(fn_obj):
        return {}
    collect = cast(CollectDiffFn, fn_obj)
    payload = collect(project_root, rel_path, base_ref=base_ref)
    raw = _json_object(payload)
    result: DiffPayload = {
        "summary": _json_object(raw.get("summary")),
        "hunks": _json_object_list(raw.get("hunks")),
    }
    error = raw.get("error")
    if error is not None:
        result["error"] = str(error)
    return result


def search_by_changes(project_root: Path) -> SearchChangesResult:
    project_path = str(project_root) # _history_store keys are strings
    
    if not worker_git_service.is_git_repository(project_root):
        return {
            "mode": "changes",
            "git": False,
            "base": _diff_base_payload(project_path),
            "changes": [],
            "truncated": False,
            "count": 0,
        }

    base_ref = _resolve_diff_base(project_path)
    entries = worker_git_service.get_worktree_changes(project_root, base_ref)

    truncated = len(entries) > CHANGE_RESULT_LIMIT
    selected = sorted(entries, key=_change_entry_sort_key)[:CHANGE_RESULT_LIMIT]
    changes: list[SearchChange] = []

    for entry in selected:
        rel_path = entry.path.replace('\\', '/')
        diff_payload = _collect_diff(project_root, rel_path, base_ref=base_ref)
        status_short, status_text = _status_meta_from_code(entry.code)
        summary = diff_payload.get("summary", {"added": 0, "deleted": 0, "tracked": False})

        change: SearchChange = {
            "rel": rel_path,
            "path": str((project_root / rel_path).resolve()),
            "label": Path(rel_path).name,
            "status": status_short,
            "statusCode": entry.code,
            "statusText": status_text,
            "summary": summary,
            "hunks": diff_payload.get("hunks", []),
            "isTracked": bool(summary.get("tracked", True)),
        }
        if entry.original_path:
            change["renamedFrom"] = entry.original_path
        if "error" in diff_payload:
            change["error"] = diff_payload["error"]
        changes.append(change)

    base_info = _diff_base_payload(project_path)

    return {
        "mode": "changes",
        "git": True,
        "base": base_info,
        "changes": changes,
        "truncated": truncated,
        "count": len(changes),
        "total": len(entries),
    }
