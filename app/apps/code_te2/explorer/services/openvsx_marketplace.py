# pyright: strict
from __future__ import annotations

import hashlib
import platform
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
import re
import tempfile
from typing import cast
from urllib.parse import quote, unquote, urlsplit

import httpx

JsonObject = dict[str, object]

_OPEN_VSX_API_BASE = "https://open-vsx.org/api"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_MAX_VSIX_BYTES = 512 * 1024 * 1024
_REQUEST_TIMEOUT = httpx.Timeout(12.0, connect=5.0)
_DOWNLOAD_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_TARGET_PLATFORMS = {"universal", "linux-x64", "linux-arm64", "linux-armhf",
                     "alpine-x64", "alpine-arm64", "darwin-x64", "darwin-arm64",
                     "win32-x64", "win32-arm64", "win32-ia32", "web"}
_ICON_SUFFIXES = {".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp"}


def _resource_platform(value: object, *, namespace: str, name: str,
                       version: str, suffix: str, allow_cdn: bool = False) -> str | None:
    """Return platform (empty for unqualified) only for an exact resource identity."""
    url = _safe_external_url(value)
    if url is None:
        return None
    try:
        parsed = urlsplit(url)
        if parsed.port not in (None, 443) or parsed.query or parsed.fragment:
            return None
    except ValueError:
        return None
    if parsed.hostname == "open-vsx.org":
        prefix = f"/api/{quote(namespace, safe='')}/{quote(name, safe='')}/"
        marker = "/file/"
    elif allow_cdn and parsed.hostname == "openvsx.eclipsecontent.org":
        prefix = f"/{quote(namespace, safe='')}/{quote(name, safe='')}/"
        marker = "/"
    else:
        return None
    if not parsed.path.startswith(prefix):
        return None
    rest = parsed.path[len(prefix):]
    target = ""
    if not rest.startswith(quote(version, safe='') + marker):
        target, separator, rest = rest.partition("/")
        if not separator or target not in _TARGET_PLATFORMS:
            return None
    version_prefix = quote(version, safe='') + marker
    if not rest.startswith(version_prefix):
        return None
    filename = unquote(rest[len(version_prefix):])
    if not filename or "/" in filename or "\\" in filename or filename in {".", ".."}:
        return None
    if not filename.lower().endswith(suffix):
        return None
    return "" if target == "universal" else target


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
    suffix = Path(urlsplit(icon_url).path).suffix.lower()
    if suffix not in _ICON_SUFFIXES or _resource_platform(icon_url,
            namespace=namespace, name=name, version=version, suffix=suffix) is None:
        return None
    return icon_url


def _openvsx_artifact_url(
    value: object,
    *,
    namespace: str,
    name: str,
    version: str,
    suffix: str,
    target_platform: str | None = None,
) -> str | None:
    target = _resource_platform(value, namespace=namespace, name=name,
                                version=version, suffix=suffix)
    if target is None or (target_platform is not None and target != target_platform):
        return None
    return str(value)


def _trusted_openvsx_response_url(
    value: object,
    *,
    namespace: str,
    name: str,
    version: str,
    suffix: str,
    target_platform: str | None = None,
) -> bool:
    target = _resource_platform(str(value), namespace=namespace, name=name,
                                version=version, suffix=suffix, allow_cdn=True)
    return target is not None and (target_platform is None or target == target_platform)


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
    summary["targetPlatform"] = value.get("targetPlatform") or "universal"
    summary["platformNote"] = (
        "Linux compatibility artifact: bundled native servers may need a Termux-installed replacement."
        if _backend_targets()[0] == "universal" and str(summary["targetPlatform"]).startswith("linux-")
        else None
    )
    summary["engine"] = engine
    summary["license"] = license_name
    summary["repository"] = repository
    summary["homepage"] = homepage
    # Extension-host placement is not a verdict on TE2 API/UI compatibility.
    summary["installSupported"] = True
    summary["unsupportedReason"] = None
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


