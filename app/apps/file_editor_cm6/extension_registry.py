"""
TE2 Extension Registry — SSOT for installed VS Code extensions and language slots.

Scans builtin + user-installed extensions, parses package.json contributes,
builds a unified registry with language slot mapping, and generates the
settings.json gate for code-server.

Registry is persisted at ~/.config/code-server/te2_extension_registry.json.
settings.json is an OUTPUT of the registry (one-way flow, never read back).
"""

import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

# ── Paths ─────────────────────────────────────────────────────────────

_CODE_SERVER_DATA_DIR = Path.home() / ".config" / "code-server"
_EXTENSIONS_DIR = _CODE_SERVER_DATA_DIR / "extensions"
_USER_SETTINGS_PATH = _CODE_SERVER_DATA_DIR / "User" / "settings.json"
_REGISTRY_PATH = _CODE_SERVER_DATA_DIR / "te2_extension_registry.json"

# Builtin extensions shipped with code-server
_BUILTIN_EXTENSIONS_DIR = Path(
    os.environ.get(
        "TE2_BUILTIN_EXTENSIONS_DIR",
        "/data/data/com.termux/files/usr/lib/code-server/lib/vscode/extensions",
    )
)

# Extensions we never load — they spawn processes or do filesystem ops
# that hang in our headless environment
_EXCLUDED_EXTENSION_IDS = frozenset({
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
_GLOBAL_GATE = {
    "editor.quickSuggestions": {"other": "off", "comments": "off", "strings": "off"},
    "editor.suggestOnTriggerCharacters": False,
    "editor.parameterHints.enabled": False,
    "editor.hover.enabled": False,
    "editor.codeLens": False,
    "breadcrumbs.enabled": False,
}

# Per-language overrides applied when a slot is active
_LANGUAGE_SLOT_OVERRIDES = {
    "editor.quickSuggestions": {"other": "on", "comments": "off", "strings": "off"},
    "editor.suggestOnTriggerCharacters": True,
    "editor.parameterHints.enabled": True,
    "editor.hover.enabled": True,
}

# Keys managed by the extension registry in settings.json.
# Other keys (e.g. files.watcherExclude) are preserved.
_MANAGED_GLOBAL_KEYS = set(_GLOBAL_GATE.keys())


# ── Extension scanning ────────────────────────────────────────────────

def _parse_package_json(pkg_path: Path) -> Optional[dict]:
    """Parse a package.json and extract registry-relevant fields."""
    try:
        data = json.loads(pkg_path.read_text("utf-8"))
    except Exception:
        return None

    # Resolve %token% NLS placeholders from package.nls.json
    nls_path = pkg_path.parent / "package.nls.json"
    if nls_path.is_file():
        try:
            nls = json.loads(nls_path.read_text("utf-8"))
            for key in ("displayName", "description"):
                val = data.get(key, "")
                if isinstance(val, str) and val.startswith("%") and val.endswith("%"):
                    token = val[1:-1]
                    if token in nls:
                        data[key] = nls[token]
        except Exception:
            pass

    contributes = data.get("contributes", {})

    # Extract language IDs from contributes.languages
    lang_ids = []
    for lang in contributes.get("languages", []):
        lid = lang.get("id")
        if lid:
            lang_ids.append(lid)

    # Extract configuration schema
    cfg = contributes.get("configuration")
    cfg_schema: dict = {}
    if isinstance(cfg, dict):
        cfg_schema = cfg.get("properties", {})
    elif isinstance(cfg, list):
        for block in cfg:
            if isinstance(block, dict):
                cfg_schema.update(block.get("properties", {}))

    # Grammar scopes
    grammar_langs = []
    for g in contributes.get("grammars", []):
        gl = g.get("language")
        if gl:
            grammar_langs.append(gl)

    publisher = data.get("publisher", "vscode")
    name = data.get("name", pkg_path.parent.name)
    ext_id = f"{publisher}.{name}"

    return {
        "id": ext_id,
        "name": name,
        "publisher": publisher,
        "version": data.get("version", "0.0.0"),
        "languages": lang_ids,
        "grammar_languages": grammar_langs,
        "configuration_schema": cfg_schema,
        "display_name": data.get("displayName", name),
        "description": data.get("description", ""),
    }


def _scan_builtin_extensions() -> dict[str, dict]:
    """Scan builtin extensions dir, return {ext_id: entry}."""
    results: dict[str, dict] = {}
    if not _BUILTIN_EXTENSIONS_DIR.is_dir():
        print(f"[ext_registry] builtin dir not found: {_BUILTIN_EXTENSIONS_DIR}", flush=True)
        return results

    for d in sorted(_BUILTIN_EXTENSIONS_DIR.iterdir()):
        pkg = d / "package.json"
        if not pkg.is_file():
            continue
        parsed = _parse_package_json(pkg)
        if not parsed:
            continue

        ext_id = parsed["id"]
        if ext_id in _EXCLUDED_EXTENSION_IDS:
            continue

        # Only keep language-relevant builtins:
        # grammar providers, language-features, or those with languages declared
        has_langs = bool(parsed["languages"])
        has_grammars = bool(parsed["grammar_languages"])
        is_lang_features = d.name.endswith("-language-features")
        has_config_editing = d.name == "configuration-editing"

        if not (has_langs or has_grammars or is_lang_features or has_config_editing):
            continue

        entry = {
            "id": ext_id,
            "name": parsed["name"],
            "version": parsed["version"],
            "source": "builtin",
            "active": True,
            "languages": parsed["languages"],
            "grammar_languages": parsed["grammar_languages"],
            "is_language_features": is_lang_features,
            "display_name": parsed["display_name"],
            "description": parsed["description"],
            "configuration_schema": parsed["configuration_schema"],
            "configuration_values": {},
            "path": str(d),
        }
        results[ext_id] = entry

    return results


def _scan_user_extensions() -> dict[str, dict]:
    """Scan user-installed extensions from extensions.json manifest."""
    results: dict[str, dict] = {}
    manifest_path = _EXTENSIONS_DIR / "extensions.json"
    if not manifest_path.is_file():
        return results

    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
    except Exception:
        print("[ext_registry] failed to parse extensions.json", flush=True)
        return results

    for entry in manifest:
        ext_id = entry.get("identifier", {}).get("id", "")
        if not ext_id:
            continue
        if ext_id in _EXCLUDED_EXTENSION_IDS:
            continue

        location = entry.get("location", {})
        ext_path = location.get("path", "") if isinstance(location, dict) else ""
        if not ext_path:
            # Try relativeLocation
            rel = entry.get("relativeLocation", "")
            if rel:
                ext_path = str(_EXTENSIONS_DIR / rel)

        pkg = Path(ext_path) / "package.json" if ext_path else None
        parsed = _parse_package_json(pkg) if pkg and pkg.is_file() else None

        result_entry = {
            "id": ext_id,
            "name": parsed["name"] if parsed else ext_id.split(".")[-1],
            "version": entry.get("version", "0.0.0"),
            "source": "user",
            "active": True,
            "languages": parsed["languages"] if parsed else [],
            "grammar_languages": parsed["grammar_languages"] if parsed else [],
            "is_language_features": False,
            "display_name": parsed["display_name"] if parsed else ext_id,
            "description": parsed["description"] if parsed else "",
            "configuration_schema": parsed["configuration_schema"] if parsed else {},
            "configuration_values": {},
            "path": ext_path,
        }
        results[ext_id] = result_entry

    return results


# ── Language slot mapping ─────────────────────────────────────────────

def _build_language_slots(extensions: dict[str, dict]) -> dict[str, dict]:
    """Build language_slots from scanned extensions.

    A language slot is filled by the most specific extension providing
    intelligence for that language. Priority:
      1. User-installed extension declaring the language
      2. Builtin *-language-features extension
      3. Builtin grammar extension (syntax only, no intelligence)
    """
    slots: dict[str, dict] = {}

    # Pass 1: builtin grammar extensions (lowest priority)
    for ext_id, ext in extensions.items():
        if ext["source"] != "builtin":
            continue
        if ext["is_language_features"]:
            continue
        for lang in ext.get("languages", []) + ext.get("grammar_languages", []):
            if lang not in slots:
                slots[lang] = {
                    "extension": ext_id,
                    "active": ext["active"],
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
        if ext["source"] != "builtin" or not ext["is_language_features"]:
            continue

        served_langs = _LANG_FEATURES_MAP.get(ext["name"])
        if served_langs is None:
            # Fallback: derive from companion grammar extension name
            companion_name = ext["name"].replace("-language-features", "")
            served_langs = set()
            for eid, edata in extensions.items():
                if edata["source"] == "builtin" and edata["name"] == companion_name:
                    served_langs.update(edata.get("languages", []))
                    served_langs.update(edata.get("grammar_languages", []))
                    break

        for lang in served_langs:
            slots[lang] = {
                "extension": ext_id,
                "active": ext["active"],
                "source": "builtin",
                "provides": "language-features",
            }

    # Pass 3: user-installed extensions (highest priority)
    for ext_id, ext in extensions.items():
        if ext["source"] != "user":
            continue
        for lang in ext.get("languages", []) + ext.get("grammar_languages", []):
            slots[lang] = {
                "extension": ext_id,
                "active": ext["active"],
                "source": "user",
                "provides": "language-features",
            }

    return slots


# ── Registry persistence ─────────────────────────────────────────────

def _empty_registry() -> dict:
    return {
        "version": 1,
        "updated_at": 0,
        "extensions": {},
        "language_slots": {},
    }


def load_registry() -> dict:
    """Load persisted registry, or return empty."""
    if _REGISTRY_PATH.is_file():
        try:
            data = json.loads(_REGISTRY_PATH.read_text("utf-8"))
            if isinstance(data, dict) and "extensions" in data:
                return data
        except Exception:
            pass
    return _empty_registry()


def save_registry(registry: dict) -> None:
    """Persist registry to disk."""
    registry["updated_at"] = int(time.time() * 1000)
    _REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY_PATH.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    print(f"[ext_registry] registry saved: {len(registry.get('extensions', {}))} extensions, "
          f"{len(registry.get('language_slots', {}))} slots", flush=True)


# ── Full scan + rebuild ───────────────────────────────────────────────

def scan_and_rebuild() -> dict:
    """Full scan of builtin + user extensions → rebuild registry + language slots.

    Preserves user configuration_values and active toggles from the
    existing registry when an extension is still installed.
    """
    old_registry = load_registry()
    old_exts = old_registry.get("extensions", {})
    old_slots = old_registry.get("language_slots", {})

    # Scan
    builtins = _scan_builtin_extensions()
    user_exts = _scan_user_extensions()

    # Merge: user extensions override builtins with same ID
    all_exts = {**builtins, **user_exts}

    # Preserve user config values and active toggles from previous registry
    for ext_id, ext in all_exts.items():
        if ext_id in old_exts:
            old = old_exts[ext_id]
            ext["configuration_values"] = old.get("configuration_values", {})
            ext["active"] = old.get("active", True)

    # Build slots
    slots = _build_language_slots(all_exts)

    # Preserve active toggles from old slots
    for lang, slot in slots.items():
        if lang in old_slots:
            slot["active"] = old_slots[lang].get("active", True)

    registry = {
        "version": 1,
        "updated_at": 0,
        "extensions": all_exts,
        "language_slots": slots,
    }

    save_registry(registry)
    return registry


# ── Settings gate generation ──────────────────────────────────────────

def rebuild_settings_gate(registry: Optional[dict] = None) -> dict:
    """Generate and write the settings.json gate from registry state.

    Merges our managed keys with any existing non-managed keys
    (e.g. files.watcherExclude set by watcher sync).

    Returns the final settings dict.
    """
    if registry is None:
        registry = load_registry()

    # Load existing settings to preserve non-managed keys
    existing: dict = {}
    if _USER_SETTINGS_PATH.is_file():
        try:
            existing = json.loads(_USER_SETTINGS_PATH.read_text("utf-8"))
        except Exception:
            existing = {}

    # Remove old managed keys and old per-language overrides
    cleaned: dict = {}
    for key, val in existing.items():
        if key in _MANAGED_GLOBAL_KEYS:
            continue
        if key.startswith("[") and key.endswith("]"):
            # Only remove language overrides we'd regenerate
            continue
        cleaned[key] = val

    # Apply global gate
    settings = {**cleaned, **_GLOBAL_GATE}

    # Apply per-language overrides for active slots
    slots = registry.get("language_slots", {})
    extensions = registry.get("extensions", {})

    for lang_id, slot in slots.items():
        if not slot.get("active", True):
            continue
        # Only create overrides for language-features providers
        if slot.get("provides") != "language-features":
            continue

        lang_key = f"[{lang_id}]"
        overrides = dict(_LANGUAGE_SLOT_OVERRIDES)

        # Merge extension-specific configuration values
        ext_id = slot.get("extension", "")
        ext = extensions.get(ext_id, {})
        for cfg_key, cfg_val in ext.get("configuration_values", {}).items():
            overrides[cfg_key] = cfg_val

        settings[lang_key] = overrides

    # Write
    _USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _USER_SETTINGS_PATH.write_text(
        json.dumps(settings, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[ext_registry] settings gate written: {sum(1 for k in settings if k.startswith('['))} language overrides", flush=True)
    return settings


# ── Boot integration entry point ──────────────────────────────────────

def ensure_registry_and_gate() -> dict:
    """Called at boot before code-server launch.

    Scans extensions, rebuilds registry, writes settings gate.
    Returns the registry for inspection.
    """
    registry = scan_and_rebuild()
    rebuild_settings_gate(registry)
    return registry


# ── Install / Uninstall ───────────────────────────────────────────────

_CODE_SERVER_BIN = shutil.which("code-server") or "code-server"


def install_extension(vsix_path: str) -> dict:
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

    cmd = [
        _CODE_SERVER_BIN,
        "--install-extension", str(vsix.resolve()),
        "--extensions-dir", str(_EXTENSIONS_DIR),
        "--force",
    ]

    print(f"[ext_registry] installing: {' '.join(cmd)}", flush=True)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"code-server install failed (rc={result.returncode}): {err}")

    print(f"[ext_registry] install stdout: {result.stdout.strip()}", flush=True)

    # Re-scan to pick up the new extension
    registry = scan_and_rebuild()
    rebuild_settings_gate(registry)

    # Try to identify what was just installed by comparing with manifest
    user_exts = _scan_user_extensions()
    # The newest entry is likely the one just installed
    new_ext = None
    for ext_id, ext in user_exts.items():
        if ext_id in registry.get("extensions", {}):
            candidate = registry["extensions"][ext_id]
            if candidate.get("source") == "user":
                new_ext = candidate
                # If the path contains the vsix stem, it's likely the one
                vsix_stem = vsix.stem.lower()
                if vsix_stem in (candidate.get("path", "")).lower():
                    break

    return {
        "ok": True,
        "extension": new_ext,
        "registry_summary": {
            "total_extensions": len(registry.get("extensions", {})),
            "total_slots": len(registry.get("language_slots", {})),
        },
    }


def uninstall_extension(ext_id: str) -> dict:
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
    ext = registry.get("extensions", {}).get(ext_id)
    if not ext:
        raise ValueError(f"Extension not found: {ext_id}")
    if ext.get("source") == "builtin":
        raise ValueError(f"Cannot uninstall builtin extension: {ext_id}. Use toggle instead.")

    cmd = [
        _CODE_SERVER_BIN,
        "--uninstall-extension", ext_id,
        "--extensions-dir", str(_EXTENSIONS_DIR),
    ]

    print(f"[ext_registry] uninstalling: {' '.join(cmd)}", flush=True)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
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
            "total_extensions": len(registry.get("extensions", {})),
            "total_slots": len(registry.get("language_slots", {})),
        },
    }


# ── Query helpers (for socket events / UI) ────────────────────────────

def get_extension_list() -> list[dict]:
    """Return a UI-friendly list of all extensions."""
    registry = load_registry()
    result = []
    for ext_id, ext in registry.get("extensions", {}).items():
        entry = {
            "id": ext_id,
            "display_name": ext.get("display_name", ext_id),
            "version": ext.get("version", "?"),
            "source": ext.get("source", "unknown"),
            "active": ext.get("active", True),
            "languages": ext.get("languages", []) + ext.get("grammar_languages", []),
            "has_config": bool(ext.get("configuration_schema")),
        }
        if entry["has_config"]:
            entry["configuration_values"] = ext.get("configuration_values", {})
        result.append(entry)
    return result


def get_language_slots() -> dict:
    """Return current language slot mapping."""
    registry = load_registry()
    return registry.get("language_slots", {})


def get_extension_config_schema(ext_id: str) -> dict:
    """Return the configuration schema for an extension."""
    registry = load_registry()
    ext = registry.get("extensions", {}).get(ext_id, {})
    return ext.get("configuration_schema", {})


def set_extension_config(ext_id: str, values: dict) -> dict:
    """Update configuration values for an extension and rebuild gate."""
    registry = load_registry()
    ext = registry.get("extensions", {}).get(ext_id)
    if not ext:
        raise ValueError(f"Extension not found: {ext_id}")
    ext["configuration_values"] = values
    save_registry(registry)
    return rebuild_settings_gate(registry)


def toggle_extension(ext_id: str, active: bool) -> dict:
    """Toggle an extension active/inactive and rebuild gate."""
    registry = load_registry()
    ext = registry.get("extensions", {}).get(ext_id)
    if not ext:
        raise ValueError(f"Extension not found: {ext_id}")
    ext["active"] = active

    # Update corresponding language slots
    slots = registry.get("language_slots", {})
    for lang, slot in slots.items():
        if slot.get("extension") == ext_id:
            slot["active"] = active

    save_registry(registry)
    return rebuild_settings_gate(registry)


def toggle_language_slot(lang_id: str, active: bool) -> dict:
    """Toggle a language slot active/inactive and rebuild gate."""
    registry = load_registry()
    slots = registry.get("language_slots", {})
    if lang_id not in slots:
        raise ValueError(f"Language slot not found: {lang_id}")
    slots[lang_id]["active"] = active
    save_registry(registry)
    return rebuild_settings_gate(registry)
