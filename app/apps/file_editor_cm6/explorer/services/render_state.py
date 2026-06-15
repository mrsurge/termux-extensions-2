# pyright: strict
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, cast

from ...project_sidecar import ProjectSidecar
from ..context import Broadcast, EmitPersonal
from . import file_ops as _file_ops

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
ListDirFn = Callable[[str], JsonObject]

list_dir = cast(ListDirFn, _file_ops.list_dir)


@dataclass(frozen=True)
class ExplorerBootstrapSnapshot:
    root_listing: JsonObject
    open_directories: list[str]
    open_directory_listings: list[JsonObject]


# Backend read-model builders. These functions centralize Explorer-facing state
# derived from disk and sidecars so bootstrap/reconnect does not rely on frontend
# restore attempts as the source of truth.
async def build_directory_listing(rel: str) -> JsonObject:
    return await asyncio.to_thread(list_dir, rel)


async def build_bootstrap_snapshot(project_root: Path) -> ExplorerBootstrapSnapshot:
    root_listing, open_directories = await asyncio.gather(
        build_directory_listing("."),
        asyncio.to_thread(load_pruned_open_directories, project_root),
    )
    open_directory_listings = await build_open_directory_listings(open_directories)
    return ExplorerBootstrapSnapshot(
        root_listing=root_listing,
        open_directories=open_directories,
        open_directory_listings=open_directory_listings,
    )


# Open-directory replay. Persisted open dirs are loaded from backend state and
# listed shallow-to-deep so existing frontend handlers can render parents before
# nested children without a contract change.
async def build_open_directory_listings(open_directories: list[str]) -> list[JsonObject]:
    listings: list[JsonObject] = []
    for rel in _sort_open_directories_for_replay(open_directories):
        try:
            listings.append(await build_directory_listing(rel))
        except Exception as exc:
            logger.debug(
                "[explorer_render_state] skipped open directory listing rel=%s error=%s",
                rel,
                exc,
            )
    return listings


def load_pruned_open_directories(project_root: Path) -> list[str]:
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        original = sidecar.get_open_directories()
        pruned = [
            rel
            for rel in original
            if _is_existing_project_directory(project_root, rel)
        ]
        if pruned != original:
            sidecar.set_open_directories(pruned)
            sidecar.save()
            logger.info(
                "[explorer_render_state] pruned missing open directories project=%s before=%s after=%s",
                project_root,
                len(original),
                len(pruned),
            )
        return pruned
    except Exception as exc:
        logger.warning("Failed to load Explorer open directories: %s", exc)
        return []


# Projection helpers. They intentionally reuse existing Explorer RPC
# notification names so this backend read-model slice does not create a frontend
# contract migration.
async def emit_bootstrap_snapshot(
    emit_personal: EmitPersonal,
    snapshot: ExplorerBootstrapSnapshot,
) -> None:
    await emit_personal("explorer.list.updated", snapshot.root_listing)
    await emit_personal(
        "explorer.openDirs.updated",
        {"dirs": snapshot.open_directories},
    )
    for listing in snapshot.open_directory_listings:
        await emit_personal("explorer.list.updated", listing)


async def broadcast_directory_listing(
    broadcast: Broadcast,
    rel: str,
) -> None:
    await broadcast("explorer.list.updated", await build_directory_listing(rel))


def _is_existing_project_directory(project_root: Path, rel: str) -> bool:
    if not rel:
        return False
    try:
        root = project_root.expanduser().resolve(strict=False)
        target = (root / rel).resolve(strict=False)
        target.relative_to(root)
        return target.is_dir()
    except Exception:
        return False


def _sort_open_directories_for_replay(open_directories: list[str]) -> list[str]:
    return sorted(
        [rel for rel in open_directories if rel],
        key=lambda rel: (rel.count("/"), rel),
    )