async def _request_bytes(
    url: str,
    *,
    client: httpx.AsyncClient,
    maximum: int,
    namespace: str,
    name: str,
    version: str,
    suffix: str,
    target_platform: str | None = None,
) -> bytes:
    content = bytearray()
    async with client.stream("GET", url, follow_redirects=True) as response:
        if not _trusted_openvsx_response_url(
            response.url,
            namespace=namespace,
            name=name,
            version=version,
            suffix=suffix,
            target_platform=target_platform,
        ):
            raise OpenVsxMarketplaceError(
                "Open VSX redirected to an untrusted artifact location"
            )
        _ = response.raise_for_status()
        async for chunk in response.aiter_bytes():
            content.extend(chunk)
            if len(content) > maximum:
                raise OpenVsxMarketplaceError(
                    "Open VSX response was too large"
                )
    return bytes(content)


def _backend_targets() -> tuple[str, ...]:
    from ...code_server_bootstrap import _is_termux_android
    arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64",
            "arm64": "arm64", "armv7l": "armhf", "i386": "ia32",
            "i686": "ia32"}.get(platform.machine().lower())
    if _is_termux_android():
        # Explicit Linux compatibility artifact; no Bionic/native-server promise.
        return ("universal", f"linux-{arch}") if arch else ("universal",)
    family = {"linux": "linux", "darwin": "darwin", "win32": "win32"}.get(sys.platform)
    if family == "linux" and platform.libc_ver()[0] == "musl":
        family = "alpine"
    return (f"{family}-{arch}", "universal") if family and arch else ("universal",)


async def _extension_metadata(ext_id: str, version: str | None,
                              client: httpx.AsyncClient | None) -> JsonObject:
    namespace, name = ext_id.split(".", 1)
    base = f"{_OPEN_VSX_API_BASE}/{quote(namespace, safe='')}/{quote(name, safe='')}"
    payload = await _request_json(f"{base}/{quote(version or 'latest', safe='')}", client=client)
    identity = _normalize_identity(payload)
    selected_version = payload.get("version")
    if identity is None or identity[2].lower() != ext_id.lower() or not isinstance(selected_version, str) or (version and selected_version != version):
        raise OpenVsxMarketplaceError("Open VSX returned mismatched extension artifact metadata")
    downloads = _as_object(payload.get("downloads")) or {}
    declared = payload.get("targetPlatform")
    initial_target = declared if isinstance(declared, str) and declared else "universal"
    available = set(downloads) | {initial_target}
    target = next((candidate for candidate in _backend_targets() if candidate in available), None)
    if target is None:
        raise OpenVsxMarketplaceError("Open VSX has no compatible artifact for this backend host")
    if target != initial_target:
        target_segment = "" if target == "universal" else f"/{target}"
        payload = await _request_json(f"{base}{target_segment}/{quote(selected_version, safe='')}", client=client)
        selected_identity = _normalize_identity(payload)
        actual_target = payload.get("targetPlatform") or "universal"
        if selected_identity is None or selected_identity[2].lower() != ext_id.lower() or payload.get("version") != selected_version or actual_target != target:
            raise OpenVsxMarketplaceError("Open VSX returned mismatched platform artifact metadata")
    return payload


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
    include_readme: bool = False,
    version: str | None = None,
) -> JsonObject:
    namespace, name = ext_id.split(".", 1)
    payload = await _extension_metadata(ext_id, version, client)
    detail = _normalize_detail(
            payload,
            requested_ext_id=ext_id,
            installed_versions=_installed_versions(installed_extensions),
        )
    if version and detail["version"] != version:
        raise OpenVsxMarketplaceError("Open VSX returned a different extension version")
    if include_readme:
        files = _as_object(payload.get("files")) or {}
        selected_version = str(detail["version"])
        url = _openvsx_artifact_url(files.get("readme"), namespace=namespace, name=name,
            version=selected_version, suffix=".md")
        detail["readme"] = ""
        if url:
            owned = client is None
            active = client or httpx.AsyncClient(timeout=_REQUEST_TIMEOUT, follow_redirects=False)
            try:
                current = httpx.URL(url)
                body = bytearray()
                for hop in range(4):
                    if not _trusted_openvsx_response_url(current, namespace=namespace, name=name,
                        version=selected_version, suffix=".md"):
                        raise OpenVsxMarketplaceError("Untrusted README location")
                    async with active.stream("GET", current, follow_redirects=False) as response:
                        if response.is_redirect:
                            location = response.headers.get("location")
                            if not location or hop == 3:
                                raise OpenVsxMarketplaceError("Invalid README redirect")
                            current = current.join(location)
                            continue
                        _ = response.raise_for_status()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > 1024 * 1024:
                                raise OpenVsxMarketplaceError("README is too large")
                        break
                detail["readme"] = body.decode("utf-8", errors="replace")
                detail["readmeBaseUrl"] = str(current)
            except httpx.HTTPError as exc:
                raise OpenVsxMarketplaceError("Unable to load Open VSX README") from exc
            finally:
                if owned:
                    await active.aclose()
    return {"extension": detail}


