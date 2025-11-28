# app/apps/file_editor_cm6/explorer_helper.py

from __future__ import annotations
from pathlib import Path
import os
import stat
import subprocess
import time
import shutil
from typing import Dict, Iterable, Optional

from app.apps.file_editor_cm6.stores import _history_store

# Global project root for this app (default: HOME)
_PROJECT_ROOT = Path.home()
_GIT_STATUS_CACHE: Dict[str, dict] = {}
GIT_CACHE_TTL_SECONDS = 6.0

_STATUS_PRIORITY = (
    "conflict",
    "staged_modified",
    "deleted",
    "staged",
    "added",
    "modified",
    "renamed",
    "untracked",
    "ignored",
    "clean",
)


def _collect_project_draft_rel_paths(project_root: Path) -> set[str]:
    """Return set of relative file paths that currently have drafts."""
    try:
        drafts = _history_store.list_project_drafts(str(project_root))
    except Exception:
        return set()
    rel_paths: set[str] = set()
    for draft in drafts:
        file_path = draft.get("file_path")
        if not file_path:
            continue
        try:
            abs_path = Path(file_path).expanduser().resolve()
            rel_paths.add(str(abs_path.relative_to(project_root)))
        except Exception:
            continue
    return rel_paths


def set_project_root(path: str) -> Path:
    """Set the project root directory after validation."""
    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_dir():
        raise ValueError("project path must be an existing directory")
    global _PROJECT_ROOT
    _PROJECT_ROOT = p
    _prime_git_cache(_PROJECT_ROOT)
    return _PROJECT_ROOT


def get_project_root() -> Path:
    """Get the current project root directory."""
    return _PROJECT_ROOT


def list_dir(rel: str = '.') -> dict:
    """
    List directory contents relative to project root.

    Returns a dict suitable for UI rendering with:
    - cwd: current working directory relative to project root
    - entries: list of file/dir entries with metadata
    """
    root = get_project_root()
    draft_rel_paths = _collect_project_draft_rel_paths(root)
    base = (root / rel).resolve()

    # Security check: ensure path is within project root
    if not str(base).startswith(str(root.resolve())):
        raise ValueError("dir outside project root")

    if not base.exists() or not base.is_dir():
        raise ValueError("not a directory")

    entries = []
    status_map = _get_git_status_snapshot(root)

    with os.scandir(base) as it:
        for e in it:
            try:
                info = e.stat(follow_symlinks=False)
                mode = stat.S_IMODE(info.st_mode)
                ext = ''

                if e.is_file(follow_symlinks=False):
                    ext = Path(e.name).suffix.lstrip('.')

                rel_path = str((base / e.name).relative_to(root))
                kind = 'dir' if e.is_dir(follow_symlinks=False) else 'file'
                git_status = _derive_git_status(rel_path, kind, status_map)

                has_draft = rel_path in draft_rel_paths

                entries.append({
                    'name': e.name,
                    'rel': rel_path,
                    'kind': kind,
                    'mtime': int(info.st_mtime),
                    'size': int(info.st_size),
                    'mode': oct(mode),
                    'ext': ext,
                    'gitStatus': git_status,
                    'isExecutable': bool(mode & stat.S_IXUSR),
                    'isSymlink': e.is_symlink(),
                    'hasDraft': has_draft,
                })
            except Exception:
                # Skip files we can't access
                continue

    # Sort: directories first, then files, case-insensitive
    entries.sort(key=lambda x: (x['kind'] != 'dir', x['name'].lower()))

    return {
        'cwd': str(base.relative_to(root)) if base != root else '.',
        'entries': entries
    }


def mark_git_cache_dirty(project_root: Optional[Path] = None) -> None:
    """Marks the git status cache dirty so the next lookup refreshes."""
    if project_root is None:
        _GIT_STATUS_CACHE.clear()
        return
    key = _cache_key(project_root)
    entry = _GIT_STATUS_CACHE.get(key)
    if entry:
        entry['dirty'] = True


