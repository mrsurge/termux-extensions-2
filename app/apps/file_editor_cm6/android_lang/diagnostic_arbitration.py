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

_UNRESOLVED_IMPORT_PATTERN = "Unresolved import"

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


def _is_unresolved_import_backend(diag: Dict[str, Any]) -> bool:
    msg = str(diag.get("message") or "")
    return _UNRESOLVED_IMPORT_PATTERN in msg


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
        merged = list(backend) + list(draft)
        return _dedupe_backend_vs_draft(backend=backend, merged=merged)

    # Check if draft diagnostics indicate environment problems
    has_env_problems = any(_is_env_problem_diagnostic(d) for d in draft)

    if has_env_problems:
        # Environment is broken: don't suppress anything, user needs to fix SDK/JDK
        merged = list(backend) + list(draft)
        return _dedupe_backend_vs_draft(backend=backend, merged=merged)

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
        merged = list(backend) + list(draft)
        return _dedupe_backend_vs_draft(backend=backend, merged=merged)

    filtered_backend = [d for d in backend if not _is_ghost_diagnostic(d)]
    merged = filtered_backend + list(draft)
    return _dedupe_backend_vs_draft(backend=filtered_backend, merged=merged)


def _dedupe_backend_vs_draft(*, backend: List[Dict[str, Any]], merged: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Suppress redundant TE2 draft diagnostics when backend already reports the same issue."""

    try:
        backend_unresolved_import_lines: set[int] = set()
        for d in backend:
            if not isinstance(d, dict):
                continue
            if not _is_unresolved_import_backend(d):
                continue
            rng = d.get("range") or {}
            start = (rng.get("start") or {}) if isinstance(rng, dict) else {}
            line = start.get("line")
            if isinstance(line, int):
                backend_unresolved_import_lines.add(line)

        out: list[Dict[str, Any]] = []
        for d in merged:
            if not isinstance(d, dict):
                continue
            if (d.get("source") or "") != _DRAFT_SOURCE:
                out.append(d)
                continue
            if (d.get("code") or "") != "DRAFT_UNRESOLVED_IMPORT":
                out.append(d)
                continue
            rng = d.get("range") or {}
            start = (rng.get("start") or {}) if isinstance(rng, dict) else {}
            line = start.get("line")
            if isinstance(line, int) and line in backend_unresolved_import_lines:
                continue
            out.append(d)

        return out
    except Exception:
        return merged
