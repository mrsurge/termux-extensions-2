# pyright: strict
from __future__ import annotations

from pathlib import Path
import hashlib
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


class TextmateGrammarErrorDto(TypedDict):
    ok: bool
    error: str


class TextmateGrammarBatchDto(TypedDict):
    revision: str
    bodies: dict[str, TextmateGrammarBodyDto | TextmateGrammarErrorDto]


class TextmateClosureDto(TypedDict):
    revision: str
    rootScope: str
    complete: bool
    ids: list[str]
    bodies: dict[str, TextmateGrammarBodyDto]
    fingerprints: dict[str, str]


class TextmateProjectionError(ValueError):
    pass


_MAX_GRAMMAR_BYTES = 4 * 1024 * 1024
MAX_GRAMMAR_BATCH_SIZE = 16
_MAX_GRAMMAR_BATCH_BYTES = 8 * 1024 * 1024
MAX_GRAMMAR_CLOSURE_SIZE = 256
MAX_GRAMMAR_KNOWN_IDS = 4096


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


def _is_allowed_extension_root(root: Path, allowed_roots: tuple[Path, ...]) -> bool:
    for allowed in allowed_roots:
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
    return _grammar_body_from_snapshot(grammar_id, current_revision, extensions, _allowed_extension_roots())


def get_textmate_grammar_closure(scope: str, revision: str, known_ids: list[str], metadata_only: bool = False) -> TextmateClosureDto:
    from .textmate_probe import trace
    trace("closure.enter", scope=scope, revision=revision, known=len(known_ids))
    from . import persistence_io
    from .textmate_dependencies import Rule, record, resolve_dependencies

    current_revision, extensions = _extension_entries()
    trace("closure.registry", scope=scope, extensions=len(extensions))
    if not revision or revision != current_revision:
        raise TextmateProjectionError("textmate_projection_revision_changed")
    if not scope or len(known_ids) > MAX_GRAMMAR_KNOWN_IDS:
        raise TextmateProjectionError("textmate_closure_invalid")
    by_scope: dict[str, TextmateGrammarDto] = {}
    injection_map: dict[str, list[str]] = {}
    for extension_id in sorted(extensions):
        extension = extensions[extension_id]
        if extension.get("active") is False:
            continue
        for grammar in _records(extension.get("grammars", [])):
            public = _public_grammar(extension_id, grammar)
            if public is not None:
                by_scope[public["scopeName"]] = public
    # Match the frontend's final byScope mapping, including override order.
    for public in by_scope.values():
        for target in public["injectTo"]:
            injection_map.setdefault(target, []).append(public["scopeName"])
    roots = _allowed_extension_roots()
    bodies: dict[str, TextmateGrammarBodyDto] = {}
    total_bytes = 0

    def load(target: str) -> Rule | None:
        nonlocal total_bytes
        public = by_scope.get(target)
        if public is None:
            return None
        if len(bodies) >= MAX_GRAMMAR_CLOSURE_SIZE:
            raise TextmateProjectionError("textmate_closure_too_large")
        grammar_id = public["id"]
        trace("closure.read.start", scope=target, grammar_id=grammar_id)
        body = _grammar_body_from_snapshot(grammar_id, revision, extensions, roots)
        trace("closure.read.end", scope=target, raw_bytes=len(body["raw"].encode("utf-8")))
        total_bytes += len(body["raw"].encode("utf-8"))
        if total_bytes > _MAX_GRAMMAR_BATCH_BYTES:
            raise TextmateProjectionError("textmate_closure_too_large")
        bodies[grammar_id] = body
        try:
            if grammar_id.endswith(".json"):
                parsed = persistence_io.decode_json(body["raw"])
            else:
                import plistlib
                parsed = cast(object, plistlib.loads(body["raw"].encode("utf-8")))
        except (ValueError, TypeError, OverflowError) as exc:
            raise TextmateProjectionError("textmate_grammar_invalid") from exc
        if not isinstance(parsed, dict):
            raise TextmateProjectionError("textmate_grammar_invalid")
        trace("closure.parse.end", scope=target)
        return record(cast(object, parsed))

    def injections(target: str) -> list[str]:
        parts = target.split(".")
        return [injected for index in range(1, len(parts) + 1)
                for injected in injection_map.get(".".join(parts[:index]), [])]

    complete = True
    try:
        scopes = resolve_dependencies(scope, load, injections)
        trace("closure.traversal.end", scope=scope, scopes=len(scopes), raw_bytes=total_bytes)
        ids = [by_scope[target]["id"] for target in scopes]
    except ValueError as exc:
        if str(exc) != "textmate_closure_too_large":
            raise TextmateProjectionError(str(exc)) from exc
        # Preload is an optimization, not a new total-size restriction. Keep a
        # bounded prefix; the same factory uses existing guarded batch reads for
        # dependencies beyond it. Never mask invalid/stale/unreadable resources.
        complete = False
        ids = list(bodies)
    # A registry update during disk work must not publish a stale closure.
    if _extension_entries()[0] != revision:
        raise TextmateProjectionError("textmate_projection_revision_changed")
    known = set(known_ids)
    trace("closure.return", scope=scope, complete=complete, bodies=len(bodies), raw_bytes=total_bytes)
    return {"revision": revision, "rootScope": scope, "complete": complete, "ids": ids,
            "fingerprints": {grammar_id: hashlib.sha256(body["raw"].encode("utf-8")).hexdigest() for grammar_id, body in bodies.items()},
            "bodies": {} if metadata_only else {grammar_id: body for grammar_id, body in bodies.items() if grammar_id not in known}}


