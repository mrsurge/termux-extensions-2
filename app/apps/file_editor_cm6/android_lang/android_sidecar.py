from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from app.apps.file_editor_cm6.project_sidecar import ProjectSidecar


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def resolve_cache_root() -> Path:
    raw = (os.getenv("TE2_ANDROID_LSP_CACHE_ROOT") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".cache" / "te2_android_lsp"


def resolve_lsp_project_id(*, project_root: Path) -> str:
    """Return stable lspProjectId for the base project root (NOT rootRel).

    This avoids forking IDs if the user changes the kotlin-android rootRel override.
    """

    sidecar = ProjectSidecar.load_or_create(str(project_root))
    pid = sidecar.get_or_create_lsp_project_id()
    try:
        sidecar.save()
    except Exception:
        pass
    return pid


def resolve_project_cache_dir(*, cache_root: Path, lsp_project_id: str) -> Path:
    return cache_root / str(lsp_project_id)


def resolve_te2_android_sidecar_path(*, project_root: Path) -> Path:
    cache_root = resolve_cache_root()
    pid = resolve_lsp_project_id(project_root=project_root)
    return resolve_project_cache_dir(cache_root=cache_root, lsp_project_id=pid) / "te2_android_sidecar.json"


@dataclass
class AndroidTe2Sidecar:
    path: Path

    def load(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            raw = self.path.read_text(encoding="utf-8")
            if not raw.strip():
                return {}
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def save(self, data: Dict[str, Any]) -> None:
        _ensure_dir(self.path.parent)
        tmp_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=str(self.path.parent),
                delete=False,
                prefix=self.path.name + ".",
                suffix=".tmp",
            ) as tmp_file:
                tmp_path = Path(tmp_file.name)
                json.dump(data, tmp_file, ensure_ascii=False, indent=2)
                tmp_file.flush()
                os.fsync(tmp_file.fileno())
            os.replace(tmp_path, self.path)
        finally:
            if tmp_path is not None and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
