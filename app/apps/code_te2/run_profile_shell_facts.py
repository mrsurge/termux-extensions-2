# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from threading import Lock
from typing import TypedDict

RUN_PROFILE_LABEL_PREFIXES = (
    "runner-profile:code_te2:",
    "page-preview:code_te2:",
)


class RunProfileShellFactsSnapshot(TypedDict):
    initialized: bool
    revision: int
    shellsById: dict[str, str]


_lock = Lock()
_initialized = False
_revision = 0
_shell_labels_by_id: dict[str, str] = {}


def is_run_profile_shell_label(label: str) -> bool:
    return any(label.startswith(prefix) for prefix in RUN_PROFILE_LABEL_PREFIXES)


def replace_run_profile_shell_facts(shell_labels_by_id: Mapping[str, str]) -> None:
    global _initialized, _revision
    normalized = {
        str(shell_id).strip(): str(label).strip()
        for shell_id, label in shell_labels_by_id.items()
        if str(shell_id).strip()
        and is_run_profile_shell_label(str(label).strip())
    }
    with _lock:
        _shell_labels_by_id.clear()
        _shell_labels_by_id.update(normalized)
        _initialized = True
        _revision += 1


def record_run_profile_shell(shell_id: str, label: str) -> bool:
    global _revision
    normalized_shell_id = shell_id.strip()
    normalized_label = label.strip()
    if not normalized_shell_id or not is_run_profile_shell_label(normalized_label):
        return False
    with _lock:
        if _shell_labels_by_id.get(normalized_shell_id) == normalized_label:
            return False
        _shell_labels_by_id[normalized_shell_id] = normalized_label
        _revision += 1
    return True


def remove_run_profile_shell(*, shell_id: str = "", label: str = "") -> bool:
    global _revision
    normalized_shell_id = shell_id.strip()
    normalized_label = label.strip()
    removed = False
    with _lock:
        if normalized_shell_id and normalized_shell_id in _shell_labels_by_id:
            _ = _shell_labels_by_id.pop(normalized_shell_id, None)
            removed = True
        if normalized_label:
            for candidate_id in [
                candidate_id
                for candidate_id, candidate_label in _shell_labels_by_id.items()
                if candidate_label == normalized_label
            ]:
                _ = _shell_labels_by_id.pop(candidate_id, None)
                removed = True
        if removed:
            _revision += 1
    return removed


def run_profile_shell_id(label: str) -> str:
    normalized_label = label.strip()
    if not normalized_label:
        return ""
    with _lock:
        for shell_id, candidate_label in _shell_labels_by_id.items():
            if candidate_label == normalized_label:
                return shell_id
    return ""


def run_profile_shell_label_for_id(shell_id: str) -> str:
    normalized_shell_id = shell_id.strip()
    if not normalized_shell_id:
        return ""
    with _lock:
        return _shell_labels_by_id.get(normalized_shell_id, "")


def run_profile_shell_facts_ready() -> bool:
    with _lock:
        return _initialized


def get_run_profile_shell_facts() -> RunProfileShellFactsSnapshot:
    with _lock:
        return {
            "initialized": _initialized,
            "revision": _revision,
            "shellsById": dict(_shell_labels_by_id),
        }


def reset_run_profile_shell_facts() -> None:
    global _initialized, _revision
    with _lock:
        _shell_labels_by_id.clear()
        _initialized = False
        _revision = 0
