"""Standalone Terminal profile preferences. The system launch is never serialized."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
import threading

import msgspec

from app.te2_paths import resolve_te2_paths

SYSTEM = "system"
_lock = threading.Lock()


class Profile(msgspec.Struct, frozen=True, forbid_unknown_fields=True):
    id: str
    name: str
    executable: str
    args: list[str]
    cwd: str
    enabled: bool = True


class Profiles(msgspec.Struct, frozen=True, forbid_unknown_fields=True):
    revision: int = 0
    default: str = SYSTEM
    profiles: list[Profile] = msgspec.field(default_factory=list)


def _path() -> Path:
    return resolve_te2_paths().config_home / "terminal" / "profiles.json"


def read_profiles() -> Profiles:
    try:
        return msgspec.json.decode(_path().read_bytes(), type=Profiles)
    except FileNotFoundError:
        return Profiles()


def save_profiles(params: dict[str, object]) -> Profiles:
    proposed = msgspec.convert(params, type=Profiles)
    ids = {SYSTEM}
    active = {SYSTEM}
    if len(proposed.profiles) > 100:
        raise ValueError("Too many terminal profiles")
    for p in proposed.profiles:
        if (p.id in ids or not p.id or len(p.id) > 80 or not p.name.strip() or len(p.name) > 120
                or not p.executable.strip() or len(p.executable) > 4096 or len(p.args) > 128
                or any(len(s) > 4096 or "\x00" in s for s in (p.cwd, p.executable, *p.args))):
            raise ValueError("Invalid terminal profile name, executable, or arguments")
        ids.add(p.id)
        if p.enabled:
            active.add(p.id)
    if proposed.default not in active:
        raise ValueError("Default profile must be enabled")
    with _lock:
        current = read_profiles()
        if current.revision != proposed.revision:
            raise ValueError("Profiles changed elsewhere; reopen Profiles")
        updated = Profiles(current.revision + 1, proposed.default, proposed.profiles)
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
            try:
                tmp.write(msgspec.json.encode(updated))
                tmp.flush()
                os.replace(tmp.name, path)
            finally:
                Path(tmp.name).unlink(missing_ok=True)
        return updated


def launch_profile(profile_id: str | None) -> Profile | None:
    if profile_id == SYSTEM:
        return None
    settings = read_profiles()
    selected = settings.default if profile_id is None else profile_id
    if selected == SYSTEM:
        return None
    for profile in settings.profiles:
        if profile.id == selected and profile.enabled:
            return profile
    raise ValueError("Terminal profile was removed or disabled")
