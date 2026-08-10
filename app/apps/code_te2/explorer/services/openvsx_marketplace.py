# pyright: strict
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast
from urllib.parse import quote, urlsplit

import httpx

JsonObject = dict[str, object]

_OPEN_VSX_API_BASE = "https://open-vsx.org/api"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_REQUEST_TIMEOUT = httpx.Timeout(12.0, connect=5.0)


class OpenVsxMarketplaceError(Exception):
    pass


def _as_object(value: object) -> JsonObject | None:
    if not isinstance(value, dict):
        return None
    raw = cast(dict[object, object], value)
    return {key: item for key, item in raw.items() if isinstance(key, str)}


def _as_list(value: object) -> list[object]:
    return list(cast(list[object], value)) if isinstance(value, list) else []


def _bounded_string(value: object, *, maximum: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    if not normalized:
        return None
    if len(normalized) > maximum:
        return f"{normalized[: maximum - 1].rstrip()}…"
    return normalized


def _string_list(value: object, *, maximum_items: int = 8) -> list[str]:
    result: list[str] = []
    for item in _as_list(value):
        normalized = _bounded_string(item, maximum=64)
        if normalized and normalized not in result:
            result.append(normalized)
        if len(result) >= maximum_items:
            break
    return result


def _safe_external_url(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 2_048:
        return None
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        return None
    return value


def _openvsx_icon_url(
    value: JsonObject,
    *,
    namespace: str,
    name: str,
    version: str,
) -> str | None:
    files = _as_object(value.get("files"))
    if files is None:
        return None
    icon_url = _safe_external_url(files.get("icon"))
    if icon_url is None:
        return None
    try:
        parsed = urlsplit(icon_url)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.hostname != "open-vsx.org"
        or port not in (None, 443)
        or parsed.query
        or parsed.fragment
    ):
        return None
    expected_prefix = (
        f"/api/{quote(namespace, safe='')}/{quote(name, safe='')}/"
        f"{quote(version, safe='')}/file/"
    )
    filename = parsed.path.removeprefix(expected_prefix)
    if (
        not parsed.path.startswith(expected_prefix)
        or not filename
        or "/" in filename
        or not filename.lower().startswith("icon.")
    ):
        return None
    return icon_url


def _finite_number(value: object) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and (
        value != value or value in (float("inf"), float("-inf"))
    ):
        return None
    return value


def _installed_versions(
    installed_extensions: Sequence[Mapping[str, object]],
) -> dict[str, str]:
    versions: dict[str, str] = {}
    for extension in installed_extensions:
        ext_id = extension.get("id")
        version = extension.get("version")
        if isinstance(ext_id, str) and ext_id and isinstance(version, str) and version:
            versions[ext_id.lower()] = version
    return versions


def _normalize_identity(value: JsonObject) -> tuple[str, str, str] | None:
    namespace = _bounded_string(value.get("namespace"), maximum=128)
    name = _bounded_string(value.get("name"), maximum=128)
    if not namespace or not name:
        return None
    return namespace, name, f"{namespace}.{name}"


def _normalize_summary(
    value: JsonObject,
    *,
    installed_versions: Mapping[str, str],
) -> JsonObject | None:
    identity = _normalize_identity(value)
    if identity is None:
        return None
    namespace, name, ext_id = identity
    version = _bounded_string(value.get("version"), maximum=128)
    if not version:
        return None
    display_name = _bounded_string(value.get("displayName"), maximum=256) or ext_id
    result: JsonObject = {
        "id": ext_id,
        "namespace": namespace,
        "name": name,
        "displayName": display_name,
        "version": version,
        "description": _bounded_string(value.get("description"), maximum=320) or "",
        "installedVersion": installed_versions.get(ext_id.lower()),
        "verified": value.get("verified") is True,
        "iconUrl": _openvsx_icon_url(
            value,
            namespace=namespace,
            name=name,
            version=version,
        ),
    }
    download_count = _finite_number(value.get("downloadCount"))
    average_rating = _finite_number(value.get("averageRating"))
    if download_count is not None:
        result["downloadCount"] = download_count
    if average_rating is not None:
        result["averageRating"] = average_rating
    return result


def _normalize_detail(
    value: JsonObject,
    *,
    requested_ext_id: str,
    installed_versions: Mapping[str, str],
) -> JsonObject:
    summary = _normalize_summary(value, installed_versions=installed_versions)
    if summary is None or str(summary["id"]).lower() != requested_ext_id.lower():
        raise OpenVsxMarketplaceError("Open VSX returned invalid extension metadata")

    extension_kinds = [
        kind.lower()
        for kind in _string_list(value.get("extensionKind"))
    ]
    explicit_ui_only = bool(extension_kinds) and set(extension_kinds) <= {"ui"}

    engines = _as_object(value.get("engines")) or {}
    engine = _bounded_string(engines.get("vscode"), maximum=128)
    license_name = _bounded_string(value.get("license"), maximum=128)
    repository = _safe_external_url(value.get("repository"))
    homepage = _safe_external_url(value.get("homepage"))

    summary["description"] = _bounded_string(
        value.get("description"),
        maximum=1_200,
    ) or ""
    summary["extensionKind"] = extension_kinds
    summary["engine"] = engine
    summary["license"] = license_name
    summary["repository"] = repository
    summary["homepage"] = homepage
    summary["installSupported"] = not explicit_ui_only
    summary["unsupportedReason"] = (
        "UI extensions are not currently supported."
        if explicit_ui_only
        else None
    )
    return summary


async def _request_json(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> JsonObject:
    owned_client = client is None
    active_client = client or httpx.AsyncClient(
        timeout=_REQUEST_TIMEOUT,
        headers={
            "Accept": "application/json",
            "User-Agent": "TE2-Code-Explorer/1",
        },
        follow_redirects=False,
    )
    try:
        response = await active_client.get(url)
        _ = response.raise_for_status()
        if len(response.content) > _MAX_RESPONSE_BYTES:
            raise OpenVsxMarketplaceError("Open VSX response was too large")
        try:
            payload = cast(object, response.json())
        except ValueError as exc:
            raise OpenVsxMarketplaceError("Open VSX returned invalid JSON") from exc
        normalized = _as_object(payload)
        if normalized is None:
            raise OpenVsxMarketplaceError("Open VSX returned an invalid response")
        return normalized
    except OpenVsxMarketplaceError:
        raise
    except httpx.TimeoutException as exc:
        raise OpenVsxMarketplaceError("Open VSX request timed out") from exc
    except httpx.HTTPStatusError as exc:
        raise OpenVsxMarketplaceError(
            f"Open VSX request failed with status {exc.response.status_code}"
        ) from exc
    except httpx.RequestError as exc:
        raise OpenVsxMarketplaceError("Open VSX is unavailable") from exc
    finally:
        if owned_client:
            await active_client.aclose()


async def search_openvsx(
    *,
    query: str,
    offset: int,
    size: int,
    installed_extensions: Sequence[Mapping[str, object]],
    client: httpx.AsyncClient | None = None,
) -> JsonObject:
    installed_versions = _installed_versions(installed_extensions)
    encoded_query = quote(query, safe="")
    payload = await _request_json(
        f"{_OPEN_VSX_API_BASE}/-/search?query={encoded_query}&size={size}&offset={offset}",
        client=client,
    )
    items: list[JsonObject] = []
    for raw_item in _as_list(payload.get("extensions")):
        item = _as_object(raw_item)
        if item is None:
            continue
        normalized = _normalize_summary(
            item,
            installed_versions=installed_versions,
        )
        if normalized is not None:
            items.append(normalized)

    raw_total = payload.get("totalSize")
    total = raw_total if isinstance(raw_total, int) and not isinstance(raw_total, bool) else len(items)
    return {
        "query": query,
        "offset": offset,
        "total": max(0, total),
        "items": items,
    }


async def get_openvsx_detail(
    *,
    ext_id: str,
    installed_extensions: Sequence[Mapping[str, object]],
    client: httpx.AsyncClient | None = None,
) -> JsonObject:
    namespace, name = ext_id.split(".", 1)
    payload = await _request_json(
        f"{_OPEN_VSX_API_BASE}/{quote(namespace, safe='')}/{quote(name, safe='')}/latest",
        client=client,
    )
    return {
        "extension": _normalize_detail(
            payload,
            requested_ext_id=ext_id,
            installed_versions=_installed_versions(installed_extensions),
        )
    }
