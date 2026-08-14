# pyright: strict
from __future__ import annotations

import os
from pathlib import Path
from typing import cast

from ..context import ExplorerExtensionHandlerContext
from ..contracts.extension_menus import (
    ExplorerExtensionCommandParams,
    ExplorerExtensionMenuResolveParams,
)

JsonObject = dict[str, object]


def _resolve_entry(project_root: Path, rel: str) -> Path:
    root = project_root.expanduser().resolve()
    candidate = (root / rel).resolve()
    try:
        _ = candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Explorer extension target is outside the active project") from exc
    if not candidate.exists():
        raise ValueError("Explorer extension target does not exist")
    return candidate


def _adapter_result(response: JsonObject) -> JsonObject:
    error = response.get("error")
    if error:
        raise RuntimeError(f"WBA extension command failed: {error}")
    result = response.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("WBA extension command returned an invalid result")
    return {str(key): value for key, value in cast(dict[object, object], result).items()}


async def handle_extension_menu_resolve(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionMenuResolveParams,
    msg_id: str | None,
) -> None:
    from ...workbench_adapter_shell_manager import adapter_rpc

    root = context.project_root.expanduser().resolve()
    target = _resolve_entry(root, params["rel"])
    is_root = target == root
    parent = target.parent
    response = await adapter_rpc(
        "vscode.extensionMenus.resolve",
        {
            "menu": "explorer/context",
            "surface": "explorer",
            "path": str(target),
            "context": {
                "explorerResourceIsFolder": target.is_dir(),
                "explorerResourceIsRoot": is_root,
                "explorerResourceReadonly": not os.access(target, os.W_OK),
                "explorerResourceParentReadonly": not os.access(parent, os.W_OK),
                "explorerResourceMoveableToTrash": not is_root,
                "explorerViewletVisible": True,
                "foldersViewVisible": True,
            },
        },
        timeout=15.0,
    )
    await context.emit_personal(
        "explorer.extensions.menu.resolved",
        _adapter_result(response),
        msg_id,
    )


async def handle_extension_command_execute(
    context: ExplorerExtensionHandlerContext,
    params: ExplorerExtensionCommandParams,
    msg_id: str | None,
) -> None:
    from ...workbench_adapter_shell_manager import adapter_rpc

    root = context.project_root.expanduser().resolve()
    target = _resolve_entry(root, params["rel"])
    selected = [
        str(_resolve_entry(root, rel))
        for rel in params["selected_rels"]
    ]
    response = await adapter_rpc(
        "vscode.extensionCommands.execute",
        {
            "surface": "explorer",
            "path": str(target),
            "selectedPaths": selected,
            "command": params["command"],
        },
        timeout=40.0,
    )
    await context.emit_personal(
        "explorer.extensions.command.executed",
        _adapter_result(response),
        msg_id,
    )
