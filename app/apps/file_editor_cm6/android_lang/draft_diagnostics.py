from __future__ import annotations

from typing import Any, Dict, List


def _range0() -> Dict[str, Any]:
    return {
        "start": {"line": 0, "character": 0},
        "end": {"line": 0, "character": 0},
    }


def build_draft_diagnostics(*, te2_sidecar: Dict[str, Any], uri: str) -> List[Dict[str, Any]]:
    """Return conservative draft diagnostics (Sprint B).

    These are intentionally cheap and do not attempt AST-level placement.
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
                "severity": 2,  # Warning
                "source": "te2-android:draft",
                "code": "ANDROID_SDK_MISSING",
                "message": "Android SDK not configured (android.jar not found).",
            }
        )

    java_home = str(jvm.get("javaHome") or "").strip()
    if not java_home:
        diags.append(
            {
                "range": _range0(),
                "severity": 2,  # Warning
                "source": "te2-android:draft",
                "code": "JDK_MISSING",
                "message": "JDK not configured (JAVA_HOME missing).",
            }
        )

    return diags
