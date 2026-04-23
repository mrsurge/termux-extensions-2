# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ExplorerExtensionsContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class ExplorerExtensionsNoParams(TypedDict, total=False):
    pass


class ExplorerExtensionInstallParams(TypedDict):
    vsix_path: str


class ExplorerExtensionExtIdParams(TypedDict):
    ext_id: str


class ExplorerExtensionConfigureParams(TypedDict):
    ext_id: str
    values: JsonObject


class ExplorerExtensionSettingsParams(TypedDict):
    settings: JsonObject


class ExplorerExtensionToggleParams(TypedDict, total=False):
    ext_id: str
    lang_id: str
    active: bool


def parse_list_params(payload: object) -> ExplorerExtensionsNoParams:
    _as_object(payload)
    return {}


def parse_install_params(payload: object) -> ExplorerExtensionInstallParams:
    envelope = _as_object(payload)
    return {
        "vsix_path": _require_string(
            envelope.get("vsix_path"),
            missing_message="vsix_path is required",
        ),
    }


def parse_uninstall_params(payload: object) -> ExplorerExtensionExtIdParams:
    envelope = _as_object(payload)
    return {
        "ext_id": _require_string(
            envelope.get("ext_id"),
            missing_message="ext_id is required",
        ),
    }


def parse_configure_params(payload: object) -> ExplorerExtensionConfigureParams:
    envelope = _as_object(payload)
    values_obj = envelope.get("values")
    values = _as_object(values_obj) if values_obj is not None else {}
    if values_obj is not None and not isinstance(values_obj, dict):
        raise ExplorerExtensionsContractError("values must be a JSON object")
    return {
        "ext_id": _require_string(
            envelope.get("ext_id"),
            missing_message="ext_id is required",
        ),
        "values": values,
    }


def parse_custom_settings_get_params(payload: object) -> ExplorerExtensionsNoParams:
    _as_object(payload)
    return {}


def parse_custom_settings_set_params(payload: object) -> ExplorerExtensionSettingsParams:
    return {"settings": _parse_settings_object(payload)}


def parse_workspace_settings_get_params(payload: object) -> ExplorerExtensionsNoParams:
    _as_object(payload)
    return {}


def parse_workspace_settings_set_params(payload: object) -> ExplorerExtensionSettingsParams:
    return {"settings": _parse_settings_object(payload)}


def parse_toggle_params(payload: object) -> ExplorerExtensionToggleParams:
    envelope = _as_object(payload)
    ext_id = _parse_optional_string(envelope.get("ext_id"))
    lang_id = _parse_optional_string(envelope.get("lang_id"))
    if ext_id is None and lang_id is None:
        raise ExplorerExtensionsContractError("ext_id or lang_id is required")

    result: ExplorerExtensionToggleParams = {
        "active": _coerce_bool(envelope.get("active"), default=True),
    }
    if ext_id is not None:
        result["ext_id"] = ext_id
    if lang_id is not None:
        result["lang_id"] = lang_id
    return result


def parse_config_schema_params(payload: object) -> ExplorerExtensionExtIdParams:
    envelope = _as_object(payload)
    return {
        "ext_id": _require_string(
            envelope.get("ext_id"),
            missing_message="ext_id is required",
        ),
    }


def parse_restart_adapter_params(payload: object) -> ExplorerExtensionsNoParams:
    _as_object(payload)
    return {}


def _parse_settings_object(payload: object) -> JsonObject:
    envelope = _as_object(payload)
    settings_obj = envelope.get("settings")
    settings = _as_object(settings_obj) if settings_obj is not None else {}
    if settings_obj is not None and not isinstance(settings_obj, dict):
        raise ExplorerExtensionsContractError("settings must be a JSON object")
    return settings


def _require_string(value: object, *, missing_message: str) -> str:
    if isinstance(value, str) and value:
        return value
    raise ExplorerExtensionsContractError(missing_message)


def _parse_optional_string(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _coerce_bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return default


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
