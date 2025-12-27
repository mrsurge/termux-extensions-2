from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Tuple


_DRAFT_SOURCE = "te2-android:draft"

# Kotlin/Groovy style, tolerate trailing ';' and alias imports.
_IMPORT_RE = re.compile(r"^import\s+([\w.]+(?:\.\*)?)(?:\s+as\s+\w+)?\s*;?\s*$")

_INDEX_CACHE_KEY: str | None = None
_INDEX_CACHE_CLASSES: set[str] = set()
_INDEX_CACHE_PACKAGES: set[str] = set()

_COMPANION_MEMBER_RE = re.compile(r"^(.+?)\.Companion\.(\w+)$")
_COMPANION_OBJECT_RE = re.compile(r"^(.+?)\.Companion$")

_CLASSFILE_CACHE_KEY: str | None = None
_CLASSFILE_BYTES: dict[str, bytes | None] = {}


def _range0() -> Dict[str, Any]:
    return {
        "start": {"line": 0, "character": 0},
        "end": {"line": 0, "character": 0},
    }


def _range_line(line: int) -> Dict[str, Any]:
    return {
        "start": {"line": line, "character": 0},
        "end": {"line": line, "character": 999},
    }


def _get_index_sets(te2_sidecar: Dict[str, Any]) -> tuple[set[str], set[str]]:
    global _INDEX_CACHE_KEY, _INDEX_CACHE_CLASSES, _INDEX_CACHE_PACKAGES

    idx = (te2_sidecar or {}).get("dependencyIndex") or {}
    if not isinstance(idx, dict):
        return set(), set()

    key = f"{idx.get('syncFingerprint') or ''}|{idx.get('builtAtMs') or ''}"
    if key and key == _INDEX_CACHE_KEY:
        return _INDEX_CACHE_CLASSES, _INDEX_CACHE_PACKAGES

    classes = idx.get("classes")
    packages = idx.get("packages")
    if not isinstance(classes, list) or not isinstance(packages, list):
        return set(), set()

    _INDEX_CACHE_KEY = key
    _INDEX_CACHE_CLASSES = {c for c in classes if isinstance(c, str) and c}
    _INDEX_CACHE_PACKAGES = {p for p in packages if isinstance(p, str) and p}
    return _INDEX_CACHE_CLASSES, _INDEX_CACHE_PACKAGES


def _extract_imports(content: str) -> List[Tuple[str, int]]:
    imports: List[Tuple[str, int]] = []
    for i, line in enumerate(content.splitlines()):
        s = line.strip()
        if not s or s.startswith("//"):
            continue
        m = _IMPORT_RE.match(s)
        if m:
            imports.append((m.group(1), i))
    return imports


def _unresolved_import_diag(import_str: str, line: int) -> Dict[str, Any]:
    return {
        "range": _range_line(line),
        "severity": 2,  # Warning (TE2-generated; not a real Gradle compile error)
        "source": _DRAFT_SOURCE,
        "code": "DRAFT_UNRESOLVED_IMPORT",
        "message": f"Unresolved import (draft): {import_str}",
    }


def _index_cache_key(te2_sidecar: Dict[str, Any]) -> str:
    idx = (te2_sidecar or {}).get("dependencyIndex") or {}
    if not isinstance(idx, dict):
        return ""
    return f"{idx.get('syncFingerprint') or ''}|{idx.get('builtAtMs') or ''}"


def _class_exists(class_set: set[str], fqcn: str) -> bool:
    if not fqcn:
        return False
    if fqcn in class_set:
        return True
    # Kotlin/JVM companion objects are compiled as Foo$Companion.
    if f"{fqcn}$Companion" in class_set:
        return True
    return False


def _is_known_package(pkg_set: set[str], pkg: str) -> bool:
    if not pkg:
        return False
    if pkg in pkg_set:
        return True
    # Be tolerant: treat parent package presence as "likely ok" for wildcard imports.
    try:
        parts = pkg.split(".")
        for i in range(len(parts) - 1, 0, -1):
            if ".".join(parts[:i]) in pkg_set:
                return True
    except Exception:
        pass
    return False


def _iter_artifacts_for_index(te2_sidecar: Dict[str, Any]) -> List[Path]:
    idx = (te2_sidecar or {}).get("dependencyIndex") or {}
    if not isinstance(idx, dict):
        return []
    arts = idx.get("scannedArtifacts") or []
    if not isinstance(arts, list):
        return []
    out: list[Path] = []
    for a in arts:
        if not isinstance(a, str):
            continue
        s = a.strip()
        if not s:
            continue
        try:
            out.append(Path(s).expanduser())
        except Exception:
            continue
    return out


def _read_class_from_artifact(*, artifact_path: Path, entry: str) -> bytes | None:
    try:
        suffix = artifact_path.suffix.lower()
    except Exception:
        return None

    try:
        if suffix == ".jar":
            with zipfile.ZipFile(artifact_path, "r") as zf:
                try:
                    return zf.read(entry)
                except KeyError:
                    return None

        if suffix == ".aar":
            with zipfile.ZipFile(artifact_path, "r") as aar:
                names = aar.namelist()
                if "classes.jar" in names:
                    try:
                        raw = aar.read("classes.jar")
                        with zipfile.ZipFile(io.BytesIO(raw), "r") as jar:
                            try:
                                return jar.read(entry)
                            except KeyError:
                                pass
                    except Exception:
                        pass

                for name in names:
                    if not (name.startswith("libs/") and name.endswith(".jar")):
                        continue
                    try:
                        raw = aar.read(name)
                        with zipfile.ZipFile(io.BytesIO(raw), "r") as jar:
                            try:
                                return jar.read(entry)
                            except KeyError:
                                continue
                    except Exception:
                        continue
    except Exception:
        return None

    return None


