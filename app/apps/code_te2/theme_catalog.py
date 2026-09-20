"""Transport-independent theme metadata; theme resources remain HTTP assets."""
# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Literal, TypedDict, cast

logger = logging.getLogger(__name__)
VENDORED_THEMES_DIR = Path(__file__).with_name("monaco_editor") / "themes" / "vendored"


class ThemeEntry(TypedDict):
    id: str
    label: str
    uiTheme: str
    source: Literal["vendored", "extension"]
    sourceLabel: str
    serveUrl: str


class ThemeCatalog(TypedDict):
    themes: list[ThemeEntry]


def _record(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in cast(dict[object, object], value).items() if isinstance(key, str)}


def _records(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [_record(cast(object, item)) for item in cast(list[object], value) if isinstance(item, dict)]


def _string(value: object, default: str) -> str:
    return value if isinstance(value, str) else default


def build_theme_catalog() -> ThemeCatalog:
    # Preserve the existing catalog IDs/URLs. This is discovery only, not VSIX
    # theme loading, inheritance or a new extension-registry implementation.
    themes: list[ThemeEntry] = []
    if VENDORED_THEMES_DIR.is_dir():
        for vendor_dir in sorted(VENDORED_THEMES_DIR.iterdir()):
            index_path = vendor_dir / "theme_index.json"
            if not index_path.is_file():
                continue
            try:
                index = _record(cast(object, json.loads(index_path.read_text("utf-8"))))
            except (OSError, ValueError) as exc:
                logger.warning("Cannot read theme index %s: %s", index_path, exc)
                continue
            for item in _records(index.get("vendored")):
                theme_id, label, filename = item.get("id"), item.get("label"), item.get("file")
                if not isinstance(theme_id, str) or not isinstance(label, str) or not isinstance(filename, str):
                    continue
                themes.append({
                    "id": theme_id, "label": label,
                    "uiTheme": _string(item.get("uiTheme"), "vs-dark"),
                    "source": "vendored",
                    "sourceLabel": _string(index.get("source"), vendor_dir.name),
                    "serveUrl": f"monaco_editor/themes/vendored/{vendor_dir.name}/{filename}",
                })

    from .extension_registry import get_extension_list

    for extension in get_extension_list():
        ext_id, ext_path = extension.get("id"), extension.get("path")
        if not isinstance(ext_id, str) or not isinstance(ext_path, str) or not ext_id or not ext_path:
            continue
        for item in _records(extension.get("themes")):
            raw_path = item.get("path", "")
            if not isinstance(raw_path, str):
                continue
            filename = raw_path.rsplit("/", 1)[-1]
            label = _string(item.get("label"), filename)
            theme_id = label.lower().replace(" ", "-").replace("(", "").replace(")", "")
            themes.append({
                "id": f"ext:{ext_id}:{theme_id}", "label": label,
                "uiTheme": _string(item.get("uiTheme"), "vs-dark"),
                "source": "extension",
                "sourceLabel": _string(extension.get("display_name"), ext_id),
                "serveUrl": f"monaco_editor/cs_themes/{Path(ext_path).name}/{filename}",
            })
    return {"themes": themes}


async def get_theme_catalog() -> ThemeCatalog:
    # Index and registry disk reads must not block either surface's RPC loop.
    return await asyncio.to_thread(build_theme_catalog)
