# pyright: strict
from __future__ import annotations

import hashlib
import time
from collections.abc import Callable
from typing import Protocol, cast

from ..draft_diff_helper import compute_draft_diff as _compute_draft_diff  # type: ignore[reportUnknownVariableType]
from .editor_backend_services.contracts import JsonMap


ActiveProjectFn = Callable[[], str | None]
NormalizeAbsPathFn = Callable[[str], str | None]
IsUnderProjectFn = Callable[[str, str], bool]
ReadDiskTextFn = Callable[[str], str]
GitHeadTextFn = Callable[[str, str], str | None]
GetCachedDocumentFn = Callable[[str, str], dict[str, object] | None]
ComputeDraftDiffFn = Callable[[str, str, str], dict[str, object]]
compute_draft_diff: ComputeDraftDiffFn = cast(ComputeDraftDiffFn, _compute_draft_diff)


class RecordFileActivityFn(Protocol):
    def __call__(self, project: str, abs_path: str, *, scroll_line: float | None = None) -> None: ...


def _coerce_positive_int(value: object, *, default: int | None = None) -> int | None:
    if isinstance(value, int):
        return value if value > 0 else default
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        return parsed if parsed > 0 else default
    return default


def _coerce_optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _active_project_or_raise(active_project: ActiveProjectFn) -> str:
    project = active_project()
    if not project:
        raise ValueError("no_active_project")
    return project


def _resolve_required_path(
    params: dict[str, object],
    *,
    project: str,
    normalize_abs_path: NormalizeAbsPathFn,
    is_under_project: IsUnderProjectFn,
) -> str:
    path = normalize_abs_path(str(params.get("path") or ""))
    if not path:
        raise ValueError("missing_path")
    if not is_under_project(project, path):
        raise PermissionError("outside_project")
    return path


def build_editor_jump_to_line_payload(
    params: dict[str, object],
    *,
    source_client: str,
    active_project: ActiveProjectFn,
    normalize_abs_path: NormalizeAbsPathFn,
    is_under_project: IsUnderProjectFn,
    record_file_activity: RecordFileActivityFn,
) -> JsonMap:
    line = _coerce_positive_int(params.get("line"))
    if line is None:
        raise ValueError("missing_line")
    column = _coerce_positive_int(params.get("column"), default=1) or 1
    scroll_y = params.get("scroll_y") or params.get("scrollY")
    if not isinstance(scroll_y, str):
        scroll_y = None
    focus = _coerce_optional_bool(params.get("focus"))
    scroll_to_top_obj = params.get("scroll_to_top") if "scroll_to_top" in params else params.get("scrollToTop")
    scroll_to_top = _coerce_optional_bool(scroll_to_top_obj)

    path: str | None = None
    try:
        project = active_project()
        raw_path = str(params.get("path") or "")
        normalized = normalize_abs_path(raw_path) if raw_path else None
        if project and normalized and is_under_project(project, normalized):
            path = normalized
            record_file_activity(project, normalized, scroll_line=float(line))
    except Exception:
        path = None

    payload: JsonMap = {
        "line": line,
        "column": column,
        "scroll_y": scroll_y,
        "focus": focus,
        "scroll_to_top": scroll_to_top,
        "source_client": source_client,
    }
    if path:
        payload["path"] = path
    return payload


def build_editor_git_baselines_payload(
    params: dict[str, object],
    *,
    source_client: str,
    active_project: ActiveProjectFn,
    normalize_abs_path: NormalizeAbsPathFn,
    is_under_project: IsUnderProjectFn,
    read_disk_text: ReadDiskTextFn,
    git_head_text: GitHeadTextFn,
) -> JsonMap:
    project = _active_project_or_raise(active_project)
    path = _resolve_required_path(
        params,
        project=project,
        normalize_abs_path=normalize_abs_path,
        is_under_project=is_under_project,
    )
    from ..comparison_backend import selected_baseline

    return {**selected_baseline(project, path, read_disk_text), "source_client": source_client}


def build_editor_draft_diff_payload(
    params: dict[str, object],
    *,
    source_client: str,
    active_project: ActiveProjectFn,
    normalize_abs_path: NormalizeAbsPathFn,
    is_under_project: IsUnderProjectFn,
    read_disk_text: ReadDiskTextFn,
    get_cached_document: GetCachedDocumentFn,
) -> JsonMap:
    start = time.time()
    request_id_obj = params.get("requestId") or params.get("request_id")
    request_id = request_id_obj if isinstance(request_id_obj, str) and request_id_obj else None
    project = _active_project_or_raise(active_project)
    path = _resolve_required_path(
        params,
        project=project,
        normalize_abs_path=normalize_abs_path,
        is_under_project=is_under_project,
    )

    try:
        disk_content = read_disk_text(path)
        disk_sha256 = hashlib.sha256(disk_content.encode("utf-8")).hexdigest()
        cached = get_cached_document(project, path)
        if not cached or not cached.get("unsaved"):
            return {
                "path": path,
                "hunks": [],
                "summary": {"added": 0, "deleted": 0, "tracked": False},
                "disk_sha256": disk_sha256,
                "content_sha256": cached.get("content_sha256") if cached else None,
                "requestId": request_id,
                "ms": int((time.time() - start) * 1000),
                "source_client": source_client,
            }

        draft_content_obj = cached.get("content", "")
        draft_content = draft_content_obj if isinstance(draft_content_obj, str) else ""
        diff_data = compute_draft_diff(path, draft_content, disk_content)
        hunks_obj = diff_data.get("hunks", [])
        hunks = cast(list[object], hunks_obj) if isinstance(hunks_obj, list) else []
        default_summary: JsonMap = {"added": 0, "deleted": 0, "tracked": False}
        summary_obj = diff_data.get("summary", default_summary)
        summary = cast(JsonMap, summary_obj) if isinstance(summary_obj, dict) else default_summary
        error = diff_data.get("error")
        return {
            "path": path,
            "hunks": hunks,
            "summary": summary,
            "error": error,
            "disk_sha256": disk_sha256,
            "content_sha256": cached.get("content_sha256"),
            "requestId": request_id,
            "ms": int((time.time() - start) * 1000),
            "source_client": source_client,
        }
    except Exception as exc:
        return {
            "path": path,
            "hunks": [],
            "summary": {"added": 0, "deleted": 0, "tracked": False},
            "error": str(exc),
            "requestId": request_id,
            "ms": int((time.time() - start) * 1000),
            "source_client": source_client,
        }
