# pyright: strict
from __future__ import annotations

from pathlib import Path
from typing import TypedDict, cast

from .code_te2_paths import code_te2_paths
from .extension_registry import load_registry, resolve_code_server_installation


class TextmateGrammarDto(TypedDict):
    id: str
    scopeName: str
    language: str | None
    extensionId: str
    embeddedLanguages: dict[str, str]
    tokenTypes: dict[str, str]
    injectTo: list[str]
    balancedBracketScopes: list[str]
    unbalancedBracketScopes: list[str]


class TextmateLanguageDto(TypedDict):
    id: str
    extensions: list[str]
    filenames: list[str]


class TextmateCatalogDto(TypedDict):
    revision: str
    grammars: list[TextmateGrammarDto]
    languages: list[TextmateLanguageDto]


class TextmateGrammarBodyDto(TypedDict):
    ok: bool
    revision: str
    raw: str


class TextmateProjectionError(ValueError):
    pass


_MAX_GRAMMAR_BYTES = 4 * 1024 * 1024


def _record(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _records(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    items = cast(list[object], value)
    return [_record(cast(object, item)) for item in items if isinstance(item, dict)]


def _strings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in cast(list[object], value) if isinstance(item, str) and item]


def _string_map(value: object) -> dict[str, str]:
    return {
        key: item
        for key, item in _record(value).items()
        if isinstance(item, str) and item
    }


def _extension_entries() -> tuple[str, dict[str, dict[str, object]]]:
    registry = load_registry()
    revision_value = registry.get("textmate_revision")
    revision = revision_value if isinstance(revision_value, str) else ""
    extensions: dict[str, dict[str, object]] = {}
    for key, item in _record(registry.get("extensions", {})).items():
        if isinstance(item, dict):
            extensions[key] = _record(cast(object, item))
    return revision, extensions


def _grammar_id(extension_id: str, relative_path: str) -> str:
    return f"{extension_id}/{relative_path}"


def _allowed_extension_roots() -> tuple[Path, ...]:
    roots = [code_te2_paths().code_server_extensions_dir.resolve(strict=False)]
    installation = resolve_code_server_installation()
    if installation is not None and installation.vscode_root is not None:
        roots.append((installation.vscode_root / "extensions").resolve(strict=False))
    return tuple(roots)


def _is_allowed_extension_root(root: Path) -> bool:
    for allowed in _allowed_extension_roots():
        try:
            _ = root.relative_to(allowed)
            return root != allowed
        except ValueError:
            continue
    return False


def _public_grammar(extension_id: str, grammar: dict[str, object]) -> TextmateGrammarDto | None:
    relative_path = grammar.get("path")
    scope_name = grammar.get("scopeName")
    language_value = grammar.get("language")
    if not isinstance(relative_path, str) or not relative_path:
        return None
    if not isinstance(scope_name, str) or not scope_name:
        return None
    return {
        "id": _grammar_id(extension_id, relative_path),
        "scopeName": scope_name,
        "language": language_value if isinstance(language_value, str) and language_value else None,
        "extensionId": extension_id,
        "embeddedLanguages": _string_map(grammar.get("embeddedLanguages", {})),
        "tokenTypes": _string_map(grammar.get("tokenTypes", {})),
        "injectTo": _strings(grammar.get("injectTo", [])),
        "balancedBracketScopes": _strings(grammar.get("balancedBracketScopes", [])),
        "unbalancedBracketScopes": _strings(grammar.get("unbalancedBracketScopes", [])),
    }


def get_textmate_catalog() -> TextmateCatalogDto:
    revision, extensions = _extension_entries()
    grammars: list[TextmateGrammarDto] = []
    languages_by_id: dict[str, TextmateLanguageDto] = {}
    for extension_id in sorted(extensions):
        extension = extensions[extension_id]
        if extension.get("active") is False:
            continue
        extension_grammars = _records(extension.get("grammars", []))
        if not extension_grammars:
            continue
        for language in _records(extension.get("language_contributions", [])):
            language_id = language.get("id")
            if not isinstance(language_id, str) or not language_id:
                continue
            current = languages_by_id.setdefault(
                language_id,
                {"id": language_id, "extensions": [], "filenames": []},
            )
            current["extensions"] = sorted(set(current["extensions"] + _strings(language.get("extensions", []))))
            current["filenames"] = sorted(set(current["filenames"] + _strings(language.get("filenames", []))))
        for grammar in extension_grammars:
            public = _public_grammar(extension_id, grammar)
            if public is not None:
                grammars.append(public)
    return {
        "revision": revision,
        "grammars": grammars,
        "languages": [languages_by_id[key] for key in sorted(languages_by_id)],
    }


def get_textmate_grammar_body(grammar_id: str, revision: str) -> TextmateGrammarBodyDto:
    current_revision, extensions = _extension_entries()
    if not revision or revision != current_revision:
        raise TextmateProjectionError("textmate_projection_revision_changed")

    for extension_id, extension in extensions.items():
        if extension.get("active") is False:
            continue
        root_value = extension.get("path")
        if not isinstance(root_value, str) or not root_value:
            continue
        root = Path(root_value).expanduser().resolve(strict=False)
        if not _is_allowed_extension_root(root):
            continue
        for grammar in _records(extension.get("grammars", [])):
            relative_path = grammar.get("path")
            if not isinstance(relative_path, str) or not relative_path:
                continue
            if _grammar_id(extension_id, relative_path) != grammar_id:
                continue
            resource = (root / relative_path).resolve(strict=False)
            try:
                _ = resource.relative_to(root)
            except ValueError as exc:
                raise TextmateProjectionError("textmate_grammar_path_outside_extension") from exc
            try:
                stat = resource.stat()
            except OSError as exc:
                raise TextmateProjectionError("textmate_grammar_missing") from exc
            expected_size = grammar.get("size")
            expected_mtime_ns = grammar.get("mtime_ns")
            if (
                not isinstance(expected_size, int)
                or not isinstance(expected_mtime_ns, int)
                or stat.st_size != expected_size
                or stat.st_mtime_ns != expected_mtime_ns
            ):
                raise TextmateProjectionError("textmate_projection_resource_changed")
            if stat.st_size > _MAX_GRAMMAR_BYTES:
                raise TextmateProjectionError("textmate_grammar_too_large")
            try:
                raw = resource.read_text("utf-8")
            except (OSError, UnicodeError) as exc:
                raise TextmateProjectionError("textmate_grammar_unreadable") from exc
            return {"ok": True, "revision": current_revision, "raw": raw}

    raise TextmateProjectionError("textmate_grammar_not_found")
