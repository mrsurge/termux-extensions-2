from __future__ import annotations

import json
import threading
import os
import sys
import hashlib
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .project_sidecar import ProjectSidecar
from .draft_index_sidecar import DraftIndexSidecar

MAX_RECENT_PROJECTS = 12
MAX_RECENT_FILES = 12


_HISTORY_DEBUG = os.getenv("TE2_HISTORY_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}


def _history_debug(msg: str) -> None:
    if not _HISTORY_DEBUG:
        return
    try:
        print(msg)
    except Exception:
        pass


def _utc_timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _project_label(path: str) -> str:
    try:
        label = Path(path).name
        return label or path
    except Exception:
        return path


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


class HistoryStore:
    """Persist recent project/file history and editor session cache."""

    def __init__(self, storage_path: Optional[Path] = None) -> None:
        default_root = Path.home() / ".local" / "share" / "termux-extensions-2"
        default_root.mkdir(parents=True, exist_ok=True)
        self._path = storage_path or (default_root / "code_oss_history.json")
        self._session_cache_dir = Path.home() / ".cache" / "cm6_sessions"
        self._session_cache_dir.mkdir(parents=True, exist_ok=True)

        _ensure_dir(self._path)
        self._lock = threading.Lock()
        self._data: Dict[str, object] = {
            "recent_projects": [],
            "projects": {},
            "active_project": None,
            "session_state": {},
            "session_cache": {},
            # Legacy global terminal shell id (kept for lazy migration).
            "terminal_shell_id": None,
        }
        self._load()

    # ----- persistence helpers -------------------------------------------------

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            content = self._path.read_text(encoding="utf-8")
            if not content.strip():
                return
            data = json.loads(content)
            if isinstance(data, dict):
                self._data["recent_projects"] = data.get("recent_projects", [])
                self._data["projects"] = data.get("projects", {})
                self._data["active_project"] = data.get("active_project")
                self._data["session_state"] = data.get("session_state", {})
                # Session cache is primarily stored in sidecars, but we can load keys here
                self._data["session_cache"] = data.get("session_cache", {})
                self._data["terminal_shell_id"] = data.get("terminal_shell_id")
                for entry in self._data["projects"].values():
                    if isinstance(entry, dict):
                        entry.setdefault("diff_base", "HEAD")
        except Exception:
            # Corrupt or unreadable history; start fresh.
            self._data = {"recent_projects": [], "projects": {}, "active_project": None, "session_state": {}, "session_cache": {}, "terminal_shell_id": None}

    def _save_locked(self) -> None:
        tmp_path = self._path.with_suffix(".tmp")
        try:
            # Do not persist the full content in the main history file
            data_to_save = dict(self._data)
            if "session_cache" in data_to_save:
                data_to_save["session_cache"] = {k: {"updated_at": v.get("updated_at")} for k, v in self._data["session_cache"].items()}

            tmp_path.write_text(json.dumps(data_to_save, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(self._path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    # ----- internal helpers ----------------------------------------------------

    def _normalize_project_path(self, project_path: str) -> str:
        try:
            # Normalize to an absolute path but DO NOT resolve symlinks.
            # The user may intentionally open a symlinked worktree path and expects
            # that logical path to remain stable in history/UI.
            expanded = os.path.expanduser(str(project_path))
            return os.path.abspath(expanded)
        except Exception:
            return project_path.strip()

    # ----- project sidecar helpers (SSOT) ------------------------------------

    def get_project_sidecar(self, project_path: str) -> Optional[ProjectSidecar]:
        """Return the ProjectSidecar for a project path (best-effort)."""

        if not project_path:
            return None
        normalized = self._normalize_project_path(project_path)
        try:
            return ProjectSidecar.load_or_create(normalized)
        except Exception:
            return None

    # ----- LSP configuration (project-scoped SSOT via sidecar) ----------------

    def get_lsp_enabled(self, project_path: str) -> bool:
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return False
        try:
            return bool(sidecar.get_lsp_enabled())
        except Exception:
            return False

    def set_lsp_enabled(self, project_path: str, enabled: bool) -> bool:
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return False
        try:
            sidecar.set_lsp_enabled(bool(enabled))
            sidecar.save()
            return True
        except Exception:
            return False

    def get_lsp_server_enabled(self, project_path: str, server_id: str) -> bool:
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return False
        try:
            return bool(sidecar.get_lsp_server_enabled(server_id))
        except Exception:
            return False

    def set_lsp_server_enabled(self, project_path: str, server_id: str, enabled: bool) -> bool:
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return False
        try:
            sidecar.set_lsp_server_enabled(server_id, bool(enabled))
            sidecar.save()
            return True
        except Exception:
            return False

    def get_lsp_server_root_rel(self, project_path: str, server_id: str) -> str:
        if str(server_id) == "kotlin-android":
            try:
                from app.apps.file_editor_cm6.android_lang.android_lsp_config import get_android_lsp_config

                cfg = get_android_lsp_config(Path(project_path))
                return str(cfg.get("rootRel") or "")
            except Exception:
                return ""
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return ""
        try:
            return str(sidecar.get_lsp_server_root_rel(server_id) or "")
        except Exception:
            return ""

    def get_lsp_pyright_config_mode(self, project_path: str) -> str:
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return "root"
        try:
            return str(sidecar.get_lsp_pyright_config_mode() or "root")
        except Exception:
            return "root"

    def set_lsp_pyright_config_mode(self, project_path: str, mode: str) -> bool:
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return False
        try:
            sidecar.set_lsp_pyright_config_mode(mode)
            sidecar.save()
            return True
        except Exception:
            return False

    def set_lsp_server_root_rel(self, project_path: str, server_id: str, root_rel: str) -> bool:
        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return False

        # Normalize and validate. Root overrides are project-relative and must
        # stay within the project root.
        try:
            text = str(root_rel).strip() if root_rel is not None else ""
        except Exception:
            text = ""

        # Empty means "use project root".
        if not text or text == ".":
            try:
                sidecar.set_lsp_server_root_rel(server_id, "")
                sidecar.save()
                return True
            except Exception:
                return False

        if text.startswith("/") or text.startswith("~"):
            return False

        try:
            project_root = Path(self._normalize_project_path(project_path)).expanduser().resolve(strict=False)
        except Exception:
            project_root = Path(project_path).expanduser()

        candidate = (project_root / text).expanduser().resolve(strict=False)
        try:
            candidate.relative_to(project_root)
        except Exception:
            return False

        if not candidate.exists() or not candidate.is_dir():
            return False

        # Store normalized relative string (no trailing slash).
        rel = str(candidate.relative_to(project_root)).strip().rstrip("/")
        try:
            sidecar.set_lsp_server_root_rel(server_id, rel)
            sidecar.save()
            return True
        except Exception:
            return False

    def get_lsp_state_payload(self, project_path: str) -> dict:
        """Return the view_state payload fields for the LSP modal."""

        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            payload = {
                "enableLsp": False,
                "enableLspPyright": False,
                "enableLspTypescript": False,
                "enableLspClangd": False,
                "enableLspKotlin": False,
                "enableLspKotlinAndroid": False,
                "lspPyrightConfigMode": "root",
                "lspRootRelPyright": "",
                "lspRootRelTypescript": "",
                "lspRootRelClangd": "",
                "lspRootRelKotlin": "",
                "lspRootRelKotlinAndroid": "",
                "lspKotlinAndroidModule": "app",
                "lspKotlinAndroidVariant": "GeckoDebug",
                "lspKotlinAndroidVariants": [],
            }
            try:
                from app.apps.file_editor_cm6.android_lang.android_lsp_config import get_android_lsp_config

                cfg = get_android_lsp_config(Path(project_path))
                payload["lspRootRelKotlinAndroid"] = str(cfg.get("rootRel") or "")
                payload["lspKotlinAndroidModule"] = str(cfg.get("module") or "app")
                payload["lspKotlinAndroidVariant"] = str(cfg.get("variant") or "GeckoDebug")
            except Exception:
                pass
            return payload
        try:
            payload = dict(sidecar.get_lsp_state_payload())

            try:
                from app.apps.file_editor_cm6.android_lang.android_lsp_config import get_android_lsp_config

                cfg = get_android_lsp_config(Path(project_path))
                payload["lspRootRelKotlinAndroid"] = str(cfg.get("rootRel") or "")
                payload["lspKotlinAndroidModule"] = str(cfg.get("module") or "app")
                payload["lspKotlinAndroidVariant"] = str(cfg.get("variant") or "GeckoDebug")
            except Exception:
                pass

            # Kotlin-android: detect variants from build.gradle(.kts) under rootRel (fast path).
            try:
                from app.apps.file_editor_cm6.android_lang.gradle_variants import detect_variants_from_gradle

                root_rel = str(payload.get("lspRootRelKotlinAndroid") or "").strip().rstrip("/")
                if root_rel:
                    eff = (Path(project_path).expanduser().resolve(strict=False) / root_rel).expanduser().resolve(strict=False)
                else:
                    eff = Path(project_path).expanduser().resolve(strict=False)

                module = str(payload.get("lspKotlinAndroidModule") or "app")
                detected = detect_variants_from_gradle(effective_project_root=eff, module=module)
                payload["lspKotlinAndroidVariants"] = detected.get("variants") or []
            except Exception:
                payload.setdefault("lspKotlinAndroidVariants", [])

            return payload
        except Exception:
            return {
                "enableLsp": False,
                "enableLspPyright": False,
                "enableLspTypescript": False,
                "enableLspClangd": False,
                "enableLspKotlin": False,
                "enableLspKotlinAndroid": False,
                "lspPyrightConfigMode": "root",
                "lspRootRelPyright": "",
                "lspRootRelTypescript": "",
                "lspRootRelClangd": "",
                "lspRootRelKotlin": "",
                "lspRootRelKotlinAndroid": "",
                "lspKotlinAndroidModule": "app",
                "lspKotlinAndroidVariant": "GeckoDebug",
                "lspKotlinAndroidVariants": [],
            }

    def _touch_project_locked(self, path: str) -> Dict[str, object]:
        # path is assumed to be normalized by caller
        projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
        project_entry = projects.get(path)
        if not project_entry:
            project_entry = {"files": [], "last_file": None}
        else:
            project_entry.setdefault("files", [])
            project_entry.setdefault("last_file", None)
            project_entry.setdefault("diff_base", "HEAD")
        project_entry.setdefault("diff_base", "HEAD")
        project_entry["label"] = _project_label(path)
        timestamp = _utc_timestamp()
        project_entry["opened_at"] = timestamp
        projects[path] = project_entry

        recent: List[Dict[str, object]] = self._data.setdefault("recent_projects", [])
        recent = [entry for entry in recent if entry.get("path") != path]
        recent.insert(
            0,
            {
                "path": path,
                "label": project_entry["label"],
                "opened_at": timestamp,
            },
        )
        self._data["recent_projects"] = recent[:MAX_RECENT_PROJECTS]
        return project_entry

    def _normalize_file_path(self, file_path: str) -> str:
        try:
            return str(Path(file_path).expanduser().resolve(strict=False))
        except Exception:
            return file_path

    # ----- session cache helpers (new) ---------------------------------------

    def _normalize_cache_key(self, project_path: str, file_path: str) -> str:
        """Generate normalized cache key for session storage."""
        try:
            norm_project = str(Path(project_path).expanduser().resolve(strict=False))
            norm_file = str(Path(file_path).expanduser().resolve(strict=False))
            combined = f"{norm_project}::{norm_file}"
            return hashlib.sha1(combined.encode('utf-8')).hexdigest()
        except Exception:
            combined = f"{project_path}::{file_path}"
            return hashlib.sha1(combined.encode('utf-8')).hexdigest()

    def _get_sidecar_path(self, cache_key: str) -> Path:
        return self._session_cache_dir / f"{cache_key}.json"

    def _write_sidecar(self, cache_key: str, entry: Dict[str, object]) -> None:
        """Atomically write a session cache entry to a sidecar file."""
        final_path = self._get_sidecar_path(cache_key)
        try:
            with tempfile.NamedTemporaryFile(
                mode='w',
                encoding='utf-8',
                dir=self._session_cache_dir,
                delete=False,
                prefix=f"{cache_key}.",
                suffix=".tmp"
            ) as tmp_file:
                tmp_path = Path(tmp_file.name)
                json.dump(entry, tmp_file, ensure_ascii=False, indent=2)
                tmp_file.flush()
                os.fsync(tmp_file.fileno())
            
            os.replace(tmp_path, final_path)
        finally:
            if 'tmp_path' in locals() and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def _read_sidecar(self, cache_key: str) -> Optional[Dict[str, object]]:
        """Read a session cache entry from its sidecar file."""
        sidecar_path = self._get_sidecar_path(cache_key)
        if not sidecar_path.exists():
            return None
        try:
            content = sidecar_path.read_text(encoding='utf-8')
            return json.loads(content)
        except Exception:
            return None

    def _delete_sidecar(self, cache_key: str) -> None:
        """Delete a session cache sidecar file."""
        sidecar_path = self._get_sidecar_path(cache_key)
        sidecar_path.unlink(missing_ok=True)

    # ----- public API ----------------------------------------------------------

    def touch_project(self, project_path: str) -> Dict[str, object]:
        normalized = self._normalize_project_path(project_path)
        with self._lock:
            entry = self._touch_project_locked(normalized)
            self._save_locked()

        # Blanket invariant: every opened project gets an lspProjectId.
        try:
            sidecar = ProjectSidecar.load_or_create(normalized)
            sidecar.get_or_create_lsp_project_id()
            sidecar.save()
        except Exception:
            pass

        return {
            "path": normalized,
            "label": entry["label"],
            "opened_at": entry["opened_at"],
        }

    def touch_file(self, project_path: str, file_path: str) -> Dict[str, object]:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            files: List[Dict[str, object]] = project_entry.setdefault("files", [])
            files = [entry for entry in files if entry.get("path") != normalized_file]
            timestamp = _utc_timestamp()
            file_entry = {
                "path": normalized_file,
                "label": _project_label(normalized_file),
                "opened_at": timestamp,
            }
            files.insert(0, file_entry)
        project_entry["files"] = files[:MAX_RECENT_FILES]
        project_entry["last_file"] = normalized_file
        self._save_locked()
        return file_entry

    def remove_file(self, project_path: str, file_path: str) -> bool:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
            project_entry = projects.get(normalized_project)
            if not project_entry:
                return False
            files: List[Dict[str, object]] = project_entry.get("files") or []
            new_files = [entry for entry in files if entry.get("path") != normalized_file]
            if len(new_files) == len(files):
                return False
            project_entry["files"] = new_files
            if project_entry.get("last_file") == normalized_file:
                project_entry["last_file"] = new_files[0]["path"] if new_files else None
            self._save_locked()
            return True

    def clear_all_files(self, project_path: str) -> bool:
        """Clear all recent files for a project — delegates to sidecar."""
        normalized_project = self._normalize_project_path(project_path)
        
        # Clear in sidecar (SSOT)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            sidecar.clear_recent_files()
            sidecar.save()
        except Exception:
            pass
        
        # Mirror to history.json
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
            project_entry = projects.get(normalized_project)
            if not project_entry:
                return False
            project_entry["files"] = []
            project_entry["last_file"] = None
            self._save_locked()
            return True

    def list_projects(self) -> List[Dict[str, object]]:
        with self._lock:
            return list(self._data.get("recent_projects", []))

    def dump_raw(self) -> Dict[str, Any]:
        """Return the raw in-memory history store state (debug endpoint helper)."""
        with self._lock:
            data = self._data
        try:
            return json.loads(json.dumps(data, ensure_ascii=False, default=str))
        except Exception:
            # Best-effort fallback; callers should treat this as debug-only.
            return {"error": "failed_to_dump", "repr": repr(data)}

    def list_files(self, project_path: str) -> List[Dict[str, object]]:
        """List recent files for a project — sidecar is SSOT with lazy migration."""
        normalized_project = self._normalize_project_path(project_path)
        
        # Try sidecar first (SSOT)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            sidecar_files = sidecar.list_recent_files()
            
            # Lazy migration: if sidecar has no files but history does, seed it
            if not sidecar_files:
                with self._lock:
                    projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
                    entry = projects.get(normalized_project)
                    if entry:
                        legacy_files = entry.get("files") or []
                        legacy_last = entry.get("last_file")
                        if legacy_files:
                            # Migrate recent_files
                            for f in reversed(legacy_files):
                                if f.get("path"):
                                    sidecar.record_file_activity(f["path"])
                            # Ensure last_file is set
                            if legacy_last:
                                sidecar.set_last_file(legacy_last)
                            sidecar.save()
                            return sidecar.list_recent_files()
            return sidecar_files
        except Exception:
            pass
        
        # Fallback to history.json
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(normalized_project)
            if not entry:
                return []
            return list(entry.get("files") or [])

    def reset_project_history(self, project_path: str) -> bool:
        """Reset per-project history (files, last_file, diff_base, origin) without
        removing the project from the global recent list.

        This is used by debug tooling and future \"Clear Project State\" flows
        to treat an existing project as a fresh one while keeping it visible
        in the project picker. Also clears the sidecar's recent_files and last_file.
        """
        normalized = self._normalize_project_path(project_path)
        
        # Clear sidecar's recent files (SSOT)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized)
            sidecar.clear_recent_files()
            sidecar.set_diff_base("HEAD")
            sidecar.save()
        except Exception:
            pass
        
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
            entry = projects.get(normalized)
            if not entry:
                return False

            entry["files"] = []
            entry["last_file"] = None
            entry["diff_base"] = "HEAD"
            entry.pop("origin", None)
            self._save_locked()
            return True

    def remove_project(self, project_path: str) -> bool:
        """Remove a project from history (recent list + project metadata)."""
        normalized = self._normalize_project_path(project_path)
        with self._lock:
            changed = False

            projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
            if normalized in projects:
                del projects[normalized]
                changed = True

            recent: List[Dict[str, object]] = self._data.get("recent_projects", [])
            new_recent = [entry for entry in recent if entry.get("path") != normalized]
            if len(new_recent) != len(recent):
                self._data["recent_projects"] = new_recent
                changed = True

            if self._data.get("active_project") == normalized:
                self._data["active_project"] = None
                changed = True

            if changed:
                self._save_locked()
            return changed

    # ----- state helpers -------------------------------------------------------

    def set_active_project(self, project_path: Optional[str]) -> Optional[str]:
        normalized = self._normalize_project_path(project_path) if project_path else None
        with self._lock:
            if normalized:
                self._touch_project_locked(normalized)
            self._data["active_project"] = normalized
            self._save_locked()

        # Blanket invariant: every opened project gets an lspProjectId.
        if normalized:
            try:
                sidecar = ProjectSidecar.load_or_create(normalized)
                sidecar.get_or_create_lsp_project_id()
                sidecar.save()
            except Exception:
                pass

        return normalized

    def get_active_project(self) -> Optional[str]:
        with self._lock:
            return self._data.get("active_project")

    def set_terminal_shell_id(
        self, shell_id: Optional[str], project_path: Optional[str] = None
    ) -> Optional[str]:
        """Store the current terminal shell ID.

        New behavior: per-project SSOT via ProjectSidecar. If project_path is not
        provided, uses the active project. A legacy global slot is retained only
        for migration/fallback.
        """
        normalized_project = (
            self._normalize_project_path(project_path)
            if project_path
            else self.get_active_project()
        )

        if normalized_project:
            try:
                sidecar = ProjectSidecar.load_or_create(normalized_project)
                sidecar.set_terminal_shell_id(shell_id)
                sidecar.save()
            except Exception:
                pass
            # Clear legacy global value to avoid cross-project bleed.
            with self._lock:
                self._data["terminal_shell_id"] = None
                self._save_locked()
            return shell_id

        # No project context; fallback to legacy global storage.
        with self._lock:
            self._data["terminal_shell_id"] = shell_id
            self._save_locked()
            return shell_id

    def get_terminal_shell_id(
        self, project_path: Optional[str] = None
    ) -> Optional[str]:
        """Get the stored terminal shell ID.

        Prefers per-project sidecar (SSOT). If missing, lazily migrates any legacy
        global terminal_shell_id into the active project's sidecar.
        """
        normalized_project = (
            self._normalize_project_path(project_path)
            if project_path
            else self.get_active_project()
        )

        if normalized_project:
            try:
                sidecar = ProjectSidecar.load_or_create(normalized_project)
                sid = sidecar.get_terminal_shell_id()
                if sid:
                    return sid
            except Exception:
                sid = None

            # Lazy migration from legacy global slot.
            with self._lock:
                legacy = self._data.get("terminal_shell_id")
            if legacy:
                try:
                    sidecar = ProjectSidecar.load_or_create(normalized_project)
                    sidecar.set_terminal_shell_id(legacy)
                    sidecar.save()
                except Exception:
                    pass
                with self._lock:
                    self._data["terminal_shell_id"] = None
                    self._save_locked()
                return str(legacy)

        with self._lock:
            val = self._data.get("terminal_shell_id")
            return str(val) if val else None

    def set_last_file(self, project_path: str, file_path: Optional[str]) -> Optional[str]:
        """Set last opened file — delegates to sidecar as SSOT."""
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path) if file_path else None
        
        # Sidecar is SSOT
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            result = sidecar.set_last_file(normalized_file)
            if normalized_file:
                sidecar.record_file_activity(normalized_file)
            sidecar.save()
        except Exception:
            result = normalized_file
        
        # Mirror to history.json for compatibility
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["last_file"] = normalized_file
            if normalized_file:
                files: List[Dict[str, object]] = project_entry.setdefault("files", [])
                files = [entry for entry in files if entry.get("path") != normalized_file]
                timestamp = _utc_timestamp()
                files.insert(
                    0,
                    {
                        "path": normalized_file,
                        "label": _project_label(normalized_file),
                        "opened_at": timestamp,
                    },
                )
                project_entry["files"] = files[:MAX_RECENT_FILES]
            self._save_locked()
            return result

    def get_last_file(self, project_path: Optional[str]) -> Optional[str]:
        """Get last opened file — sidecar is SSOT with lazy migration from history."""
        if not project_path:
            return None
        normalized_project = self._normalize_project_path(project_path)
        
        # Try sidecar first (SSOT)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            sidecar_last = sidecar.get_last_file()
            
            # Lazy migration: if sidecar has no last_file but history does, seed it
            if sidecar_last is None:
                with self._lock:
                    projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
                    entry = projects.get(normalized_project)
                    if entry:
                        legacy_last = entry.get("last_file")
                        legacy_files = entry.get("files") or []
                        if legacy_last or legacy_files:
                            # Migrate last_file
                            if legacy_last:
                                sidecar.set_last_file(legacy_last)
                            # Migrate recent_files
                            for f in reversed(legacy_files):
                                if f.get("path"):
                                    sidecar.record_file_activity(f["path"])
                            sidecar.save()
                            return sidecar.get_last_file()
            return sidecar_last
        except Exception:
            pass
        
        # Fallback to history.json
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(normalized_project)
            if not entry:
                return None
            return entry.get("last_file")

    def set_diff_base(self, project_path: str, ref: Optional[str]) -> str:
        normalized_project = self._normalize_project_path(project_path)
        value = (ref or 'HEAD').strip() or 'HEAD'
        timestamp = datetime.utcnow().strftime('%H:%M:%S.%f')[:-3]
        _history_debug(f"[{timestamp}] [HistoryStore] set_diff_base project={normalized_project!r} ref={value!r}")

        # Persist diff base in the per-project sidecar first.
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            sidecar.set_diff_base(value)
            sidecar.save()
        except Exception:
            # Sidecar failures should not prevent history_store.json from updating.
            pass

        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["diff_base"] = value
            self._save_locked()
            return value

    def get_diff_base(self, project_path: Optional[str]) -> str:
        if not project_path:
            return 'HEAD'
        normalized_project = self._normalize_project_path(project_path)
        timestamp = datetime.utcnow().strftime('%H:%M:%S.%f')[:-3]
        # Prefer sidecar as the SSOT for diff base when available.
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            val = (sidecar.get_diff_base() or 'HEAD').strip() or 'HEAD'
            _history_debug(
                f"[{timestamp}] [HistoryStore] get_diff_base (sidecar) found {val!r} for {normalized_project!r}"
            )
            return val
        except Exception:
            pass

        # Fallback to historical data if sidecar is unavailable.
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(normalized_project)
            if not entry:
                _history_debug(f"[{timestamp}] [HistoryStore] get_diff_base entry NOT FOUND for {normalized_project!r}")
                return 'HEAD'
            val = (entry.get("diff_base") or 'HEAD').strip() or 'HEAD'
            _history_debug(f"[{timestamp}] [HistoryStore] get_diff_base (history) found {val!r} for {normalized_project!r}")
            return val

    def set_project_origin(self, project_path: str, origin: Optional[str]) -> None:
        normalized_project = self._normalize_project_path(project_path)
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["origin"] = origin
            self._save_locked()

    def get_project_origin(self, project_path: Optional[str]) -> Optional[str]:
        if not project_path:
            return None
        normalized_project = self._normalize_project_path(project_path)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(normalized_project)
            return entry.get("origin") if entry else None

    def record_file_activity(self, project_path: str, file_path: str, scroll_line: Optional[float] = None) -> Dict[str, object]:
        """Record file open — delegates to sidecar as SSOT, mirrors to history.json.
        
        Args:
            project_path: The project containing the file.
            file_path: The file being opened/accessed.
            scroll_line: Optional scroll position (line number) to persist for this file.
        """
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        
        # Sidecar is SSOT
        entry = None
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            entry = sidecar.record_file_activity(normalized_file, scroll_line=scroll_line)
            sidecar.save()
        except Exception:
            pass
        
        # Mirror to history.json for compatibility
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["last_file"] = normalized_file
            files: List[Dict[str, object]] = project_entry.setdefault("files", [])
            files = [e for e in files if e.get("path") != normalized_file]
            timestamp = _utc_timestamp()
            if entry is None:
                entry = {
                    "path": normalized_file,
                    "label": _project_label(normalized_file),
                    "opened_at": timestamp,
                }
            files.insert(0, entry)
            project_entry["files"] = files[:MAX_RECENT_FILES]
            self._save_locked()
            return entry

    def update_file_scroll_line(self, project_path: str, file_path: str, scroll_line: float) -> bool:
        """Update just the scroll_line for a file in the project's recent files.
        
        Returns True if the file was found and updated.
        """
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            updated = sidecar.update_file_scroll_line(file_path, scroll_line)
            if updated:
                sidecar.save()
            return updated
        except Exception:
            return False

    def get_file_scroll_line(self, project_path: str, file_path: str) -> Optional[float]:
        """Get the stored scroll_line for a specific file in a project."""
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            return sidecar.get_file_scroll_line(file_path)
        except Exception:
            return None

    @staticmethod
    def format_label(path: Optional[str]) -> str:
        if not path:
            return ""
        return _project_label(path)

    # ----- session state helpers ---------------------------------------------

    def get_session_state(self) -> Dict[str, object]:
        with self._lock:
            state = self._data.get("session_state") or {}
            return dict(state)

    def update_session_state(self, partial: Optional[Dict[str, object]]) -> Dict[str, object]:
        payload = partial or {}
        with self._lock:
            state: Dict[str, object] = self._data.setdefault("session_state", {})
            state.update(payload)
            state["updated_at"] = _utc_timestamp()
            self._save_locked()
            return dict(state)

    # ----- session cache public API (delegates to ProjectSidecar) -----------

    def get_cached_document(self, project_path: str, file_path: str) -> Optional[Dict[str, object]]:
        """Retrieve cached session for a document from the per-project sidecar."""
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            sidecar.reload()
            return sidecar.get_cached_document(file_path)
        except Exception:
            return None

    def upsert_cached_document(
        self,
        project_path: str,
        file_path: str,
        content: str,
        base_sha256: str,
        run_id: str,
        shell_id: str,
        shell_run_id: str,
        launcher_pid: int,
        worker_pid: int,
    ) -> Dict[str, object]:
        """Update or insert cached session entry via the per-project sidecar."""
        normalized_project = self._normalize_project_path(project_path)
        content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        unsaved = content_sha256 != base_sha256

        print(
            f"[HISTORY_STORE] upsert {file_path}: base={base_sha256} "
            f"content={content_sha256} unsaved={unsaved}",
            file=sys.stderr,
        )

        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            entry = sidecar.upsert_cached_document(
                file_path=file_path,
                content=content,
                base_sha256=base_sha256,
                run_id=run_id,
                shell_id=shell_id,
                shell_run_id=shell_run_id,
                launcher_pid=launcher_pid,
                worker_pid=worker_pid,
            )
            sidecar.save()
            try:
                idx = DraftIndexSidecar.load_or_create(normalized_project)
                idx.update_from_abs_file(entry.get("file_path") or file_path, unsaved=bool(entry.get("unsaved")))
            except Exception:
                # No disk access => drafts are treated as off.
                pass
            return dict(entry)
        except Exception:
            # Fall back to returning an in-memory representation only.
            entry = {
                "project_path": normalized_project,
                "file_path": self._normalize_file_path(file_path),
                "content": content,
                "content_length": len(content),
                "content_sha256": content_sha256,
                "base_sha256": base_sha256,
                "unsaved": unsaved,
                "run_id": run_id,
                "shell_id": shell_id,
                "shell_run_id": shell_run_id,
                "launcher_pid": launcher_pid,
                "worker_pid": worker_pid,
                "updated_at": _utc_timestamp(),
            }
            return dict(entry)

    def clear_cached_document(self, project_path: str, file_path: str) -> bool:
        """Remove cached session entry for a document from the per-project sidecar."""
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            existed = sidecar.clear_cached_document(file_path)
            if existed:
                sidecar.save()
                try:
                    idx = DraftIndexSidecar.load_or_create(normalized_project)
                    idx.remove_abs_file(file_path)
                except Exception:
                    pass
            return existed
        except Exception:
            return False

    def list_project_drafts(self, project_path: str) -> List[Dict[str, object]]:
        """List all cached drafts for the given project from its sidecar."""
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            # Reload from disk to pick up writes from the worker process
            # (explorer runs in the main process, drafts are written by the worker).
            sidecar.reload()
            return sidecar.list_project_drafts()
        except Exception:
            return []

    def list_cached_documents(self, project_path: Optional[str] = None) -> List[Dict[str, object]]:
        """List cached sessions (currently returns drafts for the given project)."""
        if not project_path:
            return []
        return self.list_project_drafts(project_path)

    def prune_clean_drafts(self, project_path: str) -> int:
        """Remove cached draft entries marked unsaved == False."""
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            removed = sidecar.prune_clean_drafts()
            if removed:
                sidecar.save()
            return removed
        except Exception:
            return 0