def get_textmate_http_grammar(grammar_id: str, revision: str, fingerprint: str = "") -> dict[str, object]:
    """Guarded resource read; HTTP never selects a language or filesystem path."""
    body = get_textmate_grammar_body(grammar_id, revision)
    raw = body["raw"]
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    if fingerprint and fingerprint != digest:
        raise TextmateProjectionError("textmate_grammar_fingerprint_changed")
    current_revision, _ = _extension_entries()
    if current_revision != revision:
        raise TextmateProjectionError("textmate_projection_revision_changed")
    return {"id": grammar_id, "revision": revision, "sha256": digest, "raw": raw}


def get_textmate_grammar_chunk(grammar_id: str, revision: str, offset: int) -> dict[str, object]:
    """Character-aligned chunks: at most 64 KiB UTF-8, without split codepoints."""
    body = get_textmate_grammar_body(grammar_id, revision)
    raw = body["raw"]
    if offset < 0 or offset >= len(raw):
        raise TextmateProjectionError("textmate_chunk_offset_invalid")
    # Byte-bounded rather than a tiny fixed character count: ASCII grammars
    # fill the frame while multibyte text remains codepoint-aligned.
    segment = raw[offset:offset + 65_536].encode("utf-8")[:65_536].decode("utf-8", errors="ignore")
    end = offset + len(segment)
    current_revision, _ = _extension_entries()
    if current_revision != revision:
        raise TextmateProjectionError("textmate_projection_revision_changed")
    return {"revision": revision, "id": grammar_id, "offset": offset,
            "nextOffset": end, "done": end == len(raw), "raw": segment,
            "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest()}


def get_textmate_grammar_bodies(grammar_ids: list[str], revision: str) -> TextmateGrammarBatchDto:
    if not grammar_ids or len(grammar_ids) > MAX_GRAMMAR_BATCH_SIZE or len(set(grammar_ids)) != len(grammar_ids):
        raise TextmateProjectionError("textmate_grammar_batch_invalid")
    current_revision, extensions = _extension_entries()
    if not revision or revision != current_revision:
        raise TextmateProjectionError("textmate_projection_revision_changed")
    allowed_roots = _allowed_extension_roots()
    bodies: dict[str, TextmateGrammarBodyDto | TextmateGrammarErrorDto] = {}
    total_bytes = 0
    for grammar_id in grammar_ids:
        try:
            body = _grammar_body_from_snapshot(grammar_id, current_revision, extensions, allowed_roots)
            body_bytes = len(body["raw"].encode("utf-8"))
            if total_bytes + body_bytes > _MAX_GRAMMAR_BATCH_BYTES:
                raise TextmateProjectionError("textmate_grammar_batch_too_large")
            total_bytes += body_bytes
            bodies[grammar_id] = body
        except TextmateProjectionError as exc:
            bodies[grammar_id] = {"ok": False, "error": str(exc)}
    return {"revision": current_revision, "bodies": bodies}


def _grammar_body_from_snapshot(
    grammar_id: str,
    current_revision: str,
    extensions: dict[str, dict[str, object]],
    allowed_roots: tuple[Path, ...],
) -> TextmateGrammarBodyDto:

    extension_id, separator, requested_path = grammar_id.partition("/")
    if not separator or not extension_id or not requested_path:
        raise TextmateProjectionError("textmate_grammar_not_found")
    extension = extensions.get(extension_id)
    if extension is None or extension.get("active") is False:
        raise TextmateProjectionError("textmate_grammar_not_found")
    root_value = extension.get("path")
    if not isinstance(root_value, str) or not root_value:
        raise TextmateProjectionError("textmate_grammar_not_found")
    root = Path(root_value).expanduser().resolve(strict=False)
    if not _is_allowed_extension_root(root, allowed_roots):
        raise TextmateProjectionError("textmate_grammar_not_found")
    for grammar in _records(extension.get("grammars", [])):
        relative_path = grammar.get("path")
        if relative_path != requested_path:
            continue
        resource = (root / requested_path).resolve(strict=False)
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
