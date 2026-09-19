"""
TE2 Extension Registry — SSOT for installed VS Code extensions and language slots.

Scans builtin + user-installed extensions, parses package.json contributes,
builds a unified registry with language slot mapping, and generates the
settings.json gate for code-server.

Registry is persisted in Code TE2's private canonical data root.
The registry retains one user-owned global settings map, which is materialized
with TE2's generated language gates into code-server User/settings.json.
"""

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import TypeAlias, cast


from .code_te2_paths import code_te2_paths
from .code_server_identity import (
    CodeServerInstallation as CodeServerInstallation,
    PINNED_CODE_SERVER_VERSION as PINNED_CODE_SERVER_VERSION,
    te2_managed_code_server_root as te2_managed_code_server_root,
)

JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
ExtensionEntry: TypeAlias = dict[str, object]
ExtensionMap: TypeAlias = dict[str, ExtensionEntry]
LanguageSlot: TypeAlias = dict[str, object]
LanguageSlotMap: TypeAlias = dict[str, LanguageSlot]
Registry: TypeAlias = dict[str, object]

# ── Paths ─────────────────────────────────────────────────────────────

_CODE_TE2_PATHS = code_te2_paths()
_CODE_SERVER_DATA_DIR = _CODE_TE2_PATHS.code_server_data_dir
_EXTENSIONS_DIR = _CODE_TE2_PATHS.code_server_extensions_dir
_USER_SETTINGS_PATH = _CODE_TE2_PATHS.code_server_user_settings_path
_REGISTRY_PATH = _CODE_TE2_PATHS.code_server_registry_path



def _json_object_from_text(text: str) -> JsonObject | None:
    try:
        raw = cast(object, json.loads(text))
    except Exception:
        return None
    if isinstance(raw, dict):
        raw_dict = cast(dict[object, object], raw)
        return {str(key): cast(JsonValue, value) for key, value in raw_dict.items()}
    return None


def _json_list_from_text(text: str) -> list[object] | None:
    try:
        raw = cast(object, json.loads(text))
    except Exception:
        return None
    return list(cast(list[object], raw)) if isinstance(raw, list) else None


