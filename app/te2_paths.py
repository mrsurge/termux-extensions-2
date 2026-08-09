from __future__ import annotations

import os
import stat
import tempfile
from collections.abc import Callable, Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Te2Paths:
    cache_home: Path
    data_home: Path
    config_home: Path
    runtime_home: Path

    def export(self, environ: MutableMapping[str, str]) -> None:
        environ["TE2_CACHE_HOME"] = str(self.cache_home)
        environ["TE2_DATA_HOME"] = str(self.data_home)
        environ["TE2_CONFIG_HOME"] = str(self.config_home)
        environ["TE2_RUNTIME_HOME"] = str(self.runtime_home)


def te2_cache_home(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> Path:
    return _persistent_home(
        environ if environ is not None else os.environ,
        explicit_key="TE2_CACHE_HOME",
        xdg_key="XDG_CACHE_HOME",
        fallback=lambda: _user_home(environ, home) / ".cache",
    )


def te2_data_home(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> Path:
    return _persistent_home(
        environ if environ is not None else os.environ,
        explicit_key="TE2_DATA_HOME",
        xdg_key="XDG_DATA_HOME",
        fallback=lambda: _user_home(environ, home) / ".local" / "share",
    )


def te2_config_home(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> Path:
    return _persistent_home(
        environ if environ is not None else os.environ,
        explicit_key="TE2_CONFIG_HOME",
        xdg_key="XDG_CONFIG_HOME",
        fallback=lambda: _user_home(environ, home) / ".config",
    )


def te2_runtime_home(
    environ: Mapping[str, str] | None = None,
    *,
    uid: int | None = None,
    platform_temp: Path | None = None,
) -> Path:
    source = environ if environ is not None else os.environ
    explicit = _nonempty(source.get("TE2_RUNTIME_HOME"))
    if explicit:
        return _absolute_path(explicit, "TE2_RUNTIME_HOME")

    xdg_runtime = _nonempty(source.get("XDG_RUNTIME_DIR"))
    if xdg_runtime:
        return _absolute_path(xdg_runtime, "XDG_RUNTIME_DIR") / "te2"

    temporary = _nonempty(source.get("TMPDIR"))
    if temporary:
        temporary_root = _absolute_path(temporary, "TMPDIR")
    elif _is_termux(source) and _nonempty(source.get("PREFIX")):
        temporary_root = _absolute_path(str(source["PREFIX"]), "PREFIX") / "tmp"
    else:
        temporary_root = Path(platform_temp or tempfile.gettempdir())
        if not temporary_root.is_absolute():
            raise ValueError(f"platform temporary directory must be absolute: {temporary_root}")

    resolved_uid = uid if uid is not None else _current_uid()
    return temporary_root / f"te2-{resolved_uid}"


def resolve_te2_paths(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
    uid: int | None = None,
    platform_temp: Path | None = None,
) -> Te2Paths:
    source = environ if environ is not None else os.environ
    return Te2Paths(
        cache_home=te2_cache_home(source, home=home),
        data_home=te2_data_home(source, home=home),
        config_home=te2_config_home(source, home=home),
        runtime_home=te2_runtime_home(source, uid=uid, platform_temp=platform_temp),
    )


def ensure_runtime_home(path: Path, *, uid: int | None = None) -> Path:
    if not path.is_absolute():
        raise ValueError(f"TE2 runtime root must be absolute: {path}")
    if path.is_symlink():
        raise RuntimeError(f"TE2 runtime root must not be a symbolic link: {path}")

    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError(f"TE2 runtime root must not be a symbolic link: {path}")

    metadata = path.stat()
    if not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeError(f"TE2 runtime root is not a directory: {path}")

    expected_uid = uid if uid is not None else _current_uid()
    if hasattr(metadata, "st_uid") and metadata.st_uid != expected_uid:
        raise RuntimeError(
            f"TE2 runtime root is owned by uid {metadata.st_uid}, expected {expected_uid}: {path}"
        )

    if stat.S_IMODE(metadata.st_mode) != 0o700:
        path.chmod(0o700)
    return path


def _persistent_home(
    environ: Mapping[str, str],
    *,
    explicit_key: str,
    xdg_key: str,
    fallback: Callable[[], Path],
) -> Path:
    explicit = _nonempty(environ.get(explicit_key))
    if explicit:
        return _absolute_path(explicit, explicit_key)

    xdg_base = _nonempty(environ.get(xdg_key))
    if xdg_base:
        return _absolute_path(xdg_base, xdg_key) / "te2"

    fallback_root = fallback()
    if not fallback_root.is_absolute():
        raise ValueError(f"TE2 fallback root must be absolute: {fallback_root}")
    return fallback_root / "te2"


def _user_home(environ: Mapping[str, str] | None, override: Path | None) -> Path:
    if override is not None:
        home = override
    else:
        source = environ if environ is not None else os.environ
        raw_home = _nonempty(source.get("HOME"))
        home = _absolute_path(raw_home, "HOME") if raw_home else Path.home()
    if not home.is_absolute():
        raise ValueError(f"HOME must be absolute: {home}")
    return home


def _absolute_path(raw: str, key: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError(f"{key} must be an absolute path: {raw!r}")
    return path


def _nonempty(value: str | None) -> str:
    return str(value or "").strip()


def _is_termux(environ: Mapping[str, str]) -> bool:
    prefix = _nonempty(environ.get("PREFIX"))
    return bool(
        _nonempty(environ.get("ANDROID_ROOT"))
        or _nonempty(environ.get("ANDROID_DATA"))
        or "/com.termux/" in prefix
    )


def _current_uid() -> int:
    getuid = getattr(os, "getuid", None)
    if not callable(getuid):
        return 0
    uid = getuid()
    if not isinstance(uid, int):
        raise RuntimeError(f"os.getuid() returned a non-integer value: {uid!r}")
    return uid
