# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict, cast

JsonObject = dict[str, object]
WatcherMode = Literal["ipc", "watchexec", "none"]
WatcherStorageType = Literal["ssd", "hdd"]
DEFAULT_WATCH_LIMIT = 524288


@dataclass(frozen=True)
class ExplorerWatcherContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class WatcherRaiseLimitParams(TypedDict):
    limit: int
    password: str


class WatcherSetModeParams(TypedDict):
    mode: WatcherMode
    storage_type: WatcherStorageType
    poll_interval_ms: int


class WatcherGetConfigParams(TypedDict, total=False):
    pass


class WatcherRaiseResultPayload(TypedDict):
    ok: bool
    code: int
    stdout: str
    stderr: str


class WatcherModeStatusPayload(TypedDict):
    mode: WatcherMode
    storage_type: WatcherStorageType
    poll_interval_ms: int
    active: bool


class WatcherConfigPayload(TypedDict):
    mode: WatcherMode
    storage_type: WatcherStorageType
    poll_interval_ms: int
    watchexec_available: bool


def parse_watcher_raise_limit_params(payload: object) -> WatcherRaiseLimitParams:
    envelope = _as_object(payload)
    password_value = envelope.get("password")
    password = password_value if isinstance(password_value, str) else ""
    return {
        "limit": _coerce_int(envelope.get("limit"), default=DEFAULT_WATCH_LIMIT),
        "password": password,
    }


def parse_watcher_set_mode_params(payload: object) -> WatcherSetModeParams:
    envelope = _as_object(payload)
    mode = _parse_watcher_mode(envelope.get("mode"))
    storage_type = _coerce_storage_type(
        envelope.get("storage_type"),
        default="ssd",
    )
    return {
        "mode": mode,
        "storage_type": storage_type,
        "poll_interval_ms": compute_watcher_poll_interval_ms(storage_type),
    }


def parse_watcher_get_config_params(payload: object) -> WatcherGetConfigParams:
    _as_object(payload)
    return {}


def build_watcher_config_payload(
    watcher_config: object,
    *,
    watchexec_available: bool,
) -> WatcherConfigPayload:
    envelope = _as_object(watcher_config)
    mode = _coerce_watcher_mode(envelope.get("mode"), default="ipc")
    storage_type = _coerce_storage_type(
        envelope.get("storage_type"),
        default="ssd",
    )
    poll_interval_ms = _coerce_positive_int(
        envelope.get("poll_interval_ms"),
        default=compute_watcher_poll_interval_ms(storage_type),
    )
    return {
        "mode": mode,
        "storage_type": storage_type,
        "poll_interval_ms": poll_interval_ms,
        "watchexec_available": watchexec_available,
    }


def compute_watcher_poll_interval_ms(storage_type: WatcherStorageType) -> int:
    return 1500 if storage_type == "ssd" else 4500


def _parse_watcher_mode(value: object) -> WatcherMode:
    if value is None:
        return "ipc"
    if value in ("ipc", "watchexec", "none"):
        return value
    raise ExplorerWatcherContractError(f"Invalid watcher mode: {value}")


def _coerce_watcher_mode(
    value: object,
    *,
    default: WatcherMode,
) -> WatcherMode:
    if value in ("ipc", "watchexec", "none"):
        return value
    return default


def _coerce_storage_type(
    value: object,
    *,
    default: WatcherStorageType,
) -> WatcherStorageType:
    if value in ("ssd", "hdd"):
        return value
    return default


def _coerce_int(value: object, *, default: int) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return default
    return default


def _coerce_positive_int(value: object, *, default: int) -> int:
    coerced = _coerce_int(value, default=default)
    if coerced <= 0:
        return default
    return coerced


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