def _get_classfile_bytes(*, te2_sidecar: Dict[str, Any], fqcn: str) -> bytes | None:
    global _CLASSFILE_CACHE_KEY, _CLASSFILE_BYTES

    key = _index_cache_key(te2_sidecar)
    if key != _CLASSFILE_CACHE_KEY:
        _CLASSFILE_CACHE_KEY = key
        _CLASSFILE_BYTES = {}

    if fqcn in _CLASSFILE_BYTES:
        return _CLASSFILE_BYTES.get(fqcn)

    entry = fqcn.replace(".", "/") + ".class"
    for art in _iter_artifacts_for_index(te2_sidecar):
        raw = _read_class_from_artifact(artifact_path=art, entry=entry)
        if raw:
            _CLASSFILE_BYTES[fqcn] = raw
            return raw

    _CLASSFILE_BYTES[fqcn] = None
    return None


def _classfile_contains_utf8_exact(*, class_bytes: bytes, s: str) -> bool:
    try:
        b = s.encode("utf-8")
    except Exception:
        return False
    if not b:
        return False
    if len(b) > 0xFFFF:
        return False
    try:
        needle = len(b).to_bytes(2, "big") + b
        return needle in class_bytes
    except Exception:
        return False


def _companion_member_exists(*, te2_sidecar: Dict[str, Any], owner_fqcn: str, member: str) -> bool:
    """Best-effort check for `import Foo.Companion.member`.

    We only do this check when Foo$Companion exists in the dependency index.
    For method/property names, Kotlin/JVM usually embeds the UTF8 string in the
    classfile constant pool (or Kotlin metadata), so this catches many typos.
    """

    companion_fqcn = f"{owner_fqcn}$Companion"
    companion_bytes = _get_classfile_bytes(te2_sidecar=te2_sidecar, fqcn=companion_fqcn)
    owner_bytes = _get_classfile_bytes(te2_sidecar=te2_sidecar, fqcn=owner_fqcn)

    cap = member[:1].upper() + member[1:] if member else ""
    candidates = [member]
    if cap:
        candidates.extend([f"get{cap}", f"set{cap}"])

    for cb in (companion_bytes, owner_bytes):
        if not cb:
            continue
        for c in candidates:
            if _classfile_contains_utf8_exact(class_bytes=cb, s=c):
                return True

    # If we couldn't read any bytes, don't emit a false warning.
    if companion_bytes is None and owner_bytes is None:
        return True
    return False


def build_draft_diagnostics(*, te2_sidecar: Dict[str, Any], uri: str, content: str | None = None) -> List[Dict[str, Any]]:
    """Return TE2 draft diagnostics.

    Policy: all TE2-generated diagnostics are WARNING-level, since they are not actual Gradle compile results.
    """

    dep = te2_sidecar.get("dependencyModel") or {}
    android_sdk = dep.get("androidSdk") or {}
    jvm = dep.get("jvm") or {}

    diags: List[Dict[str, Any]] = []

    android_jar = str(android_sdk.get("androidJar") or "").strip()
    if not android_jar:
        diags.append(
            {
                "range": _range0(),
                "severity": 2,
                "source": _DRAFT_SOURCE,
                "code": "ANDROID_SDK_MISSING",
                "message": "Android SDK not configured (android.jar not found).",
            }
        )

    java_home = str(jvm.get("javaHome") or "").strip()
    if not java_home:
        diags.append(
            {
                "range": _range0(),
                "severity": 2,
                "source": _DRAFT_SOURCE,
                "code": "JDK_MISSING",
                "message": "JDK not configured (JAVA_HOME missing).",
            }
        )

    if content:
        class_set, pkg_set = _get_index_sets(te2_sidecar)
        if class_set or pkg_set:
            for imp, line in _extract_imports(content):
                if imp.endswith(".*"):
                    pkg = imp[:-2]
                    if pkg and not _is_known_package(pkg_set, pkg):
                        diags.append(_unresolved_import_diag(imp, line))
                else:
                    if not imp:
                        continue

                    # Kotlin allows importing the companion itself:
                    #   import foo.Bar.Companion
                    m0 = _COMPANION_OBJECT_RE.match(imp)
                    if m0:
                        owner = m0.group(1)
                        if f"{owner}$Companion" in class_set:
                            continue
                        diags.append(_unresolved_import_diag(imp, line))
                        continue

                    # Kotlin allows importing members from objects/companions:
                    #   import foo.Bar.Companion.baz
                    m = _COMPANION_MEMBER_RE.match(imp)
                    if m:
                        owner = m.group(1)  # foo.Bar
                        member = m.group(2)  # baz
                        if f"{owner}$Companion" in class_set and _companion_member_exists(
                            te2_sidecar=te2_sidecar, owner_fqcn=owner, member=member
                        ):
                            continue
                        diags.append(_unresolved_import_diag(imp, line))
                        continue

                    # Top-level functions and properties can also be imported:
                    #   import kotlin.io.pathExists
                    # Heuristic: some imports are not classes (top-level functions/properties, etc.)
                    # If the last segment starts lowercase, only suppress the warning when the
                    # owner looks valid (known package or a known class).
                    last_seg = imp.rsplit(".", 1)[-1]
                    if last_seg and last_seg[:1].islower():
                        owner = imp.rsplit(".", 1)[0] if "." in imp else ""
                        if owner and (_is_known_package(pkg_set, owner) or _class_exists(class_set, owner)):
                            continue

                    if not _class_exists(class_set, imp):
                        diags.append(_unresolved_import_diag(imp, line))

    return diags