def _object_dict(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _object_list(value: object) -> list[object]:
    return list(cast(list[object], value)) if isinstance(value, list) else []


def _str_list(value: object) -> list[str]:
    return [str(item) for item in _object_list(value) if isinstance(item, str)]


def _extension_map(value: object) -> ExtensionMap:
    raw = _object_dict(value)
    result: ExtensionMap = {}
    for key, item in raw.items():
        if isinstance(item, dict):
            result[key] = _object_dict(cast(object, item))
    return result


def _slot_map(value: object) -> LanguageSlotMap:
    raw = _object_dict(value)
    result: LanguageSlotMap = {}
    for key, item in raw.items():
        if isinstance(item, dict):
            result[key] = _object_dict(cast(object, item))
    return result


def _entry_string(entry: ExtensionEntry | LanguageSlot, key: str, default: str = "") -> str:
    value = entry.get(key, default)
    return value if isinstance(value, str) else default


def _entry_bool(entry: ExtensionEntry | LanguageSlot, key: str, default: bool = False) -> bool:
    value = entry.get(key, default)
    return value if isinstance(value, bool) else default


def _entry_string_list(entry: ExtensionEntry, key: str) -> list[str]:
    return _str_list(entry.get(key, []))


def _entry_object_dict(entry: ExtensionEntry, key: str) -> dict[str, object]:
    return _object_dict(entry.get(key, {}))


def _registry_extension_count(registry: Registry) -> int:
    return len(_extension_map(registry.get("extensions", {})))


def _registry_slot_count(registry: Registry) -> int:
    return len(_slot_map(registry.get("language_slots", {})))


def _write_json_object_atomic(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as file_obj:
            json.dump(value, file_obj, indent=2)
            file_obj.write("\n")
            temp_path = Path(file_obj.name)
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _path_is_executable(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def te2_managed_code_server_installation(
    version: str,
) -> CodeServerInstallation | None:
    """Validate package files only during explicit installation, never startup."""
    install_root = te2_managed_code_server_root() / version
    executable = install_root / "bin" / "code-server"
    if not _path_is_executable(executable):
        return None

    # The managed runtime has two supported private layouts: the official
    # standalone archive on Linux and the relocatable Termux package. Resolve
    # these exact locations instead of walking to filesystem root, where a
    # system /lib/code-server tree could otherwise be mistaken for the bundled
    # tree belonging to TE2's private launcher.
    for vscode_root in (
        install_root / "lib" / f"code-server-{version}" / "lib" / "vscode",
        install_root / "lib" / "code-server" / "lib" / "vscode",
        install_root / "lib" / "vscode",
        install_root / "vscode",
    ):
        try:
            _ = vscode_root.resolve(strict=False).relative_to(
                install_root.resolve(strict=False)
            )
        except ValueError:
            continue
        if (vscode_root / "extensions").is_dir():
            return CodeServerInstallation(
                executable=executable,
                vscode_root=vscode_root,
                source="te2-managed",
            )

    return CodeServerInstallation(
        executable=executable,
        vscode_root=None,
        source="te2-managed",
    )


def resolve_code_server_installation() -> CodeServerInstallation | None:
    from .code_server_install_state import selected_installation

    return selected_installation()


def resolve_code_server_executable() -> str | None:
    installation = resolve_code_server_installation()
    return str(installation.executable) if installation is not None else None


def _code_server_subprocess_env(installation: CodeServerInstallation) -> dict[str, str]:
    env = os.environ.copy()
    launcher_dir = str(installation.executable.parent)
    current_path = env.get("PATH", "")
    env["PATH"] = f"{launcher_dir}{os.pathsep}{current_path}" if current_path else launcher_dir
    return env


def _find_builtin_extensions_dir() -> str:
    installation = resolve_code_server_installation()
    if installation is not None and installation.vscode_root is not None:
        return str(installation.vscode_root / "extensions")
    return str(
        te2_managed_code_server_root()
        / PINNED_CODE_SERVER_VERSION
        / ".missing"
        / "extensions"
    )

# Extensions we never load — they spawn processes or do filesystem ops
# that hang in our headless environment
_EXCLUDED_EXTENSION_IDS = frozenset({
    "te2.te2-extension-api-bridge",
    "vscode.git",
    "vscode.git-base",
    "vscode.github",
    "vscode.github-authentication",
    "vscode.microsoft-authentication",
    "vscode.npm",
    "vscode.grunt",
    "vscode.gulp",
    "vscode.jake",
    "vscode.emmet",
    "vscode.ms-vscode.js-debug",
    "vscode.debug-auto-launch",
    "vscode.debug-server-ready",
    "vscode.extension-editing",
    "vscode.merge-conflict",
    "vscode.simple-browser",
    "vscode.ipynb",
    "vscode.media-preview",
    "vscode.references-view",
    "vscode.search-result",
    "vscode.mermaid-chat-features",
    "vscode.prompt-basics",
})

# Global settings gate — disable all smart features by default.
# Per-language overrides re-enable them for active slots.
_GLOBAL_GATE: dict[str, object] = {
    "editor.quickSuggestions": {"other": "off", "comments": "off", "strings": "off"},
    "editor.suggestOnTriggerCharacters": False,
    "editor.parameterHints.enabled": False,
    "editor.hover.enabled": False,
    "editor.codeLens": False,
    "breadcrumbs.enabled": False,
}

# Per-language overrides applied when a slot is active
_LANGUAGE_SLOT_OVERRIDES: dict[str, object] = {
    "editor.quickSuggestions": {"other": "on", "comments": "off", "strings": "off"},
    "editor.suggestOnTriggerCharacters": True,
    "editor.parameterHints.enabled": True,
    "editor.hover.enabled": True,
}

# Keys managed by the extension registry in settings.json.
# Other keys (e.g. files.watcherExclude) are preserved.
_MANAGED_GLOBAL_KEYS = set(_GLOBAL_GATE.keys())


# ── Extension scanning ────────────────────────────────────────────────

def _parse_package_json(pkg_path: Path) -> ExtensionEntry | None:
    """Parse a package.json and extract registry-relevant fields."""
    try:
        data = _json_object_from_text(pkg_path.read_text("utf-8"))
    except Exception:
        return None
    if data is None:
        return None

    # Resolve %token% NLS placeholders from package.nls.json
    nls_path = pkg_path.parent / "package.nls.json"
    if nls_path.is_file():
        try:
            nls = _json_object_from_text(nls_path.read_text("utf-8")) or {}
            for key in ("displayName", "description"):
                val = data.get(key, "")
                if isinstance(val, str) and val.startswith("%") and val.endswith("%"):
                    token = val[1:-1]
                    if token in nls:
                        data[key] = nls[token]
        except Exception:
            pass

    contributes = _object_dict(data.get("contributes", {}))

    # Extract language IDs from contributes.languages
    lang_ids: list[str] = []
    for lang_obj in _object_list(contributes.get("languages", [])):
        lang = _object_dict(lang_obj)
        lid = lang.get("id")
        if isinstance(lid, str) and lid:
            lang_ids.append(lid)

    # Extract configuration schema
    cfg = contributes.get("configuration")
    cfg_schema: dict[str, object] = {}
    if isinstance(cfg, dict):
        cfg_schema = _object_dict(_object_dict(cast(object, cfg)).get("properties", {}))
    elif isinstance(cfg, list):
        for block in cast(list[object], cfg):
            if isinstance(block, dict):
                cfg_schema.update(_object_dict(_object_dict(cast(object, block)).get("properties", {})))

    # Grammar scopes
    grammar_langs: list[str] = []
    for grammar_obj in _object_list(contributes.get("grammars", [])):
        grammar = _object_dict(grammar_obj)
        gl = grammar.get("language")
        if isinstance(gl, str) and gl:
            grammar_langs.append(gl)

    # Theme contributions
    theme_entries: list[dict[str, str]] = []
    for theme_obj in _object_list(contributes.get("themes", [])):
        theme = _object_dict(theme_obj)
        raw_label = theme.get("label", "")
        raw_ui_theme = theme.get("uiTheme", "vs-dark")
        raw_path = theme.get("path", "")
        label = raw_label if isinstance(raw_label, str) else ""
        ui_theme = raw_ui_theme if isinstance(raw_ui_theme, str) else "vs-dark"
        path_str = raw_path if isinstance(raw_path, str) else ""
        if label and path_str:
            theme_entries.append({
                "label": label,
                "uiTheme": ui_theme,
                "path": path_str,
            })

    raw_publisher = data.get("publisher", "vscode")
    raw_name = data.get("name", pkg_path.parent.name)
    publisher = raw_publisher if isinstance(raw_publisher, str) else "vscode"
    name = raw_name if isinstance(raw_name, str) else pkg_path.parent.name
    ext_id = f"{publisher}.{name}"

    return {
        "id": ext_id,
        "name": name,
        "publisher": publisher,
        "version": data.get("version", "0.0.0"),
        "languages": lang_ids,
        "grammar_languages": grammar_langs,
        "themes": theme_entries,
        "configuration_schema": cfg_schema,
        "display_name": data.get("displayName", name),
        "description": data.get("description", ""),
    }


def _scan_builtin_extensions() -> ExtensionMap:
    """Scan builtin extensions dir, return {ext_id: entry}."""
    results: ExtensionMap = {}
    builtin_extensions_dir = Path(_find_builtin_extensions_dir())
    if not builtin_extensions_dir.is_dir():
        print(f"[ext_registry] builtin dir not found: {builtin_extensions_dir}", flush=True)
        return results

    for d in sorted(builtin_extensions_dir.iterdir()):
        pkg = d / "package.json"
        if not pkg.is_file():
            continue
        parsed = _parse_package_json(pkg)
        if not parsed:
            continue

        ext_id = _entry_string(parsed, "id")
        if ext_id in _EXCLUDED_EXTENSION_IDS:
            continue

        # Only keep language-relevant builtins:
        # grammar providers, language-features, theme providers, or those with languages declared
        has_langs = bool(parsed["languages"])
        has_grammars = bool(parsed["grammar_languages"])
        has_themes = bool(parsed.get("themes"))
        is_lang_features = d.name.endswith("-language-features")
        has_config_editing = d.name == "configuration-editing"

        if not (has_langs or has_grammars or has_themes or is_lang_features or has_config_editing):
            continue

        entry: ExtensionEntry = {
            "id": ext_id,
            "name": parsed["name"],
            "version": parsed["version"],
            "source": "builtin",
            "active": True,
            "languages": parsed["languages"],
            "grammar_languages": parsed["grammar_languages"],
            "themes": parsed.get("themes", []),
            "is_language_features": is_lang_features,
            "display_name": parsed["display_name"],
            "description": parsed["description"],
            "configuration_schema": parsed["configuration_schema"],
            "path": str(d),
        }
        results[ext_id] = entry

    return results


def _scan_user_extensions() -> ExtensionMap:
    """Scan user-installed extensions from extensions.json manifest."""
    results: ExtensionMap = {}
    manifest_path = _EXTENSIONS_DIR / "extensions.json"
    if not manifest_path.is_file():
        return results

    try:
        manifest = _json_list_from_text(manifest_path.read_text("utf-8"))
    except Exception:
        print("[ext_registry] failed to parse extensions.json", flush=True)
        return results
    if manifest is None:
        return results

    for entry_obj in manifest:
        entry = _object_dict(entry_obj)
        identifier = _object_dict(entry.get("identifier", {}))
        raw_ext_id = identifier.get("id", "")
        ext_id = raw_ext_id if isinstance(raw_ext_id, str) else ""
        if not ext_id:
            continue
        if ext_id in _EXCLUDED_EXTENSION_IDS:
            continue

        location = _object_dict(entry.get("location", {}))
        raw_ext_path = location.get("path", "")
        ext_path = raw_ext_path if isinstance(raw_ext_path, str) else ""
        if not ext_path:
            # Try relativeLocation
            raw_rel = entry.get("relativeLocation", "")
            rel = raw_rel if isinstance(raw_rel, str) else ""
            if rel:
                ext_path = str(_EXTENSIONS_DIR / rel)

        pkg = Path(ext_path) / "package.json" if ext_path else None
        parsed = _parse_package_json(pkg) if pkg and pkg.is_file() else None

        result_entry: ExtensionEntry = {
            "id": ext_id,
            "name": parsed["name"] if parsed else ext_id.split(".")[-1],
            "version": _entry_string(entry, "version", "0.0.0"),
            "source": "user",
            "active": True,
            "languages": parsed["languages"] if parsed else [],
            "grammar_languages": parsed["grammar_languages"] if parsed else [],
            "themes": parsed.get("themes", []) if parsed else [],
            "is_language_features": False,
            "display_name": parsed["display_name"] if parsed else ext_id,
            "description": parsed["description"] if parsed else "",
            "configuration_schema": parsed["configuration_schema"] if parsed else {},
            "path": ext_path,
        }
        results[ext_id] = result_entry

    return results


# ── Language slot mapping ─────────────────────────────────────────────

def _build_language_slots(extensions: ExtensionMap) -> LanguageSlotMap:
    """Build language_slots from scanned extensions.

    A language slot is filled by the most specific extension providing
    intelligence for that language. Priority:
      1. User-installed extension declaring the language
      2. Builtin *-language-features extension
      3. Builtin grammar extension (syntax only, no intelligence)
    """
    slots: LanguageSlotMap = {}

    # Pass 1: builtin grammar extensions (lowest priority)
    for ext_id, ext in extensions.items():
        if _entry_string(ext, "source") != "builtin":
            continue
        if _entry_bool(ext, "is_language_features"):
            continue
        for lang in _entry_string_list(ext, "languages") + _entry_string_list(ext, "grammar_languages"):
            if lang not in slots:
                slots[lang] = {
                    "extension": ext_id,
                    "active": _entry_bool(ext, "active", True),
                    "source": "builtin",
                    "provides": "grammar",
                }

    # Pass 2: builtin language-features (overrides grammar-only)
    # Explicit mapping: language-features extension name → language IDs it serves.
    # This avoids the companion-lookup bug where typescript-basics declares
    # json/jsonc which would wrongly be claimed by typescript-language-features.
    _LANG_FEATURES_MAP = {
        "css-language-features": {"css"},
        "html-language-features": {"html"},
        "json-language-features": {"json", "jsonc", "jsonl"},
        "markdown-language-features": {"markdown"},
        "php-language-features": {"php"},
        "typescript-language-features": {
            "typescript", "typescriptreact",
            "javascript", "javascriptreact",
        },
    }

    for ext_id, ext in extensions.items():
        if _entry_string(ext, "source") != "builtin" or not _entry_bool(ext, "is_language_features"):
            continue

        served_langs = _LANG_FEATURES_MAP.get(_entry_string(ext, "name"))
        if served_langs is None:
            # Fallback: derive from companion grammar extension name
            companion_name = _entry_string(ext, "name").replace("-language-features", "")
            served_langs = set[str]()
            for edata in extensions.values():
                if _entry_string(edata, "source") == "builtin" and _entry_string(edata, "name") == companion_name:
                    served_langs.update(_entry_string_list(edata, "languages"))
                    served_langs.update(_entry_string_list(edata, "grammar_languages"))
                    break

        for lang in served_langs:
            slots[lang] = {
                "extension": ext_id,
                "active": _entry_bool(ext, "active", True),
                "source": "builtin",
                "provides": "language-features",
            }

    # Pass 3: user-installed extensions (highest priority)
    for ext_id, ext in extensions.items():
        if _entry_string(ext, "source") != "user":
            continue
        for lang in _entry_string_list(ext, "languages") + _entry_string_list(ext, "grammar_languages"):
            slots[lang] = {
                "extension": ext_id,
                "active": _entry_bool(ext, "active", True),
                "source": "user",
                "provides": "language-features",
            }

    return slots


# ── Registry persistence ─────────────────────────────────────────────

def _empty_registry() -> Registry:
    return {
        "version": 2,
        "updated_at": 0,
        "extensions": {},
        "language_slots": {},
        "user_settings": {},
    }


def _read_user_settings_file() -> dict[str, object]:
    if not _USER_SETTINGS_PATH.is_file():
        return {}
    try:
        return _object_dict(
            _json_object_from_text(_USER_SETTINGS_PATH.read_text("utf-8")) or {}
        )
    except Exception:
        return {}


def _legacy_user_settings_from_file() -> dict[str, object]:
    """Extract user-owned values from the old generated settings file."""
    settings: dict[str, object] = {}
    for key, value in _read_user_settings_file().items():
        if key in _MANAGED_GLOBAL_KEYS or key == "files.watcherExclude":
            continue
        if key.startswith("[") and key.endswith("]"):
            continue
        settings[key] = value
    return settings


def _migrate_registry_user_settings(registry: Registry) -> bool:
    version = registry.get("version")
    if version == 2 and isinstance(registry.get("user_settings"), dict):
        return False

    # Preserve the effective file first, then old schema-form values, and let
    # the explicit User JSON map win any historical conflict.
    user_settings = _legacy_user_settings_from_file()
    extensions = _extension_map(registry.get("extensions", {}))
    for extension in extensions.values():
        user_settings.update(_entry_object_dict(extension, "configuration_values"))
        extension.pop("configuration_values", None)
    user_settings.update(_object_dict(registry.get("custom_settings", {})))

    registry["version"] = 2
    registry["extensions"] = extensions
    registry["user_settings"] = user_settings
    registry.pop("custom_settings", None)
    return True


def load_registry() -> Registry:
    """Load persisted registry, or return empty."""
    if not _REGISTRY_PATH.is_file():
        return _empty_registry()
    try:
        data = _json_object_from_text(_REGISTRY_PATH.read_text("utf-8"))
    except OSError:
        return _empty_registry()
    if isinstance(data, dict) and "extensions" in data:
        registry: Registry = dict(data)
        if _migrate_registry_user_settings(registry):
            # A failed migration write must remain visible instead of silently
            # presenting an empty registry and risking a destructive rebuild.
            save_registry(registry)
        return registry
    return _empty_registry()


def save_registry(registry: Registry) -> None:
    """Persist registry to disk."""
    registry["updated_at"] = int(time.time() * 1000)
    _write_json_object_atomic(_REGISTRY_PATH, registry)
    print(
        f"[ext_registry] registry saved: {_registry_extension_count(registry)} extensions, "
        + f"{_registry_slot_count(registry)} slots",
        flush=True,
    )


# ── Full scan + rebuild ───────────────────────────────────────────────

def scan_and_rebuild() -> Registry:
    """Full scan of builtin + user extensions → rebuild registry + language slots.

    Preserves user settings and active toggles from the existing registry when
    an extension is still installed.
    """
    old_registry = load_registry()
    old_exts = _extension_map(old_registry.get("extensions", {}))
    old_slots = _slot_map(old_registry.get("language_slots", {}))

    # Scan
    builtins = _scan_builtin_extensions()
    user_exts = _scan_user_extensions()

    # Merge: user extensions override builtins with same ID
    all_exts = {**builtins, **user_exts}

    # Preserve active toggles from the previous registry. Extension settings
    # are global user settings, not extension-entry state.
    for ext_id, ext in all_exts.items():
        if ext_id in old_exts:
            old = old_exts[ext_id]
            ext["active"] = _entry_bool(old, "active", True)

    # Build slots
    slots = _build_language_slots(all_exts)

    # Preserve active toggles from old slots
    for lang, slot in slots.items():
        if lang in old_slots:
            slot["active"] = _entry_bool(old_slots[lang], "active", True)

    user_settings = _object_dict(old_registry.get("user_settings", {}))

    registry: Registry = {
        "version": 2,
        "updated_at": 0,
        "extensions": all_exts,
        "language_slots": slots,
        "user_settings": user_settings,
    }

    save_registry(registry)
    return registry


# ── Global user settings ──────────────────────────────────────────────

def get_custom_settings() -> dict[str, object]:
    """Return the user-owned global settings map."""
    registry = load_registry()
    return _object_dict(registry.get("user_settings", {}))


def set_custom_settings(settings: dict[str, object]) -> None:
    """Replace global user settings and rebuild the materialized file."""
    registry = load_registry()
    registry["user_settings"] = settings
    save_registry(registry)
    rebuild_settings_gate(registry)
    print(f"[ext_registry] user settings saved: {len(settings)} keys", flush=True)


# ── Settings gate generation ──────────────────────────────────────────

def rebuild_settings_gate(registry: Registry | None = None) -> dict[str, object]:
    """Generate and write the settings.json gate from registry state.

    Materializes the registry's User map with TE2's generated gates. The watcher
    synchronizer owns its existing files.watcherExclude value independently.

    Returns the final settings dict.
    """
    if registry is None:
        registry = load_registry()

    existing = _read_user_settings_file()
    preserved_framework_settings = {
        key: value
        for key, value in existing.items()
        if key == "files.watcherExclude"
    }

    # Apply the generated gate first. Explicit User settings are merged last
    # so the User scope remains the global workbench authority.
    settings: dict[str, object] = dict(_GLOBAL_GATE)

    # Apply per-language overrides for active slots
    slots = _slot_map(registry.get("language_slots", {}))
    for lang_id, slot in slots.items():
        if not _entry_bool(slot, "active", True):
            continue
        # Only create overrides for language-features providers
        if _entry_string(slot, "provides") != "language-features":
            continue

        lang_key = f"[{lang_id}]"
        overrides = dict(_LANGUAGE_SLOT_OVERRIDES)

        settings[lang_key] = overrides

    settings.update(preserved_framework_settings)
    settings.update(_object_dict(registry.get("user_settings", {})))

    _write_json_object_atomic(_USER_SETTINGS_PATH, settings)
    print(f"[ext_registry] settings gate written: {sum(1 for k in settings if k.startswith('['))} language overrides", flush=True)
    return settings


# ── Boot integration entry point ──────────────────────────────────────

def ensure_registry_and_gate() -> Registry:
    """Called at boot before code-server launch.

    Scans extensions, rebuilds registry, writes settings gate.
    Returns the registry for inspection.
    """
    registry = scan_and_rebuild()
    rebuild_settings_gate(registry)
    return registry


# ── Install / Uninstall ───────────────────────────────────────────────

def _require_code_server_installation() -> CodeServerInstallation:
    installation = resolve_code_server_installation()
    if installation is None:
        raise RuntimeError(
            "TE2's managed Code Server is not installed. "
            "Select Code Server in Languages & Extensions first."
        )
    return installation


def _run_code_server_extension_install(extension_spec: str) -> None:
    installation = _require_code_server_installation()
    cmd = [
        str(installation.executable),
        "--install-extension", extension_spec,
        "--user-data-dir", str(_CODE_SERVER_DATA_DIR),
        "--extensions-dir", str(_EXTENSIONS_DIR),
        "--force",
    ]

    print(f"[ext_registry] installing: {' '.join(cmd)}", flush=True)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
        env=_code_server_subprocess_env(installation),
    )

    if result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"code-server install failed (rc={result.returncode}): {err}")

    print(f"[ext_registry] install stdout: {result.stdout.strip()}", flush=True)


def _post_install_result(
    *,
    expected_ext_id: str | None = None,
    vsix_stem: str | None = None,
) -> dict[str, object]:
    registry = scan_and_rebuild()
    rebuild_settings_gate(registry)

    user_extensions = _scan_user_extensions()
    registry_extensions = _extension_map(registry.get("extensions", {}))
    installed: ExtensionEntry | None = None

    if expected_ext_id:
        expected_lower = expected_ext_id.lower()
        for ext_id, candidate in registry_extensions.items():
            if (
                ext_id.lower() == expected_lower
                and _entry_string(candidate, "source") == "user"
            ):
                installed = candidate
                break
        if installed is None:
            raise RuntimeError(
                f"code-server reported success but {expected_ext_id} was not installed"
            )
    else:
        normalized_stem = (vsix_stem or "").lower()
        for ext_id in user_extensions:
            if ext_id not in registry_extensions:
                continue
            candidate = registry_extensions[ext_id]
            if _entry_string(candidate, "source") != "user":
                continue
            installed = candidate
            if normalized_stem and normalized_stem in _entry_string(candidate, "path").lower():
                break

    return {
        "ok": True,
        "extension": installed,
        "registry_summary": {
            "total_extensions": _registry_extension_count(registry),
            "total_slots": _registry_slot_count(registry),
        },
    }


def install_extension(
    vsix_path: str,
    *,
    expected_ext_id: str | None = None,
) -> dict[str, object]:
    """Install a VSIX extension via code-server subprocess.

    Steps:
      1. Validate the .vsix file exists
      2. Run code-server --install-extension <path> --extensions-dir <dir> --force
      3. Verify the extension appears in extensions.json manifest
      4. Re-scan registry and rebuild settings gate
      5. Return the new extension entry + updated registry summary

    Returns dict with 'ok', 'extension', 'registry_summary'.
    Raises RuntimeError on failure.
    """
    vsix = Path(vsix_path)
    if not vsix.is_file():
        raise FileNotFoundError(f"VSIX file not found: {vsix_path}")
    if not vsix.name.endswith(".vsix"):
        raise ValueError(f"Not a .vsix file: {vsix_path}")

    _run_code_server_extension_install(str(vsix.resolve()))
    return _post_install_result(
        expected_ext_id=expected_ext_id,
        vsix_stem=vsix.stem,
    )


def uninstall_extension(ext_id: str) -> dict[str, object]:
    """Uninstall a user-installed extension via code-server subprocess.

    Builtin extensions cannot be uninstalled (use toggle_extension instead).

    Steps:
      1. Verify extension exists and is user-installed
      2. Run code-server --uninstall-extension <id> --extensions-dir <dir>
      3. Re-scan registry and rebuild settings gate

    Returns dict with 'ok', 'uninstalled_id', 'registry_summary'.
    Raises RuntimeError on failure, ValueError for builtins.
    """
    registry = load_registry()
    ext = _extension_map(registry.get("extensions", {})).get(ext_id)
    if not ext:
        raise ValueError(f"Extension not found: {ext_id}")
    if _entry_string(ext, "source") == "builtin":
        raise ValueError(f"Cannot uninstall builtin extension: {ext_id}. Use toggle instead.")

    installation = _require_code_server_installation()
    cmd = [
        str(installation.executable),
        "--uninstall-extension", ext_id,
        "--user-data-dir", str(_CODE_SERVER_DATA_DIR),
        "--extensions-dir", str(_EXTENSIONS_DIR),
    ]

    print(f"[ext_registry] uninstalling: {' '.join(cmd)}", flush=True)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
        env=_code_server_subprocess_env(installation),
    )

    if result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"code-server uninstall failed (rc={result.returncode}): {err}")

    print(f"[ext_registry] uninstall stdout: {result.stdout.strip()}", flush=True)

    # Re-scan to reflect removal
    registry = scan_and_rebuild()
    rebuild_settings_gate(registry)

    return {
        "ok": True,
        "uninstalled_id": ext_id,
        "registry_summary": {
            "total_extensions": _registry_extension_count(registry),
            "total_slots": _registry_slot_count(registry),
        },
    }


