from __future__ import annotations

import json
import os
import re
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


REGISTRY_VERSION = 1
REGISTRY_REL = Path(".code_cm6") / "lang" / "python" / "workers.json"
CONFIG_FILENAMES = ("pyrightconfig.json", "pyproject.toml")
DEFAULT_IGNORES = {
    ".git",
    ".hg",
    ".svn",
    ".code_cm6",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
}

try:  # Python 3.11+
    import tomllib  # type: ignore
except Exception:  # pragma: no cover - fallback below
    tomllib = None  # type: ignore


@dataclass(frozen=True)
class PythonWorkerEntry:
    id: str
    root: Path
    pyright_project: Optional[Path] = None
    enabled: bool = True


def get_registry_path(project_root: Path) -> Path:
    return project_root / REGISTRY_REL


def _normalize_root(project_root: Path, root_value: str) -> Optional[Path]:
    if not root_value:
        return None
    try:
        raw = Path(root_value).expanduser()
        if not raw.is_absolute():
            raw = (project_root / raw).expanduser()
        return raw.resolve(strict=False)
    except Exception:
        try:
            return Path(root_value)
        except Exception:
            return None


def _normalize_project_override(root_path: Path, value: Optional[str]) -> Optional[Path]:
    if not value:
        return None
    try:
        raw = Path(value).expanduser()
        if not raw.is_absolute():
            raw = (root_path / raw).expanduser()
        return raw.resolve(strict=False)
    except Exception:
        return None


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9._/-]+", "-", value.strip().lower())
    text = text.strip("-_./")
    return text or "root"


def _derive_unique_id(root_rel: str, used: set[str]) -> str:
    base = _slugify(root_rel.replace(os.sep, "/").strip("/")) if root_rel else "root"
    candidate = base
    idx = 2
    while candidate in used:
        candidate = f"{base}-{idx}"
        idx += 1
    used.add(candidate)
    return candidate


def _has_pyright_tool_pyproject(path: Path) -> bool:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return False

    if tomllib is not None:
        try:
            data = tomllib.loads(raw)
            tool = data.get("tool") if isinstance(data, dict) else None
            if isinstance(tool, dict) and "pyright" in tool:
                return True
        except Exception:
            pass

    # Fallback: simple textual detection.
    return bool(re.search(r"^\s*\[tool\.pyright\]\s*$", raw, re.MULTILINE))


def load_python_worker_registry(project_root: Path) -> List[PythonWorkerEntry]:
    """Load python worker registry entries (best-effort)."""

    path = get_registry_path(project_root)
    if not path.exists():
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

    items = data.get("workers")
    if not isinstance(items, list):
        return []

    entries: List[PythonWorkerEntry] = []
    try:
        project_root_norm = project_root.expanduser().resolve(strict=False)
    except Exception:
        project_root_norm = project_root

    for item in items:
        if not isinstance(item, dict):
            continue

        enabled = item.get("enabled", True)
        if enabled is False:
            continue

        root_raw = item.get("root")
        if not isinstance(root_raw, str) or not root_raw.strip():
            continue

        root_path = _normalize_root(project_root_norm, root_raw.strip())
        if not root_path:
            continue

        # Keep roots inside the project to avoid accidental escape.
        try:
            root_path.relative_to(project_root_norm)
        except Exception:
            continue

        ident = item.get("id") or root_path.name
        if not isinstance(ident, str) or not ident:
            ident = root_path.name

        proj_override = (
            item.get("pyright_project")
            or item.get("pyrightProject")
            or item.get("project")
        )
        proj_path = _normalize_project_override(root_path, proj_override if isinstance(proj_override, str) else None)

        entries.append(
            PythonWorkerEntry(
                id=str(ident),
                root=root_path,
                pyright_project=proj_path,
                enabled=True,
            )
        )

    return entries


def find_python_worker_for_file(project_root: Path, file_path: Path) -> Optional[PythonWorkerEntry]:
    """Return the most specific worker whose root contains file_path."""

    entries = load_python_worker_registry(project_root)
    if not entries:
        return None

    try:
        file_path_norm = file_path.expanduser().resolve(strict=False)
    except Exception:
        file_path_norm = file_path

    best: Optional[PythonWorkerEntry] = None
    best_len = -1
    for entry in entries:
        try:
            rel = file_path_norm.relative_to(entry.root)
        except Exception:
            continue
        if rel is None:
            continue
        root_len = len(str(entry.root))
        if root_len > best_len:
            best = entry
            best_len = root_len

    return best


