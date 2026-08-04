# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
import fnmatch
import json
from pathlib import Path
import re
from threading import RLock
from typing import Literal, cast
from urllib.parse import urlsplit

# Project-local run profiles are the backend authority for the play button.
# This resolver owns include matches and conflict rejection before any shell
# execution happens.
JsonObject = dict[str, object]
RunnerName = Literal["pagePreview", "node", "python", "custom"]
RunningBehavior = Literal["just save", "relaunch"]
DraftSaveMode = Literal["included", "opened", "all", "none"]

CONFIG_DIR_NAME = ".code_te2"
CONFIG_FILE_NAME = "run_profiles.json"
KNOWN_RUNNERS: frozenset[str] = frozenset({"pagePreview", "node", "python", "custom"})
KNOWN_RUNNING_BEHAVIORS: frozenset[str] = frozenset({"just save", "relaunch"})
KNOWN_DRAFT_SAVE_MODES: frozenset[str] = frozenset(
    {"included", "opened", "all", "none"}
)
DEFAULT_PAGE_PREVIEW_PROFILE_ID = "page-preview"
DEFAULT_PAGE_PREVIEW_URL = "http://127.0.0.1:3000/"
MAX_ADDITIONAL_PORTS = 8
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_config_lock = RLock()


@dataclass(frozen=True)
class RunProfileAdditionalPort:
    port: int
    label: str


@dataclass(frozen=True)
class RunProfile:
    profile_id: str
    runner: RunnerName
    entry: str
    include: tuple[str, ...]
    sidebar_url: str
    running_behavior: RunningBehavior
    exec_command: str
    cwd: str
    args: tuple[str, ...]
    env: dict[str, str]
    save_drafts: DraftSaveMode
    show_save_warning: bool
    dev_tools: bool = False
    port: int | None = None
    additional_ports: tuple[RunProfileAdditionalPort, ...] = ()


@dataclass(frozen=True)
class RunProfileMatch:
    profile: RunProfile
    project_root: Path
    active_file: Path
    relative_path: str


class RunProfileConflictError(ValueError):
    relative_path: str
    profile_ids: list[str]

    def __init__(self, *, relative_path: str, profile_ids: list[str]) -> None:
        super().__init__(
            f"Run profile conflict for {relative_path}: {', '.join(profile_ids)}"
        )
        self.relative_path = relative_path
        self.profile_ids = profile_ids


def run_profiles_config_path(project_root: str | Path) -> Path:
    return _project_root_path(project_root) / CONFIG_DIR_NAME / CONFIG_FILE_NAME


def load_run_profiles(project_root: str | Path) -> list[RunProfile]:
    return _profiles_from_config(load_run_profiles_config(project_root))


def load_run_profiles_config(project_root: str | Path) -> JsonObject:
    config_path = run_profiles_config_path(project_root)
    if not config_path.exists():
        return _empty_config()
    try:
        decoded = cast(object, json.loads(config_path.read_text("utf-8")))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid run profile JSON: {exc}") from exc
    return parse_run_profiles_config(decoded)


def parse_run_profiles_config_json(raw_text: str) -> JsonObject:
    text = raw_text.strip()
    decoded: object = _empty_config() if not text else cast(object, json.loads(text))
    return parse_run_profiles_config(decoded)


def parse_run_profiles_config(decoded: object) -> JsonObject:
    config = _config_object(decoded)
    _ = _profiles_from_config(config)
    return config


def save_run_profiles_config(project_root: str | Path, raw_text: str) -> JsonObject:
    root = _project_root_path(project_root)
    config = parse_run_profiles_config_json(raw_text)
    config_path = run_profiles_config_path(root)
    with _config_lock:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        _write_json(config_path, config)
    return config


def fallback_show_save_warning(project_root: str | Path) -> bool:
    return _fallback_show_save_warning(load_run_profiles_config(project_root))


