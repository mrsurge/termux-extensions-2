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
import re
import shlex
import shutil
import subprocess
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TypeAlias, cast

JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
ExtensionEntry: TypeAlias = dict[str, object]
ExtensionMap: TypeAlias = dict[str, ExtensionEntry]
LanguageSlot: TypeAlias = dict[str, object]
LanguageSlotMap: TypeAlias = dict[str, LanguageSlot]
Registry: TypeAlias = dict[str, object]

# ── Paths ─────────────────────────────────────────────────────────────

_CODE_SERVER_DATA_DIR = Path.home() / ".config" / "code-server"
_EXTENSIONS_DIR = _CODE_SERVER_DATA_DIR / "extensions"
_USER_SETTINGS_PATH = _CODE_SERVER_DATA_DIR / "User" / "settings.json"
_REGISTRY_PATH = _CODE_SERVER_DATA_DIR / "te2_extension_registry.json"
_RPC_CONFIG_PATH = _CODE_SERVER_DATA_DIR / "te2_rpc_config.json"


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

@dataclass(frozen=True)
class CodeServerInstallation:
    executable: Path
    vscode_root: Path | None
    source: str


def _path_is_executable(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def _node_version_key(path: Path) -> tuple[int, ...]:
    matches = cast(list[str], re.findall(r"\d+", path.name))
    values = tuple(int(value) for value in matches)
    return values or (0,)


def _nvm_code_server_candidates() -> list[Path]:
    candidates: list[Path] = []
    nvm_bin = os.environ.get("NVM_BIN", "").strip()
    if nvm_bin:
        candidates.append(Path(nvm_bin).expanduser() / "code-server")

    roots: list[Path] = []
    configured_root = os.environ.get("NVM_DIR", "").strip()
    if configured_root:
        roots.append(Path(configured_root).expanduser())
    default_root = Path.home() / ".nvm"
    if default_root not in roots:
        roots.append(default_root)

    for root in roots:
        version_bins = sorted(
            (root / "versions" / "node").glob("*/bin/code-server"),
            key=lambda path: _node_version_key(path.parent.parent),
            reverse=True,
        )
        alias_path = root / "alias" / "default"
        alias = ""
        try:
            alias = alias_path.read_text(encoding="utf-8").strip().lstrip("v")
        except OSError:
            pass
        if alias and alias[0].isdigit():
            preferred = [
                path
                for path in version_bins
                if path.parent.parent.name.lstrip("v") == alias
                or path.parent.parent.name.lstrip("v").startswith(f"{alias}.")
            ]
            candidates.extend(preferred)
            candidates.extend(path for path in version_bins if path not in preferred)
        else:
            candidates.extend(version_bins)
    return candidates


def _login_shell_code_server() -> Path | None:
    try:
        output = subprocess.check_output(
            ["sh", "-lc", "command -v code-server"],
            text=True,
            timeout=5,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return None
    resolved = output.strip().splitlines()
    return Path(resolved[-1]).expanduser() if resolved else None


def _wrapper_exec_target(launcher: Path) -> Path | None:
    try:
        if launcher.stat().st_size > 256 * 1024:
            return None
        text = launcher.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("exec "):
            continue
        try:
            parts = shlex.split(line)
        except ValueError:
            continue
        if len(parts) < 2:
            continue
        target_text = os.path.expandvars(parts[1])
        if not target_text or target_text.startswith("-"):
            continue
        target = Path(target_text).expanduser()
        if not target.is_absolute():
            target = launcher.parent / target
        if target.exists():
            return target.resolve()
    return None


def _vscode_root_from_anchors(anchors: list[Path]) -> Path | None:
    configured_root = os.environ.get("TE2_CODE_SERVER_ROOT", "").strip()
    roots: list[Path] = []
    if configured_root:
        roots.append(Path(configured_root).expanduser())
    for anchor in anchors:
        current = anchor if anchor.is_dir() else anchor.parent
        roots.extend([current, *list(current.parents)[:8]])
    seen: set[Path] = set()
    for root in roots:
        for candidate in (
            root / "lib" / "vscode",
            root / "vscode",
            root / "lib" / "node_modules" / "code-server" / "lib" / "vscode",
        ):
            normalized = candidate.resolve(strict=False)
            if normalized in seen:
                continue
            seen.add(normalized)
            if (normalized / "extensions").is_dir():
                return normalized
    return None


def _installation_from_executable(executable: Path, source: str) -> CodeServerInstallation | None:
    launcher = executable.expanduser()
    if not launcher.is_absolute():
        launcher = Path.cwd() / launcher
    launcher = Path(os.path.abspath(launcher))
    if not _path_is_executable(launcher):
        return None
    anchors = [launcher, launcher.resolve(strict=False)]
    wrapper_target = _wrapper_exec_target(launcher)
    if wrapper_target is not None:
        anchors.append(wrapper_target)
    return CodeServerInstallation(
        executable=launcher,
        vscode_root=_vscode_root_from_anchors(anchors),
        source=source,
    )


@lru_cache(maxsize=1)
def resolve_code_server_installation() -> CodeServerInstallation | None:
    candidates: list[tuple[Path, str]] = []
    configured_bin = os.environ.get("TE2_CODE_SERVER_BIN", "").strip()
    if configured_bin:
        candidates.append((Path(configured_bin), "TE2_CODE_SERVER_BIN"))
    path_bin = shutil.which("code-server")
    if path_bin:
        candidates.append((Path(path_bin), "PATH"))
    login_bin = _login_shell_code_server()
    if login_bin is not None:
        candidates.append((login_bin, "login-shell"))
    candidates.extend((path, "nvm") for path in _nvm_code_server_candidates())
    prefix = os.environ.get("PREFIX", "").strip()
    if prefix:
        candidates.append((Path(prefix) / "bin" / "code-server", "PREFIX"))
    candidates.append((Path.home() / ".local" / "bin" / "code-server", "user-local"))

    seen: set[Path] = set()
    for candidate, source in candidates:
        normalized = candidate.expanduser().resolve(strict=False)
        if normalized in seen:
            continue
        seen.add(normalized)
        installation = _installation_from_executable(candidate, source)
        if installation is not None:
            return installation
    return None


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
    configured = os.environ.get("TE2_BUILTIN_EXTENSIONS_DIR", "").strip()
    if configured:
        return str(Path(configured).expanduser())
    installation = resolve_code_server_installation()
    if installation is not None and installation.vscode_root is not None:
        return str(installation.vscode_root / "extensions")
    return str(Path.home() / ".local" / "lib" / "code-server" / "lib" / "vscode" / "extensions")

# ── RPC Config (nid auto-discovery) ───────────────────────────────────
#
# The workbench adapter hardcodes ~13 numeric rpcIds (protocol identifiers)
# from VS Code's extHost.protocol.ts.  These shift when VS Code adds/removes
# createProxyIdentifier() calls.  We auto-extract them from the installed
# code-server bundle and cache in te2_rpc_config.json.

_ADAPTER_REQUIRED_NIDS = frozenset({
    "MainThreadOutputService",
    "ExtHostConfiguration",
    "ExtHostDocumentsAndEditors",
    "ExtHostDocuments",
    "ExtHostEditors",
    "ExtHostFileSystemInfo",
    "ExtHostLanguages",
    "ExtHostLanguageFeatures",
    "ExtHostStatusBar",
    "ExtHostExtensionService",
    "ExtHostWorkspace",
    "ExtHostEditorTabs",
    "ExtHostOutputService",
})

_JS_IDENTIFIER = r"[A-Za-z_$][A-Za-z0-9_$]*"


class NidExtractionError(ValueError):
    pass


@dataclass(frozen=True)
class NidExtractionResult:
    nids: dict[str, int]
    strategy: str
    source_path: str


def _find_ext_host_bundle(installation: CodeServerInstallation | None = None) -> str | None:
    """Locate extensionHostProcess.js from the installed code-server."""
    configured = os.environ.get("TE2_EXTENSION_HOST_BUNDLE", "").strip()
    if configured:
        bundle = Path(configured).expanduser()
        return str(bundle) if bundle.is_file() else None
    installation = installation or resolve_code_server_installation()
    if installation is None or installation.vscode_root is None:
        return None
    bundle = (
        installation.vscode_root
        / "out" / "vs" / "workbench" / "api" / "node" / "extensionHostProcess.js"
    )
    return str(bundle) if bundle.is_file() else None


def _find_ext_host_protocol_source(
    installation: CodeServerInstallation | None = None,
) -> str | None:
    configured = os.environ.get("TE2_EXT_HOST_PROTOCOL_SOURCE", "").strip()
    if configured:
        source = Path(configured).expanduser()
        return str(source) if source.is_file() else None
    installation = installation or resolve_code_server_installation()
    if installation is None or installation.vscode_root is None:
        return None
    source = (
        installation.vscode_root
        / "src" / "vs" / "workbench" / "api" / "common" / "extHost.protocol.ts"
    )
    return str(source) if source.is_file() else None


def _get_code_server_version(installation: CodeServerInstallation | None = None) -> JsonObject | None:
    """Run ``code-server --version`` and return version + commit."""
    installation = installation or resolve_code_server_installation()
    if installation is None:
        return None
    try:
        out = subprocess.check_output(
            [str(installation.executable), "--version"],
            text=True,
            timeout=5,
            stderr=subprocess.DEVNULL,
            env=_code_server_subprocess_env(installation),
        )
        # Output may be multi-line or single-line:
        #   "4.109.2\n9184b645...\nwith Code 1.109.2"      (multi-line)
        #   "4.109.2 9184b645... with Code 1.109.2"        (single-line)
        text = out.strip()
        parts = text.split()
        if len(parts) >= 2:
            return {"version": parts[0], "commit": parts[1]}
    except Exception:
        pass
    return None


def _balanced_js_object(content: str, open_brace: int, label: str) -> tuple[str, int]:
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(open_brace, len(content)):
        char = content[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'", "`"}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return content[open_brace + 1:index], index + 1
    raise NidExtractionError(f"{label} object is not balanced")


def _minified_proxy_object(
    content: str,
    *,
    anchor: str,
    label: str,
    start: int = 0,
    expected_factory: str | None = None,
) -> tuple[str, str, int]:
    pattern = re.compile(
        rf"(?P<object>{_JS_IDENTIFIER})\s*=\s*\{{\s*"
        rf"{re.escape(anchor)}\s*:\s*(?P<factory>{_JS_IDENTIFIER})\s*\(\s*"
        rf"(?P<quote>['\"]){re.escape(anchor)}(?P=quote)"
    )
    match = pattern.search(content, pos=start)
    if match is None:
        raise NidExtractionError(f"{label} object anchor {anchor!r} was not found")
    factory = match.group("factory")
    if expected_factory is not None and factory != expected_factory:
        raise NidExtractionError(
            f"{label} factory {factory!r} does not match MainContext factory {expected_factory!r}"
        )
    open_brace = content.find("{", match.start("object"), match.end())
    if open_brace < 0:
        raise NidExtractionError(f"{label} opening brace was not found")
    body, end = _balanced_js_object(content, open_brace, label)
    return body, factory, end


def _minified_proxy_entries(body: str, factory: str, label: str) -> list[str]:
    pattern = re.compile(
        rf"(?P<key>{_JS_IDENTIFIER})\s*:\s*{re.escape(factory)}\s*\(\s*"
        rf"(?P<quote>['\"])(?P<sid>{_JS_IDENTIFIER})(?P=quote)\s*\)"
    )
    entries = [match.group("key") for match in pattern.finditer(body)]
    if not entries:
        raise NidExtractionError(f"{label} contains no proxy identifier entries")
    return entries


def _build_nid_map(main_entries: list[str], ext_entries: list[str]) -> dict[str, int]:
    ordered = [*main_entries, *ext_entries]
    if len(set(ordered)) != len(ordered):
        raise NidExtractionError("proxy identifier objects contain duplicate property keys")
    return {name: index for index, name in enumerate(ordered, start=1)}


def _extract_nids_from_bundle_result(bundle_path: str) -> NidExtractionResult:
    try:
        content = Path(bundle_path).read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        raise NidExtractionError(f"failed to read minified bundle: {exc}") from exc

    main_body, factory, main_end = _minified_proxy_object(
        content,
        anchor="MainThreadAuthentication",
        label="MainContext",
    )
    ext_body, _, _ = _minified_proxy_object(
        content,
        anchor="ExtHostCodeMapper",
        label="ExtHostContext",
        start=main_end,
        expected_factory=factory,
    )
    return NidExtractionResult(
        nids=_build_nid_map(
            _minified_proxy_entries(main_body, factory, "MainContext"),
            _minified_proxy_entries(ext_body, factory, "ExtHostContext"),
        ),
        strategy=f"minified-proxy-objects:{factory}",
        source_path=bundle_path,
    )


def _source_proxy_entries(content: str, object_name: str) -> list[str]:
    declaration = re.search(
        rf"export\s+const\s+{re.escape(object_name)}\s*=\s*\{{",
        content,
    )
    if declaration is None:
        raise NidExtractionError(f"source {object_name} declaration was not found")
    open_brace = content.find("{", declaration.start(), declaration.end())
    body, _ = _balanced_js_object(content, open_brace, f"source {object_name}")
    pattern = re.compile(
        rf"(?m)^\s*(?P<key>{_JS_IDENTIFIER})\s*:\s*createProxyIdentifier"
        rf"(?:<[^\n]*?>)?\s*\(\s*(?P<quote>['\"])(?P<sid>{_JS_IDENTIFIER})"
        rf"(?P=quote)\s*\)"
    )
    entries = [match.group("key") for match in pattern.finditer(body)]
    if not entries:
        raise NidExtractionError(f"source {object_name} contains no proxy identifier entries")
    return entries


def _extract_nids_from_protocol_source_result(source_path: str) -> NidExtractionResult:
    try:
        content = Path(source_path).read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        raise NidExtractionError(f"failed to read protocol source: {exc}") from exc
    return NidExtractionResult(
        nids=_build_nid_map(
            _source_proxy_entries(content, "MainContext"),
            _source_proxy_entries(content, "ExtHostContext"),
        ),
        strategy="extHost.protocol.ts",
        source_path=source_path,
    )


def ensure_rpc_config() -> dict[str, int]:
    """Version-gated rpc-config.json generation.

    Returns the nids dict (from cache or freshly extracted).
    Returns empty dict on failure (adapter falls back to hardcoded defaults).
    """
    installation = resolve_code_server_installation()
    version_info = _get_code_server_version(installation)
    if not version_info:
        print("[rpc-config] code-server not found, skipping", flush=True)
        return {}
    assert installation is not None
    print(
        "[rpc-config] resolved code-server "
        f"source={installation.source} executable={installation.executable} "
        f"vscode_root={installation.vscode_root or 'unresolved'}",
        flush=True,
    )

    # Check existing config
    if _RPC_CONFIG_PATH.exists():
        try:
            existing = _json_object_from_text(_RPC_CONFIG_PATH.read_text()) or {}
            if (
                existing.get("code_server_version") == version_info["version"]
                and existing.get("code_server_commit") == version_info["commit"]
            ):
                nids = {key: int(value) for key, value in _object_dict(existing.get("nids", {})).items() if isinstance(value, int)}
                missing = _ADAPTER_REQUIRED_NIDS - set(nids)
                if 100 <= len(nids) <= 300 and not missing:
                    print(
                        f"[rpc-config] cache hit — {len(nids)} nids (code-server {version_info['version']})",
                        flush=True,
                    )
                    return nids
                print(
                    "[rpc-config] cache is incomplete "
                    f"count={len(nids)} missing={sorted(missing)} — regenerating",
                    flush=True,
                )
            print(
                f"[rpc-config] version mismatch: cached={existing.get('code_server_version')} installed={version_info['version']} — regenerating",
                flush=True,
            )
        except Exception:
            print("[rpc-config] corrupt config file, regenerating", flush=True)

    extraction: NidExtractionResult | None = None
    extraction_errors: list[str] = []

    # Prefer the exact installed bundle used by the extension host.
    bundle = _find_ext_host_bundle(installation)
    if bundle:
        print(f"[rpc-config] parsing nids from {bundle}", flush=True)
        try:
            extraction = _extract_nids_from_bundle_result(bundle)
        except NidExtractionError as exc:
            extraction_errors.append(f"bundle: {exc}")
    else:
        print(
            "[rpc-config] extensionHostProcess.js not found for "
            f"{installation.executable}",
            flush=True,
        )

    # Some source/package layouts also ship extHost.protocol.ts. Use it as a
    # fallback and cross-check the minified order when both forms are present.
    protocol_source = _find_ext_host_protocol_source(installation)
    source_extraction: NidExtractionResult | None = None
    if protocol_source:
        try:
            source_extraction = _extract_nids_from_protocol_source_result(protocol_source)
        except NidExtractionError as exc:
            extraction_errors.append(f"source: {exc}")
    if extraction is None and source_extraction is not None:
        extraction = source_extraction
        print(f"[rpc-config] using protocol source fallback {protocol_source}", flush=True)
    elif extraction is not None and source_extraction is not None:
        if extraction.nids != source_extraction.nids:
            print(
                "[rpc-config] ABORT — minified bundle nid order disagrees with "
                f"protocol source {protocol_source}",
                flush=True,
            )
            return _load_stale_nids()

    if extraction is None:
        detail = "; ".join(extraction_errors) or "no bundle or protocol source was parseable"
        print(f"[rpc-config] extraction failed — {detail}", flush=True)
        return {}
    nids = extraction.nids
    print(
        f"[rpc-config] extracted {len(nids)} nids "
        f"strategy={extraction.strategy} source={extraction.source_path}",
        flush=True,
    )

    # Validate: all 13 adapter-required names must be present
    missing = _ADAPTER_REQUIRED_NIDS - set(nids.keys())
    if missing:
        print(f"[rpc-config] ABORT — missing required nids: {missing}", flush=True)
        return _load_stale_nids()

    # Validate: entry count in reasonable range
    count = len(nids)
    if not (100 <= count <= 300):
        print(f"[rpc-config] ABORT — suspicious entry count {count} (expected 100-300)", flush=True)
        return _load_stale_nids()

    # Write config
    config = {
        "code_server_version": version_info["version"],
        "code_server_commit": version_info["commit"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "extraction_strategy": extraction.strategy,
        "extraction_source": extraction.source_path,
        "nids": nids,
    }
    try:
        _RPC_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        _RPC_CONFIG_PATH.write_text(json.dumps(config, indent=2))
        print(
            f"[rpc-config] wrote {count} nids → {_RPC_CONFIG_PATH} (code-server {version_info['version']})",
            flush=True,
        )
    except Exception as exc:
        print(f"[rpc-config] failed to write config: {exc}", flush=True)

    return nids


def _load_stale_nids() -> dict[str, int]:
    """Try to return nids from an existing (possibly stale) config file."""
    if _RPC_CONFIG_PATH.exists():
        try:
            existing = _json_object_from_text(_RPC_CONFIG_PATH.read_text()) or {}
            return {key: int(value) for key, value in _object_dict(existing.get("nids", {})).items() if isinstance(value, int)}
        except Exception:
            pass
    return {}

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
            "configuration_values": {},
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
            "configuration_values": {},
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
        "version": 1,
        "updated_at": 0,
        "extensions": {},
        "language_slots": {},
    }


def load_registry() -> Registry:
    """Load persisted registry, or return empty."""
    if _REGISTRY_PATH.is_file():
        try:
            data = _json_object_from_text(_REGISTRY_PATH.read_text("utf-8"))
            if isinstance(data, dict) and "extensions" in data:
                return dict(data)
        except Exception:
            pass
    return _empty_registry()


def save_registry(registry: Registry) -> None:
    """Persist registry to disk."""
    registry["updated_at"] = int(time.time() * 1000)
    _REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY_PATH.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    print(
        f"[ext_registry] registry saved: {_registry_extension_count(registry)} extensions, "
        f"{_registry_slot_count(registry)} slots",
        flush=True,
    )


# ── Full scan + rebuild ───────────────────────────────────────────────

def scan_and_rebuild() -> Registry:
    """Full scan of builtin + user extensions → rebuild registry + language slots.

    Preserves user configuration_values and active toggles from the
    existing registry when an extension is still installed.
    """
    old_registry = load_registry()
    old_exts = _extension_map(old_registry.get("extensions", {}))
    old_slots = _slot_map(old_registry.get("language_slots", {}))

    # Scan
    builtins = _scan_builtin_extensions()
    user_exts = _scan_user_extensions()

    # Merge: user extensions override builtins with same ID
    all_exts = {**builtins, **user_exts}

    # Preserve user config values and active toggles from previous registry
    for ext_id, ext in all_exts.items():
        if ext_id in old_exts:
            old = old_exts[ext_id]
            ext["configuration_values"] = _entry_object_dict(old, "configuration_values")
            ext["active"] = _entry_bool(old, "active", True)

    # Build slots
    slots = _build_language_slots(all_exts)

    # Preserve active toggles from old slots
    for lang, slot in slots.items():
        if lang in old_slots:
            slot["active"] = _entry_bool(old_slots[lang], "active", True)

    # Preserve custom_settings from old registry
    custom = _object_dict(old_registry.get("custom_settings", {}))

    registry: Registry = {
        "version": 1,
        "updated_at": 0,
        "extensions": all_exts,
        "language_slots": slots,
        "custom_settings": custom,
    }

    save_registry(registry)
    return registry


# ── Custom settings (user-defined JSON overrides) ─────────────────────

def get_custom_settings() -> dict[str, object]:
    """Return user-defined custom settings dict."""
    registry = load_registry()
    return _object_dict(registry.get("custom_settings", {}))


def set_custom_settings(settings: dict[str, object]) -> None:
    """Persist user-defined custom settings and rebuild the gate."""
    registry = load_registry()
    registry["custom_settings"] = settings
    save_registry(registry)
    rebuild_settings_gate(registry)
    print(f"[ext_registry] custom settings saved: {len(settings)} keys", flush=True)


# ── Settings gate generation ──────────────────────────────────────────

def rebuild_settings_gate(registry: Registry | None = None) -> dict[str, object]:
    """Generate and write the settings.json gate from registry state.

    Merges our managed keys with any existing non-managed keys
    (e.g. files.watcherExclude set by watcher sync).

    Returns the final settings dict.
    """
    if registry is None:
        registry = load_registry()

    # Load existing settings to preserve non-managed keys
    existing: dict[str, object] = {}
    if _USER_SETTINGS_PATH.is_file():
        try:
            existing = _object_dict(_json_object_from_text(_USER_SETTINGS_PATH.read_text("utf-8")) or {})
        except Exception:
            existing = {}

    # Remove old managed keys and old per-language overrides
    cleaned: dict[str, object] = {}
    for key, val in existing.items():
        if key in _MANAGED_GLOBAL_KEYS:
            continue
        if key.startswith("[") and key.endswith("]"):
            # Only remove language overrides we'd regenerate
            continue
        cleaned[key] = val

    # Apply global gate
    settings: dict[str, object] = {**cleaned, **_GLOBAL_GATE}

    # Apply per-language overrides for active slots
    slots = _slot_map(registry.get("language_slots", {}))
    extensions = _extension_map(registry.get("extensions", {}))
    ext_managed_keys: set[str] = set()  # keys written by extension config UI

    for lang_id, slot in slots.items():
        if not _entry_bool(slot, "active", True):
            continue
        # Only create overrides for language-features providers
        if _entry_string(slot, "provides") != "language-features":
            continue

        lang_key = f"[{lang_id}]"
        overrides = dict(_LANGUAGE_SLOT_OVERRIDES)

        # Merge extension-specific configuration values
        # editor.* keys go into the language override; extension-namespaced
        # keys (e.g. basedpyright.*, python.*) go top-level.
        ext_id = _entry_string(slot, "extension")
        ext = extensions.get(ext_id, {})
        for cfg_key, cfg_val in _entry_object_dict(ext, "configuration_values").items():
            ext_managed_keys.add(cfg_key)
            if cfg_key.startswith("editor."):
                overrides[cfg_key] = cfg_val
            else:
                settings[cfg_key] = cfg_val

        settings[lang_key] = overrides

    # Merge custom user settings — skip keys already managed by the
    # extension config UI so that per-extension settings always win.
    custom = _object_dict(registry.get("custom_settings", {}))
    for k, v in custom.items():
        if k not in ext_managed_keys:
            settings[k] = v

    # Write
    _USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _USER_SETTINGS_PATH.write_text(
        json.dumps(settings, indent=2) + "\n", encoding="utf-8"
    )
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
            "code-server executable was not found in TE2_CODE_SERVER_BIN, PATH, "
            "the login shell, NVM, PREFIX, or ~/.local/bin"
        )
    return installation


def install_extension(vsix_path: str) -> dict[str, object]:
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

    installation = _require_code_server_installation()
    cmd = [
        str(installation.executable),
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
        env=_code_server_subprocess_env(installation),
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
    registry_exts = _extension_map(registry.get("extensions", {}))
    for ext_id in user_exts:
        if ext_id in registry_exts:
            candidate = registry_exts[ext_id]
            if _entry_string(candidate, "source") == "user":
                new_ext = candidate
                # If the path contains the vsix stem, it's likely the one
                vsix_stem = vsix.stem.lower()
                if vsix_stem in _entry_string(candidate, "path").lower():
                    break

    return {
        "ok": True,
        "extension": new_ext,
        "registry_summary": {
            "total_extensions": _registry_extension_count(registry),
            "total_slots": _registry_slot_count(registry),
        },
    }


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
            entry["configuration_values"] = _entry_object_dict(ext, "configuration_values")
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
    """Update configuration values for an extension and rebuild gate."""
    registry = load_registry()
    ext = _extension_map(registry.get("extensions", {})).get(ext_id)
    if not ext:
        raise ValueError(f"Extension not found: {ext_id}")
    ext["configuration_values"] = values
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