# ── Query helpers (for socket events / UI) ────────────────────────────

def get_extension_list() -> list[dict[str, object]]:
    """Return a UI-friendly list of all extensions."""
    registry = load_registry()
    user_settings = _object_dict(registry.get("user_settings", {}))
    result: list[dict[str, object]] = []
    for ext_id, ext in _extension_map(registry.get("extensions", {})).items():
        entry: dict[str, object] = {
            "id": ext_id,
            "display_name": _entry_string(ext, "display_name", ext_id),
            "version": _entry_string(ext, "version", "?"),
            "source": _entry_string(ext, "source", "unknown"),
            "active": _entry_bool(ext, "active", True),
            "languages": _entry_string_list(ext, "languages") + _entry_string_list(ext, "grammar_languages"),
            "has_config": bool(_entry_object_dict(ext, "configuration_schema")),
        }
        if entry["has_config"]:
            schema_keys = _entry_object_dict(ext, "configuration_schema").keys()
            entry["configuration_values"] = {
                key: user_settings[key]
                for key in schema_keys
                if key in user_settings
            }
        result.append(entry)
    return result


def get_language_slots() -> LanguageSlotMap:
    """Return current language slot mapping."""
    registry = load_registry()
    return _slot_map(registry.get("language_slots", {}))


def get_extension_config_schema(ext_id: str) -> dict[str, object]:
    """Return the configuration schema for an extension."""
    registry = load_registry()
    ext = _extension_map(registry.get("extensions", {})).get(ext_id, {})
    return _entry_object_dict(ext, "configuration_schema")


