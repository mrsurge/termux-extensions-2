# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
import fnmatch
import json
from pathlib import Path
from typing import Literal, cast

# Project-local run profiles are the backend authority for the play button.
# This resolver owns include matches and conflict rejection before any shell
# execution happens.
JsonObject = dict[str, object]
RunnerName = Literal["pagePreview", "node", "python", "custom"]
RunningBehavior = Literal["just save", "relaunch"]

CONFIG_DIR_NAME = ".code_te2"
CONFIG_FILE_NAME = "run_profiles.json"
KNOWN_RUNNERS: frozenset[str] = frozenset({"pagePreview", "node", "python", "custom"})
KNOWN_RUNNING_BEHAVIORS: frozenset[str] = frozenset({"just save", "relaunch"})
DEFAULT_PAGE_PREVIEW_PROFILE_ID = "page-preview"
DEFAULT_PAGE_PREVIEW_URL = "http://127.0.0.1:3000/"


@dataclass(frozen=True)
class RunProfile:
    profile_id: str
    runner: RunnerName
    entry: str
    include: tuple[str, ...]
    sidebar_url: str
    running_behavior: RunningBehavior
    execpath: str
    args: tuple[str, ...]
    env: dict[str, str]


@dataclass(frozen=True)
class RunProfileMatch:
    profile: RunProfile
    project_root: Path
    active_file: Path
    relative_path: str


class RunProfileConflictError(ValueError):
    def __init__(self, *, relative_path: str, profile_ids: list[str]) -> None:
        super().__init__(
            f"Run profile conflict for {relative_path}: {', '.join(profile_ids)}"
        )
        self.relative_path = relative_path
        self.profile_ids = profile_ids


def run_profiles_config_path(project_root: str | Path) -> Path:
    return _project_root_path(project_root) / CONFIG_DIR_NAME / CONFIG_FILE_NAME


def load_run_profiles(project_root: str | Path) -> list[RunProfile]:
    config_path = run_profiles_config_path(project_root)
    if not config_path.exists():
        return []
    try:
        decoded = cast(object, json.loads(config_path.read_text("utf-8")))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid run profile JSON: {exc}") from exc

    raw_profiles: list[object]
    if isinstance(decoded, list):
        raw_profiles = list(cast(list[object], decoded))
    elif isinstance(decoded, dict):
        config = _json_object(cast(object, decoded))
        if _is_single_profile_object(config):
            raw_profiles = [config]
        else:
            profiles_value = config.get("profiles", [])
            if not isinstance(profiles_value, list):
                raise ValueError("Run profile config field 'profiles' must be a list")
            raw_profiles = list(cast(list[object], profiles_value))
    else:
        raise ValueError("Run profile config must be an object or profile list")

    profiles: list[RunProfile] = []
    for index, item_obj in enumerate(raw_profiles):
        if not isinstance(item_obj, dict):
            raise ValueError(f"Run profile at index {index} must be an object")
        profiles.append(_profile_from_json(_json_object(cast(object, item_obj)), index=index))
    return profiles


def match_run_profile(project_root: str | Path, active_file: str | Path) -> RunProfileMatch | None:
    root = _project_root_path(project_root)
    file_path = Path(active_file).expanduser().resolve(strict=False)
    try:
        rel_path = _relative_posix(file_path, root)
    except ValueError:
        raise ValueError("Active file is outside the project") from None

    matches = [
        profile
        for profile in load_run_profiles(root)
        if _profile_matches(profile, rel_path, root=root)
    ]
    if not matches:
        return None
    if len(matches) > 1:
        raise RunProfileConflictError(
            relative_path=rel_path,
            profile_ids=[profile.profile_id for profile in matches],
        )
    return RunProfileMatch(
        profile=matches[0],
        project_root=root,
        active_file=file_path,
        relative_path=rel_path,
    )


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
    if not include and entry:
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

    return RunProfile(
        profile_id=profile_id,
        runner=runner,
        entry=entry or "index.html",
        include=tuple(_normalize_rel_pattern(item) for item in include if item.strip()),
        sidebar_url=_text(data.get("sidebarUrl") or data.get("sidebar_url"))
        or DEFAULT_PAGE_PREVIEW_URL,
        running_behavior=cast(RunningBehavior, running_behavior_value),
        execpath=_text(data.get("execpath") or data.get("execPath")),
        args=_string_tuple(data.get("args")),
        env=_string_map(data.get("env")),
    )


def _is_single_profile_object(data: JsonObject) -> bool:
    return bool(_text(data.get("profileId") or data.get("profile_id")))


def _profile_matches(profile: RunProfile, rel_path: str, *, root: Path) -> bool:
    normalized = _normalize_rel_pattern(rel_path)
    for pattern in profile.include:
        if _matches_pattern(pattern, normalized, root=root):
            return True
    return False


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
    }


def _config_object(decoded: object) -> JsonObject:
    if isinstance(decoded, dict):
        config = _json_object(cast(object, decoded))
        profiles_obj = config.get("profiles")
        if profiles_obj is None:
            config["profiles"] = []
        elif not isinstance(profiles_obj, list):
            raise ValueError("Run profile config field 'profiles' must be a list")
        return config
    if isinstance(decoded, list):
        decoded_profiles: list[object] = list(cast(list[object], decoded))
        config: JsonObject = {"version": 1, "profiles": decoded_profiles}
        return config
    raise ValueError("Run profile config must be an object or profile list")


def _write_json(path: Path, data: JsonObject) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n", "utf-8")


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


def _string_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        return (value,)
    if not isinstance(value, list):
        return ()
    items = cast(list[object], value)
    return tuple(item.strip() for item in items if isinstance(item, str) and item.strip())


def _string_map(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    result: dict[str, str] = {}
    for key, item in raw.items():
        if isinstance(key, str) and isinstance(item, str):
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
