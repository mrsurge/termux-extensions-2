# pyright: strict
from __future__ import annotations

import os
from pathlib import Path
from typing import cast

from app.libs import pipe_runtime
from . import file_ops

JsonObject = dict[str, object]

FS_ORIGIN_ENV = "FILE_EDITOR_CM6_EXPLORER_FS_ORIGIN"


def list_directory(rel: str) -> file_ops.FsDirectoryListing:
    """Return the FS listing DTO from the configured service origin."""
    origin = _configured_origin()
    if origin == "inprocess":
        return file_ops.build_fs_directory_listing(rel)
    if origin == "pipe":
        return _list_directory_via_pipe(rel)
    raise RuntimeError(f"Unsupported Explorer FS origin: {origin}")


def _configured_origin() -> str:
    value = str(os.environ.get(FS_ORIGIN_ENV) or "pipe").strip().lower()
    if value in {"", "pipe"}:
        return "pipe"
    if value in {"inprocess", "local"}:
        return "inprocess"
    raise RuntimeError(f"{FS_ORIGIN_ENV} must be 'inprocess' or 'pipe'")


def _list_directory_via_pipe(rel: str) -> file_ops.FsDirectoryListing:
    root = file_ops.get_project_root()
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
    listing = cast(file_ops.FsDirectoryListing, data)
    if listing.get("dto") != "FsDirectoryListing":
        raise RuntimeError("Pipe RPC returned unexpected listing DTO")
    return listing


def _request_path(root: Path, rel: str) -> str:
    if rel in {"", "."}:
        return "."
    candidate = Path(rel)
    if candidate.is_absolute():
        return str(candidate)
    return str((root / candidate).resolve())