def set_run_save_warning(
    project_root: str | Path,
    *,
    profile_id: str | None,
    enabled: bool,
) -> JsonObject:
    root = _project_root_path(project_root)
    config_path = run_profiles_config_path(root)
    with _config_lock:
        config = load_run_profiles_config(root)
        if profile_id:
            profiles_obj = config.get("profiles")
            profiles = (
                cast(list[object], profiles_obj)
                if isinstance(profiles_obj, list)
                else []
            )
            updated = False
            for item_obj in profiles:
                if not isinstance(item_obj, dict):
                    continue
                item = cast(dict[object, object], item_obj)
                current_id = _text(item.get("profileId") or item.get("profile_id"))
                if current_id == profile_id:
                    item["showSaveWarning"] = enabled
                    updated = True
                    break
            if not updated:
                raise ValueError(f"Run profile '{profile_id}' no longer exists")
        else:
            fallback_obj = config.get("fallback")
            fallback = (
                _json_object(cast(object, fallback_obj))
                if isinstance(fallback_obj, dict)
                else {}
            )
            fallback["showSaveWarning"] = enabled
            config["fallback"] = fallback

        config = parse_run_profiles_config(config)
        config_path.parent.mkdir(parents=True, exist_ok=True)
        _write_json(config_path, config)
        return config


def _profiles_from_config(config: JsonObject) -> list[RunProfile]:
    profiles_value = config.get("profiles", [])
    if not isinstance(profiles_value, list):
        raise ValueError("Run profile config field 'profiles' must be a list")
    raw_profiles = list(cast(list[object], profiles_value))
    profiles: list[RunProfile] = []
    profile_ids: set[str] = set()
    for index, item_obj in enumerate(raw_profiles):
        if not isinstance(item_obj, dict):
            raise ValueError(f"Run profile at index {index} must be an object")
        profile = _profile_from_json(
            _json_object(cast(object, item_obj)), index=index
        )
        if profile.profile_id in profile_ids:
            raise ValueError(f"Duplicate run profile id '{profile.profile_id}'")
        profile_ids.add(profile.profile_id)
        profiles.append(profile)
    return profiles


def list_run_profile_candidates(
    project_root: str | Path,
    active_file: str | Path,
    *,
    include_all: bool = False,
) -> list[RunProfileMatch]:
    root, file_path, rel_path = _run_profile_context(project_root, active_file)
    return [
        RunProfileMatch(
            profile=profile,
            project_root=root,
            active_file=file_path,
            relative_path=rel_path,
        )
        for profile in load_run_profiles(root)
        if include_all
        or run_profile_matches_path(profile, rel_path, project_root=root)
    ]


def resolve_run_profile_by_id(
    project_root: str | Path,
    active_file: str | Path,
    profile_id: str,
) -> RunProfileMatch:
    selected_id = profile_id.strip()
    if not selected_id:
        raise ValueError("Run profile id is required")
    for match in list_run_profile_candidates(
        project_root,
        active_file,
        include_all=True,
    ):
        if match.profile.profile_id == selected_id:
            return match
    raise ValueError(f"Run profile '{selected_id}' no longer exists")


def match_run_profile(
    project_root: str | Path, active_file: str | Path
) -> RunProfileMatch | None:
    matches = list_run_profile_candidates(project_root, active_file)
    if not matches:
        return None
    if len(matches) > 1:
        raise RunProfileConflictError(
            relative_path=matches[0].relative_path,
            profile_ids=[profile.profile.profile_id for profile in matches],
        )
    return matches[0]


def _run_profile_context(
    project_root: str | Path,
    active_file: str | Path,
) -> tuple[Path, Path, str]:
    root = _project_root_path(project_root)
    file_path = Path(active_file).expanduser().resolve(strict=False)
    try:
        rel_path = _relative_posix(file_path, root)
    except ValueError:
        raise ValueError("Active file is outside the project") from None
    return root, file_path, rel_path


def run_profile_matches_path(
    profile: RunProfile,
    relative_path: str,
    *,
    project_root: str | Path,
) -> bool:
    root = _project_root_path(project_root)
    normalized = _normalize_rel_pattern(relative_path)
    for pattern in profile.include:
        if _matches_pattern(pattern, normalized, root=root):
            return True
    return False