def set_extension_config(ext_id: str, values: dict[str, object]) -> dict[str, object]:
    """Merge one extension's schema values into global User settings."""
    registry = load_registry()
    ext = _extension_map(registry.get("extensions", {})).get(ext_id)
    if not ext:
        raise ValueError(f"Extension not found: {ext_id}")
    schema_keys = set(_entry_object_dict(ext, "configuration_schema"))
    user_settings = _object_dict(registry.get("user_settings", {}))
    for key in schema_keys:
        user_settings.pop(key, None)
    for key, value in values.items():
        if key in schema_keys:
            user_settings[key] = value
    registry["user_settings"] = user_settings
    save_registry(registry)
    return rebuild_settings_gate(registry)


def toggle_extension(ext_id: str, active: bool) -> dict[str, object]:
    """Toggle an extension active/inactive and rebuild gate."""
    registry = load_registry()
    ext = _extension_map(registry.get("extensions", {})).get(ext_id)
    if not ext:
        raise ValueError(f"Extension not found: {ext_id}")
    ext["active"] = active

    # Update corresponding language slots
    slots = _slot_map(registry.get("language_slots", {}))
    for slot in slots.values():
        if _entry_string(slot, "extension") == ext_id:
            slot["active"] = active
    registry["language_slots"] = slots

    save_registry(registry)
    return rebuild_settings_gate(registry)


def toggle_language_slot(lang_id: str, active: bool) -> dict[str, object]:
    """Toggle a language slot active/inactive and rebuild gate."""
    registry = load_registry()
    slots = _slot_map(registry.get("language_slots", {}))
    if lang_id not in slots:
        raise ValueError(f"Language slot not found: {lang_id}")
    slots[lang_id]["active"] = active
    registry["language_slots"] = slots
    save_registry(registry)
    return rebuild_settings_gate(registry)
