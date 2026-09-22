"""Transport-independent theme metadata; theme resources remain HTTP assets."""
# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from collections.abc import Mapping
from typing import Literal, TypedDict, cast

from .code_server_identity import PINNED_CODE_SERVER_VERSION, te2_managed_code_server_root
from .code_te2_paths import code_te2_paths

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


class SelectedTheme(TypedDict):
    id: str
    uiTheme: str
    theme: dict[str, object]


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


def _extension_roots() -> tuple[Path, ...]:
    install = te2_managed_code_server_root() / PINNED_CODE_SERVER_VERSION / "lib"
    return (
        code_te2_paths().code_server_extensions_dir,
        install / "code-server" / "lib" / "vscode" / "extensions",
        install / f"code-server-{PINNED_CODE_SERVER_VERSION}" / "lib" / "vscode" / "extensions",
    )


def _theme_resource(extension: dict[str, object], relative_path: str) -> Path | None:
    root_value = extension.get("path")
    if not isinstance(root_value, str) or not isinstance(extension.get("active"), bool) or not extension["active"]:
        return None
    root = Path(root_value).resolve()
    if not any(root.is_relative_to(allowed.resolve()) and root != allowed.resolve() for allowed in _extension_roots()):
        return None
    relative = Path(relative_path)
    if relative.is_absolute() or relative.suffix.lower() != ".json":
        return None
    target = (root / relative).resolve()
    return target if target.is_relative_to(root) and target.is_file() else None


def _parse_jsonc(source: str) -> dict[str, object] | None:
    # Strip JSONC comments without touching quoted strings, then trailing commas.
    output: list[str] = []
    index = 0
    quoted = False
    escaped = False
    while index < len(source):
        char = source[index]
        next_char = source[index + 1] if index + 1 < len(source) else ""
        if quoted:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
            output.append(char)
        elif char == "/" and next_char == "/":
            index += 2
            while index < len(source) and source[index] not in "\r\n":
                index += 1
            continue
        elif char == "/" and next_char == "*":
            end = source.find("*/", index + 2)
            if end < 0:
                return None
            output.extend("\n" if value == "\n" else " " for value in source[index:end + 2])
            index = end + 2
            continue
        else:
            output.append(char)
        index += 1
    cleaned = "".join(output)
    output = []
    quoted = False
    escaped = False
    for index, char in enumerate(cleaned):
        if quoted:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
            continue
        if char == '"':
            quoted = True
        if char == ",":
            next_index = index + 1
            while next_index < len(cleaned) and cleaned[next_index].isspace():
                next_index += 1
            if next_index < len(cleaned) and cleaned[next_index] in "}]":
                continue
        output.append(char)
    try:
        value = cast(object, json.loads("".join(output)))
    except ValueError:
        return None
    return _record(cast(object, value)) if isinstance(value, dict) else None


def _resolve_theme(extension: dict[str, object], relative_path: str) -> dict[str, object] | None:
    """Flatten supported theme includes within one registered extension."""
    root_value = extension.get("path")
    if not isinstance(root_value, str):
        return None
    root = Path(root_value).resolve()
    visited: set[Path] = set()

    def visit(path: Path) -> dict[str, object] | None:
        target = path.resolve()
        if target in visited or len(visited) >= 16 or not target.is_relative_to(root) or target.suffix.lower() != ".json" or not target.is_file():
            return None
        visited.add(target)
        try:
            data = _parse_jsonc(target.read_text("utf-8"))
        except OSError:
            return None
        if not data or "settings" in data or isinstance(data.get("tokenColors"), str):
            return None
        semantic_tokens = data.get("semanticTokenColors")
        if semantic_tokens is not None and not isinstance(semantic_tokens, dict):
            return None
        if "colors" in data and not isinstance(data["colors"], dict):
            return None
        tokens = data.get("tokenColors")
        if tokens is not None and not isinstance(tokens, list):
            return None
        include = data.get("include")
        if include is not None and (not isinstance(include, str) or not include or Path(include).is_absolute()):
            return None
        parent: dict[str, object] | None = visit(target.parent / include) if isinstance(include, str) else {}
        if parent is None:
            return None
        colors = _record(parent.get("colors"))
        colors.update(_record(data.get("colors")))
        # Includes contribute semantic selectors just as they contribute UI colors.
        semantic_colors = _record(parent.get("semanticTokenColors"))
        for selector, style in _record(cast(object, semantic_tokens)).items():
            _ = semantic_colors.pop(selector, None)
            semantic_colors[selector] = style
        parent_tokens = parent.get("tokenColors")
        result: dict[str, object] = {**parent, **data, "colors": colors,
                                      "semanticTokenColors": semantic_colors,
                                      "tokenColors": (parent_tokens if isinstance(parent_tokens, list) else []) + (tokens if isinstance(tokens, list) else [])}
        result["semanticHighlighting"] = bool(parent.get("semanticHighlighting")) or bool(data.get("semanticHighlighting"))
        _ = result.pop("include", None)
        return result

    resource = _theme_resource(extension, relative_path)
    return visit(resource) if resource is not None else None


