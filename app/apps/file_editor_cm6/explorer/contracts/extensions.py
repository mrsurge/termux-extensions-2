# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
import re
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


class ExplorerExtensionMarketplaceSearchParams(TypedDict):
    query: str
    offset: int
    size: int


class ExplorerExtensionMarketplaceInstallParams(TypedDict):
    ext_id: str
    version: str


class ExplorerExtensionConfigureParams(TypedDict):
    ext_id: str
    values: JsonObject


class ExplorerExtensionSettingsParams(TypedDict):
    settings: JsonObject


class ExplorerExtensionToggleParams(TypedDict, total=False):
    ext_id: str
    lang_id: str
    active: bool


_EXTENSION_ID_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
)
_EXTENSION_VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$")
_MARKETPLACE_QUERY_MAX_LENGTH = 100
_MARKETPLACE_PAGE_SIZE_DEFAULT = 20
_MARKETPLACE_PAGE_SIZE_MAX = 50
_MARKETPLACE_OFFSET_MAX = 100_000


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
        "ext_id": _parse_extension_id(envelope.get("ext_id")),
    }


def parse_marketplace_search_params(
    payload: object,
) -> ExplorerExtensionMarketplaceSearchParams:
    envelope = _as_object(payload)
    query = _require_string(
        envelope.get("query"),
        missing_message="query is required",
    ).strip()
    if len(query) < 2:
        raise ExplorerExtensionsContractError("query must contain at least 2 characters")
    if len(query) > _MARKETPLACE_QUERY_MAX_LENGTH:
        raise ExplorerExtensionsContractError(
            f"query must not exceed {_MARKETPLACE_QUERY_MAX_LENGTH} characters"
        )
    return {
        "query": query,
        "offset": _parse_bounded_int(
            envelope.get("offset"),
            default=0,
            minimum=0,
            maximum=_MARKETPLACE_OFFSET_MAX,
            field="offset",
        ),
        "size": _parse_bounded_int(
            envelope.get("size"),
            default=_MARKETPLACE_PAGE_SIZE_DEFAULT,
            minimum=1,
            maximum=_MARKETPLACE_PAGE_SIZE_MAX,
            field="size",
        ),
    }


def parse_marketplace_detail_params(
    payload: object,
) -> ExplorerExtensionExtIdParams:
    envelope = _as_object(payload)
    return {"ext_id": _parse_extension_id(envelope.get("ext_id"))}


def parse_marketplace_install_params(
    payload: object,
) -> ExplorerExtensionMarketplaceInstallParams:
    envelope = _as_object(payload)
    raw_version = _require_string(
        envelope.get("version"),
        missing_message="version is required",
    ).strip()
    if not _EXTENSION_VERSION_RE.fullmatch(raw_version):
        raise ExplorerExtensionsContractError("version is invalid")
    return {
        "ext_id": _parse_extension_id(envelope.get("ext_id")),
        "version": raw_version,
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


def _parse_extension_id(value: object) -> str:
    ext_id = _require_string(value, missing_message="ext_id is required").strip()
    if not _EXTENSION_ID_RE.fullmatch(ext_id):
        raise ExplorerExtensionsContractError(
            "ext_id must be a publisher.name extension identifier"
        )
    return ext_id


def _parse_bounded_int(
    value: object,
    *,
    default: int,
    minimum: int,
    maximum: int,
    field: str,
) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ExplorerExtensionsContractError(f"{field} must be an integer")
    if value < minimum or value > maximum:
        raise ExplorerExtensionsContractError(
            f"{field} must be between {minimum} and {maximum}"
        )
    return value


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
