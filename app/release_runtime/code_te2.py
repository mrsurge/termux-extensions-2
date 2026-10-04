"""Portable native Code TE2 artifact-set validation, shared by packaging and launch."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import sysconfig
from typing import cast

from app.release_runtime import ReleaseRuntimeError

MANIFEST = "runtime.json"
_DIGEST = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class CodeTe2Runtime:
    executable: Path
    domain: Path


def python_identity() -> dict[str, object]:
    return {
        "implementation": sys.implementation.name,
        "version": f"{sys.version_info.major}.{sys.version_info.minor}",
        "soabi": str(sysconfig.get_config_var("SOABI") or ""),
        "freeThreaded": bool(sysconfig.get_config_var("Py_GIL_DISABLED")),
        "libpython": str(sysconfig.get_config_var("INSTSONAME")
                         or sysconfig.get_config_var("LDLIBRARY") or ""),
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ReleaseRuntimeError(f"Code TE2 {label} must be an object")
    return cast(dict[str, object], value)


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ReleaseRuntimeError(f"Code TE2 {label} must be a nonempty string")
    return value


def _relative(value: object, label: str) -> Path:
    text = _text(value, label)
    path = Path(text)
    if path.is_absolute() or "\\" in text or any(part in {"", ".", ".."} for part in text.split("/")):
        raise ReleaseRuntimeError(f"Code TE2 {label} must be a safe relative path")
    return path


def _file(root: Path, relative: Path) -> Path:
    candidate = root
    for part in relative.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ReleaseRuntimeError(f"Code TE2 artifact may not contain symlinks: {candidate}")
    if not candidate.is_file():
        raise ReleaseRuntimeError(f"Code TE2 artifact file is missing: {candidate}")
    return candidate


def _json(path: Path) -> dict[str, object]:
    try:
        return _object(cast(object, json.loads(path.read_text(encoding="utf-8"))), str(path))
    except (OSError, ValueError) as exc:
        raise ReleaseRuntimeError(f"Cannot read Code TE2 artifact metadata {path}: {exc}") from exc


def _strings(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ReleaseRuntimeError(f"Code TE2 {label} must be a string list")
    return cast(list[str], value)


def compiled_module_names(manifest: dict[str, object]) -> set[str]:
    """Validate a portable inventory without retaining build-host source paths."""
    if manifest.get("schemaVersion") != 2:
        raise ReleaseRuntimeError("Unsupported portable Code TE2 domain manifest")
    modules = _object(manifest.get("modules"), "domain modules")
    sources = _strings(manifest.get("compiled_sources"), "compiled_sources")
    if not sources or len(set(sources)) != len(sources):
        raise ReleaseRuntimeError("Code TE2 compiled_sources is empty or duplicated")
    for source in sources:
        _relative(source, "compiled source")
    selected: set[str] = set()
    for name, raw_source in modules.items():
        if not re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", name):
            raise ReleaseRuntimeError(f"Invalid Code TE2 module name: {name}")
        source = _relative(raw_source, "module source").as_posix()
        if source in sources:
            selected.add(name)
    if len(selected) != len(sources):
        raise ReleaseRuntimeError("Code TE2 compiled module inventory is inconsistent")
    return selected


def validate_runtime(root: Path, *, package_version: str | None = None) -> CodeTe2Runtime:
    """Verify a complete immutable set before passing paths to a worker shellspec."""
    if root.is_symlink():
        raise ReleaseRuntimeError("Code TE2 runtime root may not be a symlink")
    root = root.resolve()
    manifest = _json(_file(root, Path(MANIFEST)))
    if manifest.get("schemaVersion") != 1 or manifest.get("appId") != "code_te2":
        raise ReleaseRuntimeError("Unsupported Code TE2 runtime manifest")
    if package_version is not None and manifest.get("packageVersion") != package_version:
        raise ReleaseRuntimeError("Code TE2 runtime does not match the installed package version")
    if manifest.get("python") != python_identity():
        raise ReleaseRuntimeError("Code TE2 runtime Python ABI/libpython identity mismatch")
    if manifest.get("platform") != sys.platform or manifest.get("machine") != os.uname().machine:
        raise ReleaseRuntimeError("Code TE2 runtime platform/architecture mismatch")
    if manifest.get("libc") != "glibc":
        raise ReleaseRuntimeError("This Code TE2 runtime resolver currently supports Linux glibc only")
    try:
        libc = os.confstr("CS_GNU_LIBC_VERSION")
    except (OSError, ValueError):
        libc = None
    if not libc or not libc.startswith("glibc "):
        raise ReleaseRuntimeError("Code TE2 runtime requires glibc")
    for key in ("rustFingerprint", "domainFingerprint"):
        if not _DIGEST.fullmatch(_text(manifest.get(key), key)):
            raise ReleaseRuntimeError(f"Invalid Code TE2 {key}")
    files = _object(manifest.get("files"), "file checksums")
    for name, digest in files.items():
        path = _file(root, _relative(name, "artifact file"))
        expected = _text(digest, "file digest")
        if not _DIGEST.fullmatch(expected) or sha256(path) != expected:
            raise ReleaseRuntimeError(f"Code TE2 artifact checksum mismatch: {name}")
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    if any(path.is_symlink() for path in root.rglob("*")) or actual != set(files) | {MANIFEST}:
        raise ReleaseRuntimeError("Code TE2 runtime contains untracked files or symlinks")
    executable_relative = _relative(manifest.get("executable"), "executable")
    domain_relative = _relative(manifest.get("domain"), "domain")
    executable = _file(root, executable_relative)
    if not stat.S_ISREG(executable.stat().st_mode) or not os.access(executable, os.X_OK):
        raise ReleaseRuntimeError("Code TE2 runtime executable is not executable")
    domain = root / domain_relative
    domain_manifest = _json(_file(root, domain_relative / "manifest.json"))
    names = compiled_module_names(domain_manifest)
    suffix = str(sysconfig.get_config_var("EXT_SUFFIX"))
    for name in names:
        _file(root, domain_relative / "lib" / (name.replace(".", "/") + suffix))
    # mypyc's common group library is captured by the full file inventory too.
    return CodeTe2Runtime(executable, domain)


def packaged_runtime(package_version: str) -> CodeTe2Runtime:
    return validate_runtime(Path(__file__).resolve().parent / "code_te2", package_version=package_version)