def load_extension_theme(ext_dir: str, relative_path: str) -> dict[str, object] | None:
    """Serve only a declared theme, never an arbitrary extension JSON resource."""
    from .extension_registry import load_registry

    registry = _record(cast(object, load_registry()))
    for extension in _record(registry.get("extensions")).values():
        entry = _record(extension)
        root = entry.get("path")
        if not isinstance(root, str) or Path(root).name != ext_dir:
            continue
        for theme in _records(entry.get("themes")):
            path = theme.get("path")
            if isinstance(path, str) and Path(path).as_posix() == relative_path:
                resolved = _resolve_theme(entry, path)
                if resolved is not None:
                    resolved["uiTheme"] = _string(theme.get("uiTheme"), "vs-dark")
                return resolved
    return None


def _extension_theme_id(ext_id: str, label: str) -> str:
    return f"ext:{ext_id}:{label.lower().replace(' ', '-').replace('(', '').replace(')', '')}"


def resolve_selected_theme(preferences: Mapping[str, object]) -> SelectedTheme:
    """Resolve only the backend-selected theme; never enumerate theme bytes at boot."""
    editor = _record(preferences.get("editor"))
    selected = editor.get("theme")
    theme_id = selected if isinstance(selected, str) and selected else "github-dark"

    if VENDORED_THEMES_DIR.is_dir():
        for vendor_dir in sorted(VENDORED_THEMES_DIR.iterdir()):
            index_path = vendor_dir / "theme_index.json"
            if not index_path.is_file():
                continue
            try:
                index = _record(cast(object, json.loads(index_path.read_text("utf-8"))))
            except (OSError, ValueError):
                continue
            for item in _records(index.get("vendored")):
                if item.get("id") != theme_id:
                    continue
                filename = item.get("file")
                if not isinstance(filename, str):
                    break
                target = (vendor_dir / filename).resolve()
                if not target.is_relative_to(vendor_dir.resolve()) or target.suffix.lower() != ".json":
                    break
                try:
                    data = _parse_jsonc(target.read_text("utf-8"))
                except OSError:
                    data = None
                if data is not None:
                    return {"id": theme_id, "uiTheme": _string(item.get("uiTheme"), "vs-dark"), "theme": data}
                break

    from .extension_registry import load_registry

    registry = _record(cast(object, load_registry()))
    for extension_value in _record(registry.get("extensions")).values():
        extension = _record(extension_value)
        ext_id = extension.get("id")
        if not isinstance(ext_id, str):
            continue
        for item in _records(extension.get("themes")):
            path = item.get("path")
            if not isinstance(path, str):
                continue
            label = _string(item.get("label"), Path(path).stem)
            if label.startswith("%") and label.endswith("%"):
                label = Path(path).stem.replace("-", " ").replace("_", " ").title()
            if _extension_theme_id(ext_id, label) != theme_id:
                continue
            data = _resolve_theme(extension, path)
            if data is not None:
                return {"id": theme_id, "uiTheme": _string(item.get("uiTheme"), "vs-dark"), "theme": data}
    raise ValueError(f"Selected editor theme is unavailable: {theme_id}")


def build_theme_catalog() -> ThemeCatalog:
    # The catalog publishes only themes the shared resource resolver can serve.
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

    from .extension_registry import load_registry

    registry = _record(cast(object, load_registry()))
    for extension_value in _record(registry.get("extensions")).values():
        extension = _record(extension_value)
        ext_id, ext_path = extension.get("id"), extension.get("path")
        if not isinstance(ext_id, str) or not isinstance(ext_path, str) or not ext_id or not ext_path:
            continue
        for item in _records(extension.get("themes")):
            raw_path = item.get("path", "")
            if not isinstance(raw_path, str):
                continue
            resource = _theme_resource(extension, raw_path)
            if resource is None or _resolve_theme(extension, raw_path) is None:
                continue
            relative = Path(raw_path).as_posix().removeprefix("./")
            label = _string(item.get("label"), resource.stem)
            if label.startswith("%") and label.endswith("%"):
                label = resource.stem.replace("-", " ").replace("_", " ").title()
            themes.append({
                "id": _extension_theme_id(ext_id, label), "label": label,
                "uiTheme": _string(item.get("uiTheme"), "vs-dark"),
                "source": "extension",
                "sourceLabel": _string(extension.get("display_name"), ext_id),
                "serveUrl": f"monaco_editor/cs_themes/{Path(ext_path).name}/{relative}",
            })
    return {"themes": themes}


async def get_theme_catalog() -> ThemeCatalog:
    # Index and registry disk reads must not block either surface's RPC loop.
    return await asyncio.to_thread(build_theme_catalog)