def install_default_page_preview_profile(
    project_root: str | Path,
    *,
    current_file: str | Path | None = None,
) -> JsonObject:
    root = _project_root_path(project_root)
    config_path = run_profiles_config_path(root)
    config_path.parent.mkdir(parents=True, exist_ok=True)

    entry = _default_entry_for(root, current_file)
    profile = _default_page_preview_profile(entry)
    config: JsonObject
    if config_path.exists():
        decoded = cast(object, json.loads(config_path.read_text("utf-8")))
        config = _config_object(decoded)
    else:
        empty_profiles: list[object] = []
        config = {"version": 1, "profiles": empty_profiles}

    profiles_obj = config.get("profiles")
    profiles: list[object] = (
        list(cast(list[object], profiles_obj)) if isinstance(profiles_obj, list) else []
    )
    existing: list[JsonObject] = []
    for item_obj in profiles:
        if not isinstance(item_obj, dict):
            continue
        item = _json_object(cast(object, item_obj))
        profile_id = _text(item.get("profileId") or item.get("profile_id"))
        if profile_id == DEFAULT_PAGE_PREVIEW_PROFILE_ID:
            existing.append(item)
    created = False
    if not existing:
        profiles.append(profile)
        config["profiles"] = profiles
        _write_json(config_path, config)
        created = True

    return {
        "profileId": DEFAULT_PAGE_PREVIEW_PROFILE_ID,
        "profilePath": str(config_path),
        "entry": entry,
        "created": created,
        "updated": created,
    }


def _profile_from_json(data: JsonObject, *, index: int) -> RunProfile:
    profile_id = _text(data.get("profileId") or data.get("profile_id"))
    if not profile_id:
        raise ValueError(f"Run profile at index {index} is missing profileId")

    runner_value = _text(data.get("runner")) or "custom"
    if runner_value not in KNOWN_RUNNERS:
        raise ValueError(f"Run profile {profile_id} has unknown runner '{runner_value}'")
    runner = cast(RunnerName, runner_value)

    entry = _text(data.get("entry"))
    include = _string_tuple(data.get("include"))
    if not include and runner == "pagePreview" and entry:
        include = (entry,)
    if not include:
        raise ValueError(f"Run profile {profile_id} must define include paths")

    running_behavior_value = _text(data.get("runningBehavior") or data.get("running_behavior"))
    if not running_behavior_value:
        running_behavior_value = "just save"
    if running_behavior_value not in KNOWN_RUNNING_BEHAVIORS:
        raise ValueError(
            f"Run profile {profile_id} has unknown runningBehavior '{running_behavior_value}'"
        )

    save_drafts_value = _text(data.get("saveDrafts") or data.get("save_drafts"))
    if not save_drafts_value:
        save_drafts_value = "included"
    if save_drafts_value not in KNOWN_DRAFT_SAVE_MODES:
        raise ValueError(
            f"Run profile {profile_id} has unknown saveDrafts '{save_drafts_value}'"
        )
    show_save_warning = _bool_setting(
        data.get("showSaveWarning", data.get("show_save_warning")),
        default=True,
        field_name=f"Run profile {profile_id} showSaveWarning",
    )
    dev_tools = _bool_setting(
        data.get("devTools"),
        default=False,
        field_name=f"Run profile {profile_id} devTools",
    )

    sidebar_url = _text(data.get("sidebarUrl") or data.get("sidebar_url"))
    if not sidebar_url and runner == "pagePreview":
        sidebar_url = DEFAULT_PAGE_PREVIEW_URL
    port = _optional_port(data.get("port"), profile_id=profile_id)
    additional_ports = _additional_ports(
        data.get("additionalPorts", data.get("additional_ports")),
        profile_id=profile_id,
        primary_port=port,
    )
    _validate_routed_sidebar_url(
        profile_id=profile_id,
        runner=runner,
        sidebar_url=sidebar_url,
        port=port,
        additional_ports=additional_ports,
    )
    exec_command = _text(data.get("exec"))
    if runner != "pagePreview" and not exec_command:
        raise ValueError(f"Run profile {profile_id} must define exec")

    return RunProfile(
        profile_id=profile_id,
        runner=runner,
        entry=entry or ("index.html" if runner == "pagePreview" else ""),
        include=tuple(_normalize_rel_pattern(item) for item in include if item.strip()),
        sidebar_url=sidebar_url,
        running_behavior=cast(RunningBehavior, running_behavior_value),
        exec_command=exec_command,
        cwd=_text(data.get("cwd")),
        args=_string_tuple(data.get("args")),
        env=_env_map(data.get("env"), profile_id=profile_id),
        save_drafts=cast(DraftSaveMode, save_drafts_value),
        show_save_warning=show_save_warning,
        dev_tools=dev_tools,
        port=port,
        additional_ports=additional_ports,
    )


