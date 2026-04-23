# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ExplorerPrefsContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class ExplorerPrefsUpdateUiParams(TypedDict):
    key: str
    value: object


class ExplorerPrefsVendorAgentIconParams(TypedDict):
    abs_path: str


def parse_update_ui_params(payload: object) -> ExplorerPrefsUpdateUiParams:
    envelope = _as_object(payload)
    key = _require_string(
        envelope.get("key"),
        missing_message="prefs:updateUi requires 'key' (string)",
    ).strip()
    return {"key": key, "value": envelope.get("value")}


def parse_vendor_agent_icon_params(payload: object) -> ExplorerPrefsVendorAgentIconParams:
    envelope = _as_object(payload)
    abs_path = envelope.get("abs_path")
    if not isinstance(abs_path, str) or not abs_path.strip():
        abs_path = envelope.get("path")
    return {
        "abs_path": _require_string(
            abs_path,
            missing_message="prefs:vendorAgentIcon requires abs_path",
        ).strip(),
    }


def _require_string(value: object, *, missing_message: str) -> str:
    if isinstance(value, str) and value:
        return value
    raise ExplorerPrefsContractError(missing_message)


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
