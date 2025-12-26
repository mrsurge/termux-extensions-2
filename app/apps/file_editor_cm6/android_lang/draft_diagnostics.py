from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple


_DRAFT_SOURCE = "te2-android:draft"

# Kotlin/Groovy style, tolerate trailing ';' and alias imports.
_IMPORT_RE = re.compile(r"^import\s+([\w.]+(?:\.\*)?)(?:\s+as\s+\w+)?\s*;?\s*$")

_INDEX_CACHE_KEY: str | None = None
_INDEX_CACHE_CLASSES: set[str] = set()
_INDEX_CACHE_PACKAGES: set[str] = set()


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
                    if pkg and pkg not in pkg_set:
                        diags.append(_unresolved_import_diag(imp, line))
                else:
                    if imp and imp not in class_set:
                        diags.append(_unresolved_import_diag(imp, line))

    return diags
