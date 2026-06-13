from __future__ import annotations

import json
import threading
import os
import sys
import hashlib
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeAlias, cast

from .project_sidecar import ProjectSidecar
from .draft_index_sidecar import DraftIndexSidecar

MAX_RECENT_PROJECTS = 12
MAX_RECENT_FILES = 12

JsonDict: TypeAlias = dict[str, object]
ProjectMap: TypeAlias = dict[str, JsonDict]
EntryList: TypeAlias = list[JsonDict]


def _as_dict(value: object) -> JsonDict:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items() if isinstance(key, str)}


def _as_project_map(value: object) -> ProjectMap:
    raw = _as_dict(value)
    out: ProjectMap = {}
    for key, item in raw.items():
        out[key] = _as_dict(item)
    return out


def _as_entry_list(value: object) -> EntryList:
    if not isinstance(value, list):
        return []
    out: EntryList = []
    for item in cast(list[object], value):
        entry = _as_dict(item)
        if entry:
            out.append(entry)
    return out


def _as_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _default_lsp_state_payload() -> JsonDict:
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


_HISTORY_DEBUG = os.getenv("TE2_HISTORY_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}


def _history_debug(msg: str) -> None:
    if not _HISTORY_DEBUG:
        return
    try:
        print(msg)
    except Exception:
        pass


def _utc_timestamp() -> str:
    return datetime.now(UTC).replace(tzinfo=None).isoformat() + "Z"


def _debug_timestamp() -> str:
    return datetime.now(UTC).strftime('%H:%M:%S.%f')[:-3]


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

    def __init__(self, storage_path: Path | None = None) -> None:
        default_root = Path.home() / ".local" / "share" / "termux-extensions-2"
        default_root.mkdir(parents=True, exist_ok=True)
        self._path = storage_path or (default_root / "code_oss_history.json")
        self._session_cache_dir = Path.home() / ".cache" / "cm6_sessions"
        self._session_cache_dir.mkdir(parents=True, exist_ok=True)

        _ensure_dir(self._path)
        self._lock = threading.Lock()
        self._data: JsonDict = {
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
            decoded = cast(object, json.loads(content))
            if isinstance(decoded, dict):
                data = _as_dict(cast(object, decoded))
                self._data["recent_projects"] = _as_entry_list(data.get("recent_projects"))
                projects = _as_project_map(data.get("projects"))
                self._data["projects"] = projects
                self._data["active_project"] = data.get("active_project")
                self._data["session_state"] = _as_dict(data.get("session_state"))
                # Session cache is primarily stored in sidecars, but we can load keys here
                self._data["session_cache"] = _as_project_map(data.get("session_cache"))
                self._data["terminal_shell_id"] = data.get("terminal_shell_id")
                for entry in projects.values():
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
                session_cache = _as_project_map(self._data.get("session_cache"))
                data_to_save["session_cache"] = {k: {"updated_at": v.get("updated_at")} for k, v in session_cache.items()}

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

    def get_project_sidecar(self, project_path: str) -> ProjectSidecar | None:
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
            text = str(root_rel).strip()
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

    def get_lsp_state_payload(self, project_path: str) -> JsonDict:
        """Return the view_state payload fields for the LSP modal."""

        sidecar = self.get_project_sidecar(project_path)
        if not sidecar:
            return _default_lsp_state_payload()
        try:
            payload = dict(sidecar.get_lsp_state_payload())
            payload.setdefault("lspKotlinAndroidVariants", [])

            return payload
        except Exception:
            return _default_lsp_state_payload()

    def _touch_project_locked(self, path: str) -> JsonDict:
        # path is assumed to be normalized by caller
        projects = _as_project_map(self._data.get("projects"))
        project_entry = projects.get(path)
        if not project_entry:
            project_entry = cast(JsonDict, {"files": [], "last_file": None})
        else:
            if "files" not in project_entry:
                project_entry["files"] = []
            if "last_file" not in project_entry:
                project_entry["last_file"] = None
            if "diff_base" not in project_entry:
                project_entry["diff_base"] = "HEAD"
        project_entry["label"] = _project_label(path)
        timestamp = _utc_timestamp()
        project_entry["opened_at"] = timestamp
        projects[path] = project_entry
        self._data["projects"] = projects

        recent = _as_entry_list(self._data.get("recent_projects"))
        recent = [entry for entry in recent if entry.get("path") != path]
        recent.insert(
            0,
            cast(JsonDict, {
                "path": path,
                "label": project_entry["label"],
                "opened_at": timestamp,
            }),
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

    def _write_sidecar(self, cache_key: str, entry: JsonDict) -> None:
        """Atomically write a session cache entry to a sidecar file."""
        final_path = self._get_sidecar_path(cache_key)
        tmp_path: Path | None = None
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
            if tmp_path is not None and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def _read_sidecar(self, cache_key: str) -> JsonDict | None:
        """Read a session cache entry from its sidecar file."""
        sidecar_path = self._get_sidecar_path(cache_key)
        if not sidecar_path.exists():
            return None
        try:
            content = sidecar_path.read_text(encoding='utf-8')
            decoded = cast(object, json.loads(content))
            return _as_dict(decoded)
        except Exception:
            return None

    def _delete_sidecar(self, cache_key: str) -> None:
        """Delete a session cache sidecar file."""
        sidecar_path = self._get_sidecar_path(cache_key)
        sidecar_path.unlink(missing_ok=True)

    # ----- public API ----------------------------------------------------------

    def touch_project(self, project_path: str) -> JsonDict:
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

        return cast(JsonDict, {
            "path": normalized,
            "label": entry["label"],
            "opened_at": entry["opened_at"],
        })

    def touch_file(self, project_path: str, file_path: str) -> JsonDict:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            files = _as_entry_list(project_entry.get("files"))
            files = [entry for entry in files if entry.get("path") != normalized_file]
            timestamp = _utc_timestamp()
            file_entry = cast(JsonDict, {
                "path": normalized_file,
                "label": _project_label(normalized_file),
                "opened_at": timestamp,
            })
            files.insert(0, file_entry)
        project_entry["files"] = files[:MAX_RECENT_FILES]
        project_entry["last_file"] = normalized_file
        self._save_locked()
        return file_entry

    def remove_file(self, project_path: str, file_path: str) -> bool:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            projects = _as_project_map(self._data.get("projects"))
            project_entry = projects.get(normalized_project)
            if not project_entry:
                return False
            files = _as_entry_list(project_entry.get("files"))
            new_files = [entry for entry in files if entry.get("path") != normalized_file]
            if len(new_files) == len(files):
                return False
            project_entry["files"] = new_files
            if project_entry.get("last_file") == normalized_file:
                project_entry["last_file"] = new_files[0]["path"] if new_files else None
            projects[normalized_project] = project_entry
            self._data["projects"] = projects
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
            projects = _as_project_map(self._data.get("projects"))
            project_entry = projects.get(normalized_project)
            if not project_entry:
                return False
            project_entry["files"] = []
            project_entry["last_file"] = None
            projects[normalized_project] = project_entry
            self._data["projects"] = projects
            self._save_locked()
            return True

    def list_projects(self) -> EntryList:
        with self._lock:
            return [dict(entry) for entry in _as_entry_list(self._data.get("recent_projects"))]

    def dump_raw(self) -> JsonDict:
        """Return the raw in-memory history store state (debug endpoint helper)."""
        with self._lock:
            data = self._data
        try:
            decoded = cast(object, json.loads(json.dumps(data, ensure_ascii=False, default=str)))
            return _as_dict(decoded)
        except Exception:
            # Best-effort fallback; callers should treat this as debug-only.
            return {"error": "failed_to_dump", "repr": repr(data)}

    def list_files(self, project_path: str) -> EntryList:
        """List recent files for a project from the sidecar only."""
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            sidecar.reload()
            sidecar_files = sidecar.list_recent_files()
            return sidecar_files
        except Exception:
            return []

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
            projects = _as_project_map(self._data.get("projects"))
            entry = projects.get(normalized)
            if not entry:
                return False

            entry["files"] = []
            entry["last_file"] = None
            entry["diff_base"] = "HEAD"
            entry.pop("origin", None)
            projects[normalized] = entry
            self._data["projects"] = projects
            self._save_locked()
            return True

    def remove_project(self, project_path: str) -> bool:
        """Remove a project from history (recent list + project metadata)."""
        normalized = self._normalize_project_path(project_path)
        with self._lock:
            changed = False

            projects = _as_project_map(self._data.get("projects"))
            if normalized in projects:
                del projects[normalized]
                self._data["projects"] = projects
                changed = True

            recent = _as_entry_list(self._data.get("recent_projects"))
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

    def set_active_project(self, project_path: str | None) -> str | None:
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

    def get_active_project(self) -> str | None:
        with self._lock:
            return _as_str(self._data.get("active_project"))

    def set_terminal_shell_id(
        self, shell_id: str | None, project_path: str | None = None
    ) -> str | None:
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
        self, project_path: str | None = None
    ) -> str | None:
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
                legacy = _as_str(self._data.get("terminal_shell_id"))
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

    def set_last_file(self, project_path: str, file_path: str | None) -> str | None:
        """Set last opened file in the project sidecar only."""
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path) if file_path else None

        sidecar = ProjectSidecar.load_or_create(normalized_project)
        result = sidecar.set_last_file(normalized_file)
        if normalized_file:
            sidecar.record_file_activity(normalized_file)
        sidecar.save()
        with self._lock:
            self._touch_project_locked(normalized_project)
            self._save_locked()
        return result

    def get_last_file(self, project_path: str | None) -> str | None:
        """Get last opened file from the project sidecar only."""
        if not project_path:
            return None
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            sidecar.reload()
            sidecar_last = sidecar.get_last_file()
            return str(sidecar_last) if sidecar_last else None
        except Exception:
            return None

    def set_diff_base(self, project_path: str, ref: str | None) -> str:
        normalized_project = self._normalize_project_path(project_path)
        value = (ref or 'HEAD').strip() or 'HEAD'
        timestamp = _debug_timestamp()
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

    def get_diff_base(self, project_path: str | None) -> str:
        if not project_path:
            return 'HEAD'
        normalized_project = self._normalize_project_path(project_path)
        timestamp = _debug_timestamp()
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
            projects = _as_project_map(self._data.get("projects"))
            entry = projects.get(normalized_project)
            if not entry:
                _history_debug(f"[{timestamp}] [HistoryStore] get_diff_base entry NOT FOUND for {normalized_project!r}")
                return 'HEAD'
            raw_val = entry.get("diff_base")
            val = (raw_val if isinstance(raw_val, str) else 'HEAD').strip() or 'HEAD'
            _history_debug(f"[{timestamp}] [HistoryStore] get_diff_base (history) found {val!r} for {normalized_project!r}")
            return val

    def set_project_origin(self, project_path: str, origin: str | None) -> None:
        normalized_project = self._normalize_project_path(project_path)
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["origin"] = origin
            self._save_locked()

    def get_project_origin(self, project_path: str | None) -> str | None:
        if not project_path:
            return None
        normalized_project = self._normalize_project_path(project_path)
        with self._lock:
            projects = _as_project_map(self._data.get("projects"))
            entry = projects.get(normalized_project)
            return _as_str(entry.get("origin")) if entry else None

    def record_file_activity(self, project_path: str, file_path: str, scroll_line: float | None = None) -> JsonDict:
        """Record file activity in the sidecar; history stores project recency only.
        
        Args:
            project_path: The project containing the file.
            file_path: The file being opened/accessed.
            scroll_line: Optional scroll position (line number) to persist for this file.
        """
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        entry = sidecar.record_file_activity(normalized_file, scroll_line=scroll_line)
        sidecar.save()
        with self._lock:
            self._touch_project_locked(normalized_project)
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

    def get_file_scroll_line(self, project_path: str, file_path: str) -> float | None:
        """Get the stored scroll_line for a specific file in a project."""
        normalized_project = self._normalize_project_path(project_path)
        try:
            sidecar = ProjectSidecar.load_or_create(normalized_project)
            return sidecar.get_file_scroll_line(file_path)
        except Exception:
            return None

    @staticmethod
    def format_label(path: str | None) -> str:
        if not path:
            return ""
        return _project_label(path)

    # ----- session state helpers ---------------------------------------------

    def get_session_state(self) -> JsonDict:
        with self._lock:
            return _as_dict(self._data.get("session_state"))

    def update_session_state(self, partial: JsonDict | None) -> JsonDict:
        payload = partial or {}
        with self._lock:
            state = _as_dict(self._data.get("session_state"))
            state.update(payload)
            state["updated_at"] = _utc_timestamp()
            self._data["session_state"] = state
            self._save_locked()
            return dict(state)

    # ----- session cache public API (delegates to ProjectSidecar) -----------

    def get_cached_document(self, project_path: str, file_path: str) -> JsonDict | None:
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
    ) -> JsonDict:
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
                entry_file_path = _as_str(entry.get("file_path")) or file_path
                idx.update_from_abs_file(entry_file_path, unsaved=bool(entry.get("unsaved")))
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

    def list_project_drafts(self, project_path: str) -> EntryList:
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

    def list_cached_documents(self, project_path: str | None = None) -> EntryList:
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