def _cache_key(root: Path) -> str:
    try:
        return str(root.resolve())
    except Exception:
        return str(root)


def _prime_git_cache(root: Path) -> None:
    """Preload git status for the given root."""
    try:
        _refresh_git_status(root)
    except Exception:
        # Non-git repositories or command failures should not block the UI
        pass


def _get_git_status_snapshot(root: Path) -> Dict[str, str]:
    key = _cache_key(root)
    entry = _GIT_STATUS_CACHE.get(key)
    now = time.time()
    if entry and not entry.get('dirty') and now - entry.get('timestamp', 0) < GIT_CACHE_TTL_SECONDS:
        return entry.get('status', {})
    try:
        status = _refresh_git_status(root)
    except Exception:
        status = {}
    return status


def _refresh_git_status(root: Path) -> Dict[str, str]:
    """Refresh the git status snapshot for the given root."""
    status = _collect_git_status(root)
    key = _cache_key(root)
    _GIT_STATUS_CACHE[key] = {
        'status': status,
        'timestamp': time.time(),
        'dirty': False,
    }
    return status


def _collect_git_status(root: Path) -> Dict[str, str]:
    """Collect git status information for files under root."""
    if not _is_git_repo(root):
        return {}

    try:
        result = subprocess.run(
            [
                'git',
                '-C',
                str(root),
                'status',
                '--porcelain=v1',
                '--ignored=matching',
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return {}

    if result.returncode != 0:
        return {}

    status_map: Dict[str, str] = {}
    for raw_line in result.stdout.splitlines():
        if not raw_line or len(raw_line) < 3:
            continue
        code = raw_line[:2]
        remainder = raw_line[3:]
        if ' -> ' in remainder:
            _, remainder = remainder.split(' -> ', 1)
        path = remainder.strip().replace('\\', '/')
        if not path:
            continue
        status_map[path] = _map_git_code(code)
    return status_map


def _map_git_code(code: str) -> str:
    if code == '??':
        return 'untracked'
    if code == '!!':
        return 'ignored'

    index_status = code[0]
    worktree_status = code[1]

    if 'U' in code or (index_status == 'A' and worktree_status == 'A'):
        return 'conflict'
    if index_status == 'D' or worktree_status == 'D':
        return 'deleted'
    if index_status == 'R':
        return 'renamed'
    if index_status == 'A':
        return 'added'
    if index_status != ' ' and worktree_status != ' ':
        return 'staged_modified'
    if index_status != ' ':
        return 'staged'
    if worktree_status != ' ':
        return 'modified'
    return 'clean'


def _derive_git_status(rel_path: str, kind: str, status_map: Dict[str, str]) -> str:
    if not rel_path:
        return status_map.get(rel_path, 'clean')

    if kind == 'file':
        return status_map.get(rel_path, 'clean')

    dir_status = status_map.get(rel_path)
    if dir_status and dir_status != 'clean':
        return dir_status

    child_statuses = _statuses_for_prefix(rel_path, status_map)
    if not child_statuses:
        return 'clean'
    return _select_highest_priority(child_statuses)


def _statuses_for_prefix(rel_path: str, status_map: Dict[str, str]) -> Iterable[str]:
    prefix = rel_path.rstrip('/') + '/'
    for path, status in status_map.items():
        if path == rel_path or path.startswith(prefix):
            yield status


def _select_highest_priority(statuses: Iterable[str]) -> str:
    seen = set(statuses)
    for status in _STATUS_PRIORITY:
        if status in seen:
            return status
    return 'clean'


def _is_git_repo(root: Path) -> bool:
    try:
        result = subprocess.run(
            ['git', '-C', str(root), 'rev-parse', '--is-inside-work-tree'],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return False
    return result.returncode == 0 and result.stdout.strip() == 'true'


def _normalize_rel_path(project_root: Path, raw_path: str) -> str:
    """Return a project-relative POSIX path or raise ValueError."""
    if not raw_path:
        raise ValueError("path required")

    candidate = Path(raw_path)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (project_root / candidate).resolve()

    project_root_resolved = project_root.resolve()
    if not str(resolved).startswith(str(project_root_resolved)):
        raise ValueError("Path outside project root")

    rel = resolved.relative_to(project_root_resolved)
    return rel.as_posix()

def create_directory(parent_rel: str, name: str) -> dict:
    """Create a new directory within parent_rel."""
    root = get_project_root()
    parent = (root / parent_rel).resolve()
    
    if not str(parent).startswith(str(root.resolve())):
        raise ValueError("parent outside project root")
    if not parent.is_dir():
        raise ValueError("parent is not a directory")
    
    new_dir = parent / name
    if new_dir.exists():
        raise ValueError(f"'{name}' already exists")
    
    new_dir.mkdir(parents=False, exist_ok=False)
    rel_path = str(new_dir.relative_to(root))
    return {'rel': rel_path, 'name': name}

def create_file(parent_rel: str, name: str) -> dict:
    """Create a new empty file within parent_rel."""
    root = get_project_root()
    parent = (root / parent_rel).resolve()
    
    if not str(parent).startswith(str(root.resolve())):
        raise ValueError("parent outside project root")
    if not parent.is_dir():
        raise ValueError("parent is not a directory")
    
    new_file = parent / name
    if new_file.exists():
        raise ValueError(f"'{name}' already exists")
    
    new_file.touch(exist_ok=False)
    rel_path = str(new_file.relative_to(root))
    return {'rel': rel_path, 'name': name}

def rename_entry(rel: str, new_name: str) -> dict:
    """Rename a file or directory to new_name within same parent."""
    root = get_project_root()
    old_path = (root / rel).resolve()
    
    if not str(old_path).startswith(str(root.resolve())):
        raise ValueError("path outside project root")
    if not old_path.exists():
        raise ValueError("path does not exist")
    
    parent = old_path.parent
    new_path = parent / new_name
    
    if new_path.exists():
        raise ValueError(f"'{new_name}' already exists")
    
    old_path.rename(new_path)
    new_rel = str(new_path.relative_to(root))
    return {'old_rel': rel, 'new_rel': new_rel, 'new_name': new_name}

def delete_entry(rel: str) -> dict:
    """Delete a file or directory."""
    root = get_project_root()
    target = (root / rel).resolve()
    
    if not str(target).startswith(str(root.resolve())):
        raise ValueError("path outside project root")
    if not target.exists():
        raise ValueError("path does not exist")
    
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    
    return {'rel': rel, 'deleted': True}

def batch_delete(rels: list[str]) -> dict:
    """Delete multiple entries."""
    results = []
    for rel in rels:
        try:
            result = delete_entry(rel)
            results.append({'rel': rel, 'ok': True, 'result': result})
        except Exception as e:
            results.append({'rel': rel, 'ok': False, 'error': str(e)})
    return {'results': results}

def copy_entry(rel: str, dest_dir_path: str) -> dict:
    """Copy file/dir from rel to dest_dir_path."""
    root = get_project_root()
    source = (root / rel).resolve()
    dest_dir = Path(dest_dir_path).resolve()
    
    if not str(source).startswith(str(root.resolve())):
        raise ValueError("source outside project root")
    if not source.exists():
        raise ValueError("source does not exist")
    
    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")
    
    if source.is_dir():
        shutil.copytree(source, dest)
    else:
        shutil.copy2(source, dest)
    
    return {'source_rel': rel, 'dest_path': str(dest)}

def move_entry(rel: str, dest_dir_path: str) -> dict:
    """Move file/dir from rel to dest_dir_path."""
    root = get_project_root()
    source = (root / rel).resolve()
    dest_dir = Path(dest_dir_path).resolve()
    
    if not str(source).startswith(str(root.resolve())):
        raise ValueError("source outside project root")
    if not source.exists():
        raise ValueError("source does not exist")
    
    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")
    
    shutil.move(str(source), str(dest))
    
    new_rel = str(dest.relative_to(root)) if str(dest).startswith(str(root)) else None
    return {'old_rel': rel, 'new_path': str(dest), 'new_rel': new_rel}

def batch_copy(rels: list[str], dest_dir_path: str) -> dict:
    """Copy multiple entries to dest_dir_path."""
    results = []
    for rel in rels:
        try:
            result = copy_entry(rel, dest_dir_path)
            results.append({'rel': rel, 'ok': True, 'result': result})
        except Exception as e:
            results.append({'rel': rel, 'ok': False, 'error': str(e)})
    return {'results': results}

def batch_move(rels: list[str], dest_dir_path: str) -> dict:
    """Move multiple entries to dest_dir_path."""
    results = []
    for rel in rels:
        try:
            result = move_entry(rel, dest_dir_path)
            results.append({'rel': rel, 'ok': True, 'result': result})
        except Exception as e:
            results.append({'rel': rel, 'ok': False, 'error': str(e)})
    return {'results': results}

def create_project(parent_path_str: str, name: str) -> dict:
    """Create a new project directory."""
    if not name or not name.strip():
        raise ValueError("Project name cannot be empty")

    parent_path = Path(parent_path_str).expanduser().resolve()

    if not parent_path.is_dir():
        raise ValueError("Parent path is not a valid directory.")

    new_project_path = parent_path / name
    if new_project_path.exists():
        raise ValueError(f"Directory '{name}' already exists in the selected location.")

    new_project_path.mkdir(parents=True, exist_ok=False)
    
    # Optional: Add boilerplate files here if needed
    # (new_project_path / "README.md").write_text("# My New Project")

    return {'path': str(new_project_path)}

# --- Inbound Operations (Importing) ---
# These functions are specifically for "Copy From" / "Move From" operations where
# the source is an absolute path (potentially outside the project) and the
# destination is strictly inside the project root.

def copy_entry_inbound(abs_source: str, dest_rel: str) -> dict:
    """
    Copy a file or directory from an absolute path (external) INTO the project.
    Source can be anywhere; Destination must be inside project root.
    """
    root = get_project_root()
    source = Path(abs_source).resolve()
    dest_dir = (root / dest_rel).resolve()

    if not source.exists():
        raise ValueError(f"Source path does not exist: {abs_source}")

    # Enforce destination is inside project root
    if not str(dest_dir).startswith(str(root.resolve())):
        raise ValueError("Destination is outside project root")
    
    if not dest_dir.is_dir():
        raise ValueError("Destination is not a directory")

    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")

    if source.is_dir():
        shutil.copytree(source, dest)
    else:
        shutil.copy2(source, dest)

    new_rel = str(dest.relative_to(root))
    return {'source_path': str(source), 'dest_rel': new_rel}


def move_entry_inbound(abs_source: str, dest_rel: str) -> dict:
    """
    Move a file or directory from an absolute path (external) INTO the project.
    Source can be anywhere; Destination must be inside project root.
    """
    root = get_project_root()
    source = Path(abs_source).resolve()
    dest_dir = (root / dest_rel).resolve()

    if not source.exists():
        raise ValueError(f"Source path does not exist: {abs_source}")

    # Enforce destination is inside project root
    if not str(dest_dir).startswith(str(root.resolve())):
        raise ValueError("Destination is outside project root")
    
    if not dest_dir.is_dir():
        raise ValueError("Destination is not a directory")

    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")

    shutil.move(str(source), str(dest))

    new_rel = str(dest.relative_to(root))
    return {'source_path': str(source), 'dest_rel': new_rel}
