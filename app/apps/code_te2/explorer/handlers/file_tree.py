# pyright: strict
from __future__ import annotations

import importlib
import time
from pathlib import Path
from typing import Callable, Protocol, cast

from ..contracts.file_tree import (
    ExplorerBatchDestinationParams,
    ExplorerBatchRelsParams,
    ExplorerCreateEntryParams,
    ExplorerEditorOpenParams,
    ExplorerInboundTransferParams,
    ExplorerMoveCopyParams,
    ExplorerRelParams,
    ExplorerRenameEntryParams,
)
from ..context import ExplorerFileTreeHandlerContext
from ..services.state_facts import publish_explorer_directories_changed
from ..services.file_ops import mark_git_cache_dirty

ExplorerHelperCall = Callable[..., object]


class EmitEditorOpenFromBackend(Protocol):
    async def __call__(
        self,
        payload_in: dict[str, object] | None,
        *,
        source_client: str,
        request_id: str,
    ) -> object: ...


async def handle_create_file(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerCreateEntryParams,
    msg_id: str | None,
) -> None:
    del msg_id

    created = _call_explorer_helper_dict(
        "create_file",
        params["parent_rel"],
        params["name"],
    )
    del created
    await _publish_changed_dirs(context, [params["parent_rel"]], reason="create_file")


async def handle_create_dir(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerCreateEntryParams,
    msg_id: str | None,
) -> None:
    del msg_id

    created = _call_explorer_helper_dict(
        "create_directory",
        params["parent_rel"],
        params["name"],
    )
    del created
    await _publish_changed_dirs(context, [params["parent_rel"]], reason="create_dir")


async def handle_rename_entry(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerRenameEntryParams,
    msg_id: str | None,
) -> None:
    del msg_id

    renamed = _call_explorer_helper_dict(
        "rename_entry",
        params["rel"],
        params["new_name"],
    )
    del renamed
    await _publish_changed_dirs(
        context,
        [_get_parent_rel(params["rel"])],
        reason="rename_entry",
    )


async def handle_delete_entry(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerRelParams,
    msg_id: str | None,
) -> None:
    del msg_id

    deleted = _call_explorer_helper_dict("delete_entry", params["rel"])
    del deleted
    await _publish_changed_dirs(
        context,
        [_get_parent_rel(params["rel"])],
        reason="delete_entry",
    )
    mark_git_cache_dirty(context.project_root)
    await context.broadcast_git_status()


async def handle_batch_delete(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerBatchRelsParams,
    msg_id: str | None,
) -> None:
    del msg_id

    deleted = _call_explorer_helper_dict("batch_delete", params["rels"])
    del deleted

    for parent_rel in {_get_parent_rel(rel) for rel in params["rels"]}:
        await _publish_changed_dirs(context, [parent_rel], reason="batch_delete")

    mark_git_cache_dirty(context.project_root)
    await context.broadcast_git_status()


async def handle_batch_copy(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerBatchDestinationParams,
    msg_id: str | None,
) -> None:
    del msg_id

    copied = _call_explorer_helper_dict(
        "batch_copy",
        params["rels"],
        params["dest_path"],
    )
    del copied
    await _publish_changed_dirs(
        context,
        [_get_rel_from_abs(params["dest_path"], context.project_root)],
        reason="batch_copy",
    )


async def handle_batch_move(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerBatchDestinationParams,
    msg_id: str | None,
) -> None:
    del msg_id

    moved = _call_explorer_helper_dict(
        "batch_move",
        params["rels"],
        params["dest_path"],
    )
    del moved

    dest_rel = _get_rel_from_abs(params["dest_path"], context.project_root)
    parent_rels = {_get_parent_rel(rel) for rel in params["rels"]}
    parent_rels.add(dest_rel)
    await _publish_changed_dirs(context, list(parent_rels), reason="batch_move")


