"""Diagnostic arbitration for Android LSP (Sprint C).

Provides merge rules between backend (Gradle) diagnostics and TE2 draft diagnostics
to reduce "ghost errors" while editing.
"""

from __future__ import annotations

from typing import Any, Dict, List


# Patterns that indicate "unresolved" errors likely to change with unsaved edits
_GHOST_PATTERNS = (
    "Unresolved reference",
    "Unresolved import",
)

# TE2 draft source tag (environment hints)
_DRAFT_SOURCE = "te2-android:draft"

# Draft diagnostic codes that indicate environment problems (not fixable by editing)
_ENV_PROBLEM_CODES = {"ANDROID_SDK_MISSING", "JDK_MISSING"}


def _is_ghost_diagnostic(diag: Dict[str, Any]) -> bool:
    """Return True if the diagnostic is likely a 'ghost' error that disappears on save."""

    msg = str(diag.get("message") or "")
    for pattern in _GHOST_PATTERNS:
        if pattern in msg:
            return True
    return False


def _is_env_problem_diagnostic(diag: Dict[str, Any]) -> bool:
    """Return True if the diagnostic indicates an environment problem (SDK/JDK missing)."""

    source = diag.get("source") or ""
    code = diag.get("code") or ""

    if source == _DRAFT_SOURCE and code in _ENV_PROBLEM_CODES:
        return True
    return False


def merge_android_diagnostics(
    *,
    backend: List[Dict[str, Any]],
    draft: List[Dict[str, Any]],
    has_drafts: bool,
) -> List[Dict[str, Any]]:
    """Merge backend (Gradle) diagnostics with TE2 draft diagnostics.

    Args:
        backend: Diagnostics from the Kotlin LSP (Gradle compile results).
        draft: Diagnostics from TE2 heuristics (SDK/JDK missing hints).
        has_drafts: Whether the current file has unsaved changes.

    Returns:
        Merged list of diagnostics with ghost errors suppressed when appropriate.

    Rules (v1, conservative):
        1) If has_drafts is False: return backend + draft as-is.
        2) If has_drafts is True:
           - Keep all non-"unresolved" backend diagnostics.
           - Suppress backend "ghost" diagnostics (Unresolved reference, etc.)
             UNLESS draft diagnostics indicate an environment problem.
           - Always include draft diagnostics.
    """

    if not has_drafts:
        # No unsaved edits: return everything
        return list(backend) + list(draft)

    # Check if draft diagnostics indicate environment problems
    has_env_problems = any(_is_env_problem_diagnostic(d) for d in draft)

    if has_env_problems:
        # Environment is broken: don't suppress anything, user needs to fix SDK/JDK
        return list(backend) + list(draft)

    # Only suppress ghost diagnostics if TE2 provided replacements (Sprint E: never go blind).
    has_replacements = False
    try:
        for d in draft:
            if not isinstance(d, dict):
                continue
            if (d.get("source") or "") != _DRAFT_SOURCE:
                continue
            code = str(d.get("code") or "")
            if code.startswith("DRAFT_UNRESOLVED_"):
                has_replacements = True
                break
    except Exception:
        has_replacements = False

    if not has_replacements:
        return list(backend) + list(draft)

    filtered_backend = [d for d in backend if not _is_ghost_diagnostic(d)]
    return filtered_backend + list(draft)
