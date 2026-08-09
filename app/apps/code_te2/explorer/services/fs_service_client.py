# pyright: strict
from __future__ import annotations

from pathlib import Path
from typing import Literal, TypedDict, cast

from app.libs import pipe_runtime
from .project_root_state import get_project_root

JsonObject = dict[str, object]


class FsDirectoryEntry(TypedDict, total=False):
    name: str
    path: str
    relativePath: str
    kind: str
    type: str
    size: int
    mtime: int
    mtimeMs: int
    isSymlink: bool
    symlinkTarget: str | None
    symlinkTargetExists: bool | None
    symlinkTargetType: str | None
    mode: int


class FsDirectoryListing(TypedDict, total=False):
    dto: Literal["FsDirectoryListing"]
    version: int
    root: str
    path: str
    resolvedPath: str
    projectGeneration: int | None
    entries: list[FsDirectoryEntry]


class FsMutationResult(TypedDict, total=False):
    dto: Literal["FsMutationResult"]
    version: int
    root: str
    projectGeneration: int | None
    operation: str
    ok: bool
    changedPaths: list[str]
    absolutePaths: list[str]


def list_directory(rel: str) -> FsDirectoryListing:
    """Return the FS listing DTO from service.fs; no local fallback is allowed."""
    return _list_directory_via_pipe(rel)


def create_directory(parent_rel: str, name: str) -> dict[str, object]:
    result = _fs_mutation("fs.createDirectory", {"parentRel": parent_rel, "name": name})
    rel = _single_changed_path(result)
    return {"rel": rel, "name": name}


def create_file(parent_rel: str, name: str) -> dict[str, object]:
    result = _fs_mutation("fs.createFile", {"parentRel": parent_rel, "name": name})
    rel = _single_changed_path(result)
    return {"rel": rel, "name": name}


def rename_entry(rel: str, new_name: str) -> dict[str, object]:
    result = _fs_mutation("fs.rename", {"path": rel, "newName": new_name})
    changed = _changed_paths(result)
    new_rel = changed[-1] if changed else rel
    return {"old_rel": rel, "new_rel": new_rel, "new_name": new_name}


def delete_entry(rel: str) -> dict[str, object]:
    _ = _fs_mutation("fs.delete", {"path": rel, "recursive": True})
    return {"rel": rel, "deleted": True}


def copy_entry(rel: str, dest_dir_path: str) -> dict[str, object]:
    result = _fs_mutation("fs.copy", {"path": rel, "destination": dest_dir_path})
    return {"source_rel": rel, "dest_path": _single_absolute_path(result)}


def move_entry(rel: str, dest_dir_path: str) -> dict[str, object]:
    result = _fs_mutation("fs.move", {"path": rel, "destination": dest_dir_path})
    changed = _changed_paths(result)
    new_rel = changed[-1] if changed else None
    return {"old_rel": rel, "new_path": _single_absolute_path(result), "new_rel": new_rel}


def copy_entry_inbound(abs_source: str, dest_rel: str) -> dict[str, object]:
    result = _fs_mutation(
        "fs.copy",
        {
            "source": abs_source,
            "destination": dest_rel,
            "allowSourceOutsideRoot": True,
        },
    )
    return {"source_path": abs_source, "dest_rel": _single_changed_path(result)}


def move_entry_inbound(abs_source: str, dest_rel: str) -> dict[str, object]:
    result = _fs_mutation(
        "fs.move",
        {
            "source": abs_source,
            "destination": dest_rel,
            "allowSourceOutsideRoot": True,
        },
    )
    return {"source_path": abs_source, "dest_rel": _single_changed_path(result)}


def create_project(parent_path: str, name: str) -> dict[str, object]:
    parent_root = str(Path(parent_path).expanduser())
    result = _fs_mutation(
        "fs.createDirectory",
        {"parentRel": ".", "name": name},
        root=parent_root,
    )
    return {"path": _single_absolute_path(result)}


def _list_directory_via_pipe(rel: str) -> FsDirectoryListing:
    root = _get_project_root()
    params: JsonObject = {
        "root": str(root),
        "path": _request_path(root, rel),
        "hidden": True,
    }
    data = pipe_runtime.call(
        "fs.listDirectory",
        params,
        target_nid=2100,
        target_name="service.fs",
        workspace_root=str(root),
    )
    if not isinstance(data, dict):
        raise RuntimeError("Pipe RPC returned invalid fs.listDirectory data")
    listing = cast(FsDirectoryListing, cast(object, data))
    if listing.get("dto") != "FsDirectoryListing":
        raise RuntimeError("Pipe RPC returned unexpected listing DTO")
    return listing


def _fs_mutation(method: str, params: JsonObject, *, root: str | None = None) -> FsMutationResult:
    data = _call_fs_provider(method, params, root=root)
    if not isinstance(data, dict):
        raise RuntimeError(f"Pipe RPC returned invalid {method} data")
    result = cast(FsMutationResult, cast(object, data))
    if result.get("dto") != "FsMutationResult":
        raise RuntimeError(f"Pipe RPC returned unexpected {method} DTO")
    if not bool(result.get("ok")):
        raise RuntimeError(f"Pipe RPC {method} did not complete")
    return result


def _call_fs_provider(method: str, params: JsonObject, *, root: str | None = None) -> object:
    root_str = root or str(_get_project_root())
    payload: JsonObject = {"root": root_str, **params}
    return pipe_runtime.call(
        method,
        payload,
        target_nid=2100,
        target_name="service.fs",
        workspace_root=root_str,
        origin_name="code_te2.explorer.fs",
    )


def _changed_paths(result: FsMutationResult) -> list[str]:
    return [path for path in result.get("changedPaths", []) if path]


def _absolute_paths(result: FsMutationResult) -> list[str]:
    return [path for path in result.get("absolutePaths", []) if path]


def _single_changed_path(result: FsMutationResult) -> str:
    paths = _changed_paths(result)
    if paths:
        return paths[-1]
    raise RuntimeError("Pipe RPC returned mutation without changedPaths")


def _single_absolute_path(result: FsMutationResult) -> str:
    paths = _absolute_paths(result)
    if paths:
        return paths[-1]
    root = Path(str(result.get("root") or _get_project_root()))
    rel = _single_changed_path(result)
    return str(root / rel)


def _get_project_root() -> Path:
    return get_project_root()


def _request_path(root: Path, rel: str) -> str:
    if rel in {"", "."}:
        return "."
    candidate = Path(rel)
    if candidate.is_absolute():
        return str(candidate)
    return str((root / candidate).resolve())
