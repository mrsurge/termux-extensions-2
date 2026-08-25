from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
import stat
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Final, cast


PROVENANCE_SCHEMA_VERSION: Final = 1
PROVENANCE_FILENAME: Final = "provenance.json"
SOURCE_BUILD_MODE: Final = "source-build"
BINARY_RELEASE_MODE: Final = "binary-release"
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")


class ReleaseRuntimeError(RuntimeError):
    """Raised when an installed binary release cannot be trusted or executed."""


def packaged_server_path() -> Path | None:
    """Return the verified wheel-owned server, or ``None`` for source builds."""

    root = Path(__file__).resolve().parent
    manifest = _read_manifest(root / PROVENANCE_FILENAME)
    mode = _required_string(manifest, "distributionMode")
    if mode == SOURCE_BUILD_MODE:
        return None
    if mode != BINARY_RELEASE_MODE:
        raise ReleaseRuntimeError(f"Unsupported TE2 distribution mode: {mode}")

    package_version = _installed_package_version()
    _validate_binary_identity(manifest, package_version=package_version)
    relative_server = Path(_required_string(manifest, "serverRelativePath"))
    if relative_server.is_absolute():
        raise _release_error(package_version, "server path must be relative to the release payload")
    unresolved_candidate = root / relative_server
    if unresolved_candidate.is_symlink():
        raise _release_error(
            package_version,
            f"packaged server may not be a symlink: {unresolved_candidate}",
        )
    candidate = unresolved_candidate.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise _release_error(package_version, "server path escapes the installed release payload") from exc

    expected_digest = _required_string(manifest, "serverSha256").lower()
    if not _SHA256_PATTERN.fullmatch(expected_digest):
        raise _release_error(package_version, "server digest in the release manifest is invalid")
    try:
        candidate_stat = candidate.stat()
    except FileNotFoundError as exc:
        raise _release_error(package_version, f"packaged server is missing: {candidate}") from exc
    if not stat.S_ISREG(candidate_stat.st_mode):
        raise _release_error(package_version, f"packaged server is not a regular file: {candidate}")
    if not os.access(candidate, os.X_OK):
        raise _release_error(package_version, f"packaged server is not executable: {candidate}")

    actual_digest = _sha256_file(candidate)
    if actual_digest != expected_digest:
        raise _release_error(
            package_version,
            f"packaged server digest mismatch: expected {expected_digest}, found {actual_digest}",
        )
    return candidate


def _read_manifest(path: Path) -> Mapping[str, object]:
    try:
        value = cast(object, json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError as exc:
        raise ReleaseRuntimeError(f"TE2 distribution provenance is missing: {path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise ReleaseRuntimeError(f"TE2 distribution provenance is unreadable: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ReleaseRuntimeError("TE2 distribution provenance must be a JSON object")
    manifest = cast(dict[str, object], value)
    schema_version = manifest.get("schemaVersion")
    if schema_version != PROVENANCE_SCHEMA_VERSION:
        raise ReleaseRuntimeError(
            "Unsupported TE2 distribution provenance schema: "
            f"{schema_version!r}"
        )
    return manifest


def _validate_binary_identity(
    manifest: Mapping[str, object],
    *,
    package_version: str,
) -> None:
    manifest_version = _required_string(manifest, "packageVersion")
    if manifest_version != package_version:
        raise _release_error(
            package_version,
            f"release manifest version {manifest_version} does not match installed package",
        )
    if _required_string(manifest, "platform") != "linux" or sys.platform != "linux":
        raise _release_error(package_version, f"binary release does not support {sys.platform}")

    expected_arch = _required_string(manifest, "architecture")
    actual_arch = _normalized_machine(os.uname().machine)
    if expected_arch != actual_arch:
        raise _release_error(
            package_version,
            f"binary release architecture {expected_arch} does not match {actual_arch}",
        )
    if _required_string(manifest, "libc") != "glibc":
        raise _release_error(package_version, "binary release manifest does not declare glibc")

    minimum_glibc = _parse_version(_required_string(manifest, "minimumGlibc"))
    actual_glibc = _glibc_version()
    if actual_glibc < minimum_glibc:
        raise _release_error(
            package_version,
            "binary release requires glibc "
            f"{_format_version(minimum_glibc)} or newer; found {_format_version(actual_glibc)}",
        )

    platform_tag = _required_string(manifest, "platformTag")
    expected_tag = f"manylinux_{minimum_glibc[0]}_{minimum_glibc[1]}_x86_64"
    if platform_tag != expected_tag:
        raise _release_error(
            package_version,
            f"release platform tag {platform_tag!r} does not match {expected_tag!r}",
        )
    _ = _required_string(manifest, "releaseTag")
    commit = _required_string(manifest, "commit")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise _release_error(package_version, "release manifest commit is invalid")


def _installed_package_version() -> str:
    try:
        return importlib.metadata.version("te2")
    except importlib.metadata.PackageNotFoundError as exc:
        raise ReleaseRuntimeError(
            "Binary-release provenance is present, but installed TE2 package metadata is missing"
        ) from exc


def _required_string(manifest: Mapping[str, object], name: str) -> str:
    value = manifest.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ReleaseRuntimeError(f"TE2 distribution provenance field {name!r} is missing or invalid")
    return value.strip()


def _normalized_machine(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"amd64", "x64", "x86_64"}:
        return "x86_64"
    if normalized in {"aarch64", "arm64"}:
        return "aarch64"
    return normalized


def _glibc_version() -> tuple[int, ...]:
    try:
        raw = os.confstr("CS_GNU_LIBC_VERSION")
    except (OSError, ValueError):
        raw = None
    if not raw or not raw.startswith("glibc "):
        raise ReleaseRuntimeError("Unable to determine the target glibc version")
    return _parse_version(raw.removeprefix("glibc "))


def _parse_version(value: str) -> tuple[int, ...]:
    components = value.split(".")
    if not components or any(not component.isdigit() for component in components):
        raise ReleaseRuntimeError(f"Invalid numeric version in TE2 release metadata: {value!r}")
    return tuple(int(component) for component in components)


def _format_version(value: tuple[int, ...]) -> str:
    return ".".join(str(component) for component in value)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _release_error(package_version: str, detail: str) -> ReleaseRuntimeError:
    reinstall = (
        f"{sys.executable} -m pip install --force-reinstall --no-cache-dir "
        f"te2=={package_version}"
    )
    return ReleaseRuntimeError(
        f"TE2 binary release {package_version} is unusable: {detail}. "
        f"Reinstall that exact release with: {reinstall}"
    )