def list_python_worker_roots(project_root: Path) -> List[PythonWorkerEntry]:
    return load_python_worker_registry(project_root)


def normalize_worker_payload(project_root: Path, items: list) -> tuple[list[PythonWorkerEntry], list[str]]:
    """Normalize a payload list into worker entries; returns (entries, errors)."""

    entries: list[PythonWorkerEntry] = []
    errors: list[str] = []

    try:
        project_root_norm = project_root.expanduser().resolve(strict=False)
    except Exception:
        project_root_norm = project_root

    if not isinstance(items, list):
        return [], ["workers payload must be a list"]

    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"row {idx}: not a dict")
            continue

        enabled = item.get("enabled", True)
        if enabled is False:
            continue

        root_raw = item.get("root")
        if not isinstance(root_raw, str) or not root_raw.strip():
            errors.append(f"row {idx}: missing root")
            continue

        root_path = _normalize_root(project_root_norm, root_raw.strip())
        if not root_path:
            errors.append(f"row {idx}: invalid root")
            continue

        try:
            root_path.relative_to(project_root_norm)
        except Exception:
            errors.append(f"row {idx}: root outside project")
            continue

        ident = item.get("id") or root_path.name or "root"
        if not isinstance(ident, str) or not ident.strip():
            ident = root_path.name or "root"

        proj_override = (
            item.get("pyright_project")
            or item.get("pyrightProject")
            or item.get("project")
        )
        proj_path = _normalize_project_override(root_path, proj_override if isinstance(proj_override, str) else None)

        entries.append(
            PythonWorkerEntry(
                id=str(ident).strip(),
                root=root_path,
                pyright_project=proj_path,
                enabled=True,
            )
        )

    return entries, errors


def serialize_worker_entries(project_root: Path, entries: List[PythonWorkerEntry]) -> List[dict]:
    """Return registry payload entries with roots relative to project_root."""

    out: List[dict] = []
    try:
        project_root_norm = project_root.expanduser().resolve(strict=False)
    except Exception:
        project_root_norm = project_root

    for entry in entries:
        try:
            root_rel = str(entry.root.relative_to(project_root_norm))
        except Exception:
            root_rel = str(entry.root)

        proj_rel = ""
        if entry.pyright_project:
            try:
                proj_rel = str(entry.pyright_project.relative_to(entry.root))
            except Exception:
                proj_rel = str(entry.pyright_project)

        payload = {
            "id": str(entry.id),
            "root": root_rel,
            "enabled": bool(entry.enabled),
        }
        if proj_rel:
            payload["pyright_project"] = proj_rel
        out.append(payload)

    return out


def save_python_worker_registry(project_root: Path, entries: List[PythonWorkerEntry], *, generated: bool = False) -> Path:
    path = get_registry_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": REGISTRY_VERSION,
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "generated": bool(generated),
        "workers": serialize_worker_entries(project_root, entries),
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def discover_python_worker_entries(project_root: Path) -> List[PythonWorkerEntry]:
    """Scan project_root for pyright config files and return worker entries."""

    entries_by_root: dict[Path, PythonWorkerEntry] = {}
    used_ids: set[str] = set()

    try:
        project_root_norm = project_root.expanduser().resolve(strict=False)
    except Exception:
        project_root_norm = project_root

    for dirpath, dirnames, filenames in os.walk(project_root_norm):
        # Prune ignored directories in-place.
        dirnames[:] = [d for d in dirnames if d not in DEFAULT_IGNORES]

        if "pyrightconfig.json" in filenames:
            root = Path(dirpath)
            if root not in entries_by_root:
                try:
                    rel = str(root.relative_to(project_root_norm))
                except Exception:
                    rel = str(root)
                ident = _derive_unique_id(rel, used_ids)
                entries_by_root[root] = PythonWorkerEntry(
                    id=ident,
                    root=root,
                    pyright_project=root / "pyrightconfig.json",
                    enabled=True,
                )
            continue

        if "pyproject.toml" in filenames:
            root = Path(dirpath)
            if root in entries_by_root:
                continue
            if _has_pyright_tool_pyproject(root / "pyproject.toml"):
                try:
                    rel = str(root.relative_to(project_root_norm))
                except Exception:
                    rel = str(root)
                ident = _derive_unique_id(rel, used_ids)
                entries_by_root[root] = PythonWorkerEntry(
                    id=ident,
                    root=root,
                    pyright_project=root / "pyproject.toml",
                    enabled=True,
                )

    return list(entries_by_root.values())
