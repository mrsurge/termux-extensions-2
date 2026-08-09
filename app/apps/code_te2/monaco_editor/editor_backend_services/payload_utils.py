# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from .contracts import JsonMap, ReadonlyJsonMap


def as_payload_dict(data: object) -> JsonMap:
    if not isinstance(data, dict):
        return {}
    typed_data = cast(dict[object, object], data)
    out: JsonMap = {}
    for raw_key, raw_value in typed_data.items():
        if isinstance(raw_key, str):
            out[raw_key] = raw_value
    return out


def get_str(payload: ReadonlyJsonMap, key: str, default: str = "") -> str:
    value = payload.get(key, default)
    return value if isinstance(value, str) else default


def get_opt_str(payload: ReadonlyJsonMap, key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None


def get_int(payload: ReadonlyJsonMap, key: str, default: int) -> int:
    value = payload.get(key, default)
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return default


def get_opt_int(payload: ReadonlyJsonMap, key: str) -> int | None:
    value = payload.get(key)
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def get_bool(payload: Mapping[str, object], key: str, default: bool = False) -> bool:
    value = payload.get(key, default)
    if isinstance(value, bool):
        return value
    return default