async def download_openvsx_vsix(
    *,
    ext_id: str,
    version: str,
    client: httpx.AsyncClient | None = None,
) -> Path:
    """Download and verify one exact Open VSX artifact into a temporary file."""
    if "." not in ext_id:
        raise OpenVsxMarketplaceError("Extension identifier is invalid")
    namespace, name = ext_id.split(".", 1)
    owned_client = client is None
    active_client = client or httpx.AsyncClient(
        timeout=_DOWNLOAD_TIMEOUT,
        headers={
            "Accept": "application/json",
            "User-Agent": "TE2-Code-Explorer/1",
        },
        follow_redirects=False,
    )
    temp_path: Path | None = None
    try:
        payload = await _extension_metadata(ext_id, version, active_client)
        identity = _normalize_identity(payload)
        payload_version = _bounded_string(payload.get("version"), maximum=128)
        if (
            identity is None
            or identity[2].lower() != ext_id.lower()
            or payload_version != version
        ):
            raise OpenVsxMarketplaceError(
                "Open VSX returned mismatched extension artifact metadata"
            )

        files = _as_object(payload.get("files")) or {}
        declared_target = payload.get("targetPlatform") or "universal"
        resource_target = "" if declared_target == "universal" else str(declared_target)
        download_url = _openvsx_artifact_url(
            files.get("download"),
            namespace=identity[0],
            name=identity[1],
            version=version,
            suffix=".vsix",
            target_platform=resource_target,
        )
        sha256_url = _openvsx_artifact_url(
            files.get("sha256"),
            namespace=identity[0],
            name=identity[1],
            version=version,
            suffix=".sha256",
            target_platform=resource_target,
        )
        if download_url is None or sha256_url is None:
            raise OpenVsxMarketplaceError(
                "Open VSX did not provide a trusted extension artifact"
            )

        digest_content = await _request_bytes(
            sha256_url,
            client=active_client,
            maximum=256,
            namespace=identity[0],
            name=identity[1],
            version=version,
            suffix=".sha256",
            target_platform=resource_target,
        )
        try:
            expected_sha256 = digest_content.decode("ascii").strip().lower()
        except UnicodeDecodeError as exc:
            raise OpenVsxMarketplaceError(
                "Open VSX returned an invalid SHA-256"
            ) from exc
        if not _SHA256_RE.fullmatch(expected_sha256):
            raise OpenVsxMarketplaceError("Open VSX returned an invalid SHA-256")

        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix="te2-openvsx-",
            suffix=".vsix",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            digest = hashlib.sha256()
            size = 0
            async with active_client.stream(
                "GET",
                download_url,
                follow_redirects=True,
            ) as response:
                if not _trusted_openvsx_response_url(
                    response.url,
                    namespace=identity[0],
                    name=identity[1],
                    version=version,
                    suffix=".vsix",
                    target_platform=resource_target,
                ):
                    raise OpenVsxMarketplaceError(
                        "Open VSX redirected to an untrusted artifact location"
                    )
                _ = response.raise_for_status()
                content_length = cast(
                    str | None,
                    response.headers.get("content-length"),
                )
                if content_length is not None:
                    try:
                        declared_size = int(content_length)
                    except ValueError as exc:
                        raise OpenVsxMarketplaceError(
                            "Open VSX returned an invalid extension size"
                        ) from exc
                    if declared_size < 0 or declared_size > _MAX_VSIX_BYTES:
                        raise OpenVsxMarketplaceError(
                            "Open VSX extension artifact was too large"
                        )
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > _MAX_VSIX_BYTES:
                        raise OpenVsxMarketplaceError(
                            "Open VSX extension artifact was too large"
                        )
                    digest.update(chunk)
                    _ = temp_file.write(chunk)

        if digest.hexdigest() != expected_sha256:
            raise OpenVsxMarketplaceError(
                "Open VSX extension artifact failed SHA-256 verification"
            )
        verified_path = temp_path
        temp_path = None
        return verified_path
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
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        if owned_client:
            await active_client.aclose()