async def handle_editor_open(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerEditorOpenParams,
    msg_id: str | None,
) -> None:
    raw_path = params["raw_path"]
    if raw_path.startswith("/"):
        abs_path = str(Path(raw_path).expanduser())
    else:
        base_root = Path(params.get("project_root") or context.project_root)
        abs_path = str((base_root / raw_path.lstrip("/")).expanduser())

    open_payload: dict[str, object] = {
        "path": abs_path,
        "source": params["source"],
    }
    if "line" in params:
        open_payload["line"] = params["line"]
    if "column" in params:
        open_payload["column"] = params["column"]
    if "focus" in params:
        open_payload["focus"] = params["focus"]
    if "scroll_y" in params:
        open_payload["scroll_y"] = params["scroll_y"]
    if "scroll_to_top" in params:
        open_payload["scroll_to_top"] = params["scroll_to_top"]

    request_id = msg_id if isinstance(msg_id, str) and msg_id else _make_request_id()
    emit_editor_open = _get_emit_editor_open_from_backend()
    _ = await emit_editor_open(
        open_payload,
        source_client=context.client_instance_id,
        request_id=request_id,
    )


async def handle_move_entry(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerMoveCopyParams,
    msg_id: str | None,
) -> None:
    del msg_id

    moved = _call_explorer_helper_dict(
        "move_entry",
        params["rel"],
        params["dest_path"],
    )
    del moved

    source_parent = _get_parent_rel(params["rel"])
    dest_rel = _get_rel_from_abs(params["dest_path"], context.project_root)
    await _publish_changed_dirs(context, [source_parent, dest_rel], reason="move_entry")


async def handle_copy_entry(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerMoveCopyParams,
    msg_id: str | None,
) -> None:
    del msg_id

    copied = _call_explorer_helper_dict(
        "copy_entry",
        params["rel"],
        params["dest_path"],
    )
    del copied
    await _publish_changed_dirs(
        context,
        [_get_rel_from_abs(params["dest_path"], context.project_root)],
        reason="copy_entry",
    )


async def handle_copy_from(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerInboundTransferParams,
    msg_id: str | None,
) -> None:
    del msg_id

    copied = _call_explorer_helper_dict(
        "copy_entry_inbound",
        params["source_path"],
        params["dest_rel"],
    )
    del copied
    await _publish_changed_dirs(context, [params["dest_rel"]], reason="copy_from")


async def handle_move_from(
    context: ExplorerFileTreeHandlerContext,
    params: ExplorerInboundTransferParams,
    msg_id: str | None,
) -> None:
    del msg_id

    moved = _call_explorer_helper_dict(
        "move_entry_inbound",
        params["source_path"],
        params["dest_rel"],
    )
    del moved
    await _publish_changed_dirs(context, [params["dest_rel"]], reason="move_from")


async def _publish_changed_dirs(
    context: ExplorerFileTreeHandlerContext,
    rels: list[str],
    *,
    reason: str,
) -> None:
    await publish_explorer_directories_changed(
        context.project_root,
        rels,
        reason=reason,
        source="explorer_file_tree",
    )


def _call_explorer_helper_dict(name: str, *args: object) -> dict[str, object]:
    helper = _get_explorer_helper_callable(name)
    return _normalize_object_dict(helper(*args))


def _get_explorer_helper_callable(name: str) -> ExplorerHelperCall:
    helper_module = importlib.import_module("app.apps.code_te2.explorer.services.file_ops")
    helper = getattr(helper_module, name, None)
    if not callable(helper):
        raise RuntimeError(f"explorer.services.file_ops.{name} unavailable")
    return helper


def _normalize_object_dict(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, object] = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized


def _get_parent_rel(rel_path: str) -> str:
    if not rel_path or rel_path == ".":
        return "."
    parts = rel_path.replace("\\", "/").split("/")
    if len(parts) <= 1:
        return "."
    return "/".join(parts[:-1])


def _get_rel_from_abs(abs_path: str, project_root: Path) -> str:
    try:
        abs_resolved = Path(abs_path).resolve()
        root_resolved = project_root.resolve()
        if str(abs_resolved).startswith(str(root_resolved)):
            rel = abs_resolved.relative_to(root_resolved)
            return str(rel) if str(rel) != "." else "."
    except Exception:
        pass
    return "."


def _make_request_id() -> str:
    return f"explorer_{int(time.time() * 1000)}"


def _get_emit_editor_open_from_backend() -> EmitEditorOpenFromBackend:
    editor_ws_module = importlib.import_module(
        "app.apps.code_te2.monaco_editor.editor_ws"
    )
    emit_editor_open = getattr(editor_ws_module, "emit_editor_open_from_backend", None)
    if not callable(emit_editor_open):
        raise RuntimeError("emit_editor_open_from_backend unavailable")
    return cast(EmitEditorOpenFromBackend, emit_editor_open)