def _is_single_profile_object(data: JsonObject) -> bool:
    return bool(_text(data.get("profileId") or data.get("profile_id")))


def _matches_pattern(pattern: str, rel_path: str, *, root: Path) -> bool:
    clean = _normalize_rel_pattern(pattern)
    if not clean:
        return False
    if any(char in clean for char in "*?[]"):
        return fnmatch.fnmatchcase(rel_path, clean)
    if clean.endswith("/"):
        prefix = clean.rstrip("/")
        return rel_path == prefix or rel_path.startswith(f"{prefix}/")
    candidate = root / clean
    if candidate.exists() and candidate.is_dir():
        return rel_path == clean or rel_path.startswith(f"{clean}/")
    return rel_path == clean


def _default_entry_for(root: Path, current_file: str | Path | None) -> str:
    if current_file is not None:
        candidate = Path(current_file).expanduser().resolve(strict=False)
        try:
            rel = _relative_posix(candidate, root)
        except ValueError:
            rel = ""
        if rel and candidate.suffix.lower() in {".html", ".htm"}:
            return rel
    return "index.html"


def _default_page_preview_profile(entry: str) -> JsonObject:
    include = _unique_strings(
        [
            entry,
            "index.html",
            "*.html",
            "*.htm",
            "*.css",
            "*.scss",
            "*.sass",
            "*.less",
            "*.js",
            "*.mjs",
            "*.ts",
            "*.jsx",
            "*.tsx",
            "*.json",
            "src/**",
            "public/**",
            "assets/**",
        ]
    )
    return {
        "profileId": DEFAULT_PAGE_PREVIEW_PROFILE_ID,
        "runner": "pagePreview",
        "entry": entry,
        "include": include,
        "sidebarUrl": DEFAULT_PAGE_PREVIEW_URL,
        "runningBehavior": "just save",
        "saveDrafts": "included",
        "showSaveWarning": True,
        "devTools": False,
    }


def _config_object(decoded: object) -> JsonObject:
    if isinstance(decoded, dict):
        config = _json_object(cast(object, decoded))
        if _is_single_profile_object(config):
            return {"version": 1, "profiles": [config]}
        profiles_obj = config.get("profiles")
        if profiles_obj is None:
            config["profiles"] = []
        elif not isinstance(profiles_obj, list):
            raise ValueError("Run profile config field 'profiles' must be a list")
        _ = _fallback_show_save_warning(config)
        return config
    if isinstance(decoded, list):
        decoded_profiles: list[object] = list(cast(list[object], decoded))
        config: JsonObject = {"version": 1, "profiles": decoded_profiles}
        return config
    raise ValueError("Run profile config must be an object or profile list")


def _empty_config() -> JsonObject:
    empty_profiles: list[object] = []
    return {"version": 1, "profiles": empty_profiles}


def _write_json(path: Path, data: JsonObject) -> None:
    _ = path.write_text(
        json.dumps(data, indent=2, sort_keys=False) + "\n",
        "utf-8",
    )


def _project_root_path(project_root: str | Path) -> Path:
    return Path(project_root).expanduser().resolve(strict=False)


def _relative_posix(path: Path, root: Path) -> str:
    rel = path.resolve(strict=False).relative_to(root.resolve(strict=False))
    value = rel.as_posix()
    return value or "."


def _normalize_rel_pattern(value: str) -> str:
    text = value.strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text.lstrip("/")


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items() if isinstance(key, str)}


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _bool_setting(value: object, *, default: bool, field_name: str) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    raise ValueError(f"{field_name} must be true, false, 1, or 0")


def _optional_port(value: object, *, profile_id: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"Run profile {profile_id} port must be an integer")
    try:
        port = int(value) if isinstance(value, (int, str)) else 0
    except ValueError:
        port = 0
    if port < 1 or port > 65535:
        raise ValueError(f"Run profile {profile_id} port must be between 1 and 65535")
    return port


