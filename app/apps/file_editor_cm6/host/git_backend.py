from __future__ import annotations

from pathlib import Path

from ..explorer.services.file_ops import mark_git_cache_dirty, set_project_root
from ..stores import get_history_store
from ..worker_services import git_service as worker_git_service
from ..worker_services.git_service import GitBranches


def _active_project_root() -> Path:
    history = get_history_store()
    project_path = history.get_active_project()
    if not project_path:
        raise RuntimeError("No project selected")
    project_root = Path(project_path).expanduser()
    if not project_root.exists():
        raise RuntimeError(f'Project "{project_path}" not found')
    _ = set_project_root(str(project_root))
    return project_root


def _branches_payload(info: GitBranches) -> dict[str, object]:
    return {"current": info.current, "branches": info.branches}


def _string_param(params: dict[str, object], key: str) -> str | None:
    value = params.get(key)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


async def handle_host_git_branches_list_request(
    params: dict[str, object],
    *,
    source_name: str,
) -> dict[str, object]:
    del params, source_name
    return _branches_payload(worker_git_service.list_branches(_active_project_root()))


async def handle_host_git_branch_checkout_request(
    params: dict[str, object],
    *,
    source_name: str,
) -> dict[str, object]:
    del source_name
    name = _string_param(params, "name")
    if not name:
        raise RuntimeError("Branch name required")
    project_root = _active_project_root()
    info = worker_git_service.checkout_branch(project_root, name)
    mark_git_cache_dirty(project_root)
    return _branches_payload(info)


async def handle_host_git_branch_create_request(
    params: dict[str, object],
    *,
    source_name: str,
) -> dict[str, object]:
    del source_name
    name = _string_param(params, "name")
    if not name:
        raise RuntimeError("Branch name required")
    project_root = _active_project_root()
    info = worker_git_service.create_branch(project_root, name)
    mark_git_cache_dirty(project_root)
    return _branches_payload(info)


async def handle_host_git_remote_add_request(
    params: dict[str, object],
    *,
    source_name: str,
) -> dict[str, object]:
    del source_name
    name = _string_param(params, "name")
    url = _string_param(params, "url")
    if not name or not url:
        raise RuntimeError("Name and URL required")
    project_root = _active_project_root()
    worker_git_service.add_remote(project_root, name, url)
    origin = worker_git_service.get_origin_url(project_root)
    get_history_store().set_project_origin(str(project_root), origin)
    mark_git_cache_dirty(project_root)
    return {"ok": True, "origin": origin or ""}
