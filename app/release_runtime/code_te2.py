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
    python_home: Path | None = None
    python_executable: Path | None = None
    source_root: Path | None = None


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
    schema = manifest.get("schemaVersion")
    if schema not in (1, 2) or manifest.get("appId") != "code_te2":
        raise ReleaseRuntimeError("Unsupported Code TE2 runtime manifest")
    if package_version is not None and manifest.get("packageVersion") != package_version:
        raise ReleaseRuntimeError("Code TE2 runtime does not match the installed package version")
    identity = _object(manifest.get("python"), "Python identity")
    private: dict[str, object] | None = None
    if schema == 1:
        if identity != python_identity():
            raise ReleaseRuntimeError("Code TE2 runtime Python ABI/libpython identity mismatch")
        suffix = str(sysconfig.get_config_var("EXT_SUFFIX"))
    else:
        # This ABI belongs to the embedded app, not the invoking CLI Python.
        if (identity.get("implementation") != "cpython" or identity.get("version") != "3.14"
                or identity.get("freeThreaded") is not False
                or identity.get("libpython") != "libpython3.14.so.1.0"):
            raise ReleaseRuntimeError("Private Code TE2 runtime requires ordinary shared CPython 3.14")
        soabi = _text(identity.get("soabi"), "private SOABI")
        if not re.fullmatch(r"cpython-314-[A-Za-z0-9_-]+", soabi):
            raise ReleaseRuntimeError("Invalid private Code TE2 SOABI")
        private = _object(manifest.get("pythonRuntime"), "private Python runtime")
        if private.get("mode") != "bundled":
            raise ReleaseRuntimeError("Linux private Code TE2 runtime must be bundled")
        suffix = _text(private.get("extensionSuffix"), "private extension suffix")
        if suffix != f".{soabi}.so":
            raise ReleaseRuntimeError("Private extension suffix does not match SOABI")
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
    wheel_libraries = _object(manifest.get("wheelLibraries", {}), "wheel library checksums")
    if wheel_libraries:
        package_root = root.parents[2]
        if root.relative_to(package_root).as_posix() != "app/release_runtime/code_te2":
            raise ReleaseRuntimeError("Wheel library inventory requires installed package layout")
        for name, digest in wheel_libraries.items():
            relative = _relative(name, "wheel library")
            if relative.parts[0] != "te2.libs":
                raise ReleaseRuntimeError("Unexpected wheel-owned library directory")
            expected = _text(digest, "wheel library digest")
            if not _DIGEST.fullmatch(expected) or sha256(_file(package_root, relative)) != expected:
                raise ReleaseRuntimeError(f"Code TE2 wheel library checksum mismatch: {name}")
        actual_libraries = {path.relative_to(package_root).as_posix()
                            for path in (package_root / "te2.libs").rglob("*") if path.is_file()}
        if actual_libraries != set(wheel_libraries):
            raise ReleaseRuntimeError("Code TE2 wheel library inventory is incomplete")
    actual = set()
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        name = relative.as_posix()
        cache = re.fullmatch(r'(.+)\.cpython-[0-9]{2,3}(?:\.opt-[12])?\.pyc', relative.name)
        if (schema == 2 and name not in files and relative.parent.name == '__pycache__'
                and cache is not None
                and (relative.parent.parent / (cache.group(1) + '.py')).as_posix() in files):
            # Pip may compile the private source with the *host* interpreter.
            # Isolated native PyConfig never reads adjacent bytecode caches.
            continue
        actual.add(name)
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
    for name in names:
        _file(root, domain_relative / "lib" / (name.replace(".", "/") + suffix))
    # mypyc's common group library is captured by the full file inventory too.
    if private is None:
        return CodeTe2Runtime(executable, domain)
    home_relative = _relative(private.get("home"), "private Python home")
    interpreter = _file(root, _relative(private.get("executable"), "private Python executable"))
    if not os.access(interpreter, os.X_OK):
        raise ReleaseRuntimeError("Private Python executable is not executable")
    _file(root, home_relative / "lib/libpython3.14.so.1.0")
    _file(root, home_relative / "lib/python3.14/encodings/__init__.py")
    source_relative = _relative(private.get("sourceRoot"), "private source root")
    _file(root, source_relative / "app/apps/code_te2/native_worker.py")
    return CodeTe2Runtime(executable, domain, root / home_relative, interpreter, root / source_relative)


def packaged_runtime(package_version: str) -> CodeTe2Runtime:
    return validate_runtime(Path(__file__).resolve().parent / "code_te2", package_version=package_version)