def _additional_ports(
    value: object,
    *,
    profile_id: str,
    primary_port: int | None,
) -> tuple[RunProfileAdditionalPort, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise ValueError(f"Run profile {profile_id} additionalPorts must be a list")
    raw_items = cast(list[object], value)
    if len(raw_items) > MAX_ADDITIONAL_PORTS:
        raise ValueError(
            f"Run profile {profile_id} additionalPorts supports at most "
            f"{MAX_ADDITIONAL_PORTS} entries"
        )
    if raw_items and primary_port is None:
        raise ValueError(
            f"Run profile {profile_id} additionalPorts requires a primary port"
        )

    seen_ports = {primary_port} if primary_port is not None else set()
    additional: list[RunProfileAdditionalPort] = []
    for index, item_obj in enumerate(raw_items):
        item = _json_object(item_obj)
        if not item:
            raise ValueError(
                f"Run profile {profile_id} additionalPorts entry {index} must be an object"
            )
        port = _optional_port(item.get("port"), profile_id=profile_id)
        if port is None:
            raise ValueError(
                f"Run profile {profile_id} additionalPorts entry {index} requires port"
            )
        label = _text(item.get("label"))
        if not label:
            raise ValueError(
                f"Run profile {profile_id} additionalPorts entry {index} requires label"
            )
        if port in seen_ports:
            raise ValueError(
                f"Run profile {profile_id} additionalPorts contains duplicate port {port}"
            )
        seen_ports.add(port)
        additional.append(RunProfileAdditionalPort(port=port, label=label))
    return tuple(additional)


def _validate_routed_sidebar_url(
    *,
    profile_id: str,
    runner: RunnerName,
    sidebar_url: str,
    port: int | None,
    additional_ports: tuple[RunProfileAdditionalPort, ...],
) -> None:
    if port is None and not additional_ports:
        return
    if runner == "pagePreview":
        raise ValueError(
            f"Run profile {profile_id} routed ports are not supported for Page Preview"
        )
    if port is None:
        raise ValueError(f"Run profile {profile_id} additionalPorts requires a primary port")
    if not sidebar_url:
        raise ValueError(f"Run profile {profile_id} port requires sidebarUrl")
    try:
        parsed = urlsplit(sidebar_url)
        parsed_port = parsed.port
    except ValueError as exc:
        raise ValueError(f"Run profile {profile_id} sidebarUrl is invalid: {exc}") from exc
    if parsed.scheme.lower() != "http":
        raise ValueError(f"Run profile {profile_id} routed sidebarUrl must use http://")
    if (parsed.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError(f"Run profile {profile_id} routed sidebarUrl must use loopback")
    if parsed.username or parsed.password:
        raise ValueError(f"Run profile {profile_id} routed sidebarUrl cannot include credentials")
    if parsed_port != port:
        raise ValueError(
            f"Run profile {profile_id} sidebarUrl port must match port {port}"
        )


def _fallback_show_save_warning(config: JsonObject) -> bool:
    fallback_obj = config.get("fallback")
    if fallback_obj is None:
        return True
    if not isinstance(fallback_obj, dict):
        raise ValueError("Run profile config field 'fallback' must be an object")
    fallback = _json_object(cast(object, fallback_obj))
    return _bool_setting(
        fallback.get("showSaveWarning"),
        default=True,
        field_name="Run profile fallback showSaveWarning",
    )


def _string_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        return (value,)
    if not isinstance(value, list):
        return ()
    items = cast(list[object], value)
    return tuple(item.strip() for item in items if isinstance(item, str) and item.strip())


def _env_map(value: object, *, profile_id: str) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"Run profile {profile_id} env must be an object")
    raw = cast(dict[object, object], value)
    result: dict[str, str] = {}
    for key, item in raw.items():
        if not isinstance(key, str) or not ENV_NAME_RE.match(key):
            raise ValueError(f"Run profile {profile_id} has invalid env name '{key}'")
        if not isinstance(item, str):
            raise ValueError(f"Run profile {profile_id} env value for '{key}' must be a string")
        if "\x00" in item:
            raise ValueError(f"Run profile {profile_id} env value for '{key}' contains NUL")
        result[key] = item
    return result


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
