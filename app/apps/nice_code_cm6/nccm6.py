"""NiceGUI UI bootstrap for Code CM6."""

import os
from pathlib import Path

from nicegui import ui

from .core.layout_manager import LayoutManager
from .core.module_loader import load_native_modules
from .helpers.explorer_backend import get_explorer_state, set_project_root
from .helpers.state_store import StateStore

# MAIN ENTRY POINT FOR NICE CODE CM6 UI SETUP.
# CENTRALIZE APP BOOTSTRAP, SERVICE WIRING, AND PROJECT ROOT HERE.
# THIS IS THE SINGLE SOURCE OF TRUTH FOR THE PROJECT ROOT.


def build_ui(context) -> None:
    """Populate the shared shell container with the composed layout.
    
    This is the entry point - it reads the project root from disk (StateStore)
    and passes it to all modules. Nothing else should read the project root.
    """
    # Initialize state store
    state_store = StateStore()
    
    # Read project root from disk (SINGLE SOURCE OF TRUTH)
    stored_root = state_store.get_value("project", "root")
    if stored_root:
        project_root = Path(stored_root).expanduser().resolve()
    else:
        project_root = Path(os.getcwd()).resolve()
    
    # Validate project root exists
    if not project_root.exists() or not project_root.is_dir():
        project_root = Path(os.getcwd()).resolve()
    
    # Sync legacy backend helper to match our ground truth
    set_project_root(str(project_root))
    
    # Bind explorer state
    get_explorer_state().bind(project_root, state_store)

    # Load and render modules
    manager = LayoutManager([])
    modules = load_native_modules(
        layout_manager=manager,
        project_root=project_root,
        state_store=state_store,
    )
    manager.modules = modules
    manager.render(
        header_container=context.header_app,
        body_container=context.body,
    )

    # Wire orchestrator for project switching and recents
    editor_module = next((m for m in modules if getattr(m, 'key', None) == 'editor'), None)
    explorer_module = next((m for m in modules if getattr(m, 'key', None) == 'explorer'), None)
    file_header_module = next((m for m in modules if getattr(m, 'key', None) == 'file_header'), None)
    if editor_module and explorer_module:
        global _orchestrator
        _orchestrator = _Orchestrator(state_store, explorer_module, editor_module, file_header_module)


# ------------------------------ Orchestrator and helpers
_orchestrator = None


def get_orchestrator():
    if _orchestrator is None:
        raise RuntimeError('Orchestrator not initialized')
    return _orchestrator


class _Orchestrator:
    def __init__(self, state_store, explorer, editor, file_header=None) -> None:
        self._state_store = state_store
        self._explorer = explorer
        self._editor = editor
        self._file_header = file_header
        self._base_dir = Path.home() / '.cache' / 'te-framework' / 'nice_code_cm6'
        self._projects_dir = self._base_dir / 'projects'
        self._projects_dir.mkdir(parents=True, exist_ok=True)

    def _project_id(self, root: Path) -> str:
        import hashlib
        return hashlib.sha1(str(root.resolve()).encode('utf-8')).hexdigest()[:12]

    def _sidecar_path(self, proj_id: str) -> Path:
        return self._projects_dir / f'{proj_id}.json'

    def _load_sidecar(self, proj_id: str) -> dict:
        p = self._sidecar_path(proj_id)
        if not p.exists():
            return {}
        try:
            import json
            return json.loads(p.read_text(encoding='utf-8'))
        except Exception:
            return {}

    def _save_sidecar(self, proj_id: str, payload: dict) -> None:
        import json
        p = self._sidecar_path(proj_id)
        tmp = p.with_suffix(p.suffix + '.tmp')
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        tmp.replace(p)

    def _update_global_recent_projects(self, proj_id: str, root: Path) -> None:
        projects = self._state_store.get_section('projects', {})
        recent = list(projects.get('recent', []))
        recent = [pid for pid in recent if pid != proj_id]
        recent.insert(0, proj_id)
        projects['recent'] = recent[:20]
        index = dict(projects.get('index', {}))
        index[proj_id] = str(root)
        projects['index'] = index
        projects['last_project'] = proj_id
        self._state_store.update_section('projects', projects)

    def open_project(self, path_like: str | Path) -> Path:
        root = Path(path_like).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise FileNotFoundError(f'Project root not found or not a directory: {path_like}')

        # Persist as current project in global store and legacy helper
        self._state_store.set_value('project', 'root', str(root))
        set_project_root(str(root))

        # Update global recents
        proj_id = self._project_id(root)
        self._update_global_recent_projects(proj_id, root)

        # Touch/update sidecar
        sidecar = self._load_sidecar(proj_id)
        sidecar.setdefault('id', proj_id)
        sidecar['path'] = str(root)
        sidecar['display_name'] = root.name
        sidecar.setdefault('recents', [])
        sidecar.setdefault('last_file', None)
        sidecar.setdefault('git_cache', {})
        self._save_sidecar(proj_id, sidecar)

        # Sync explorer and UI
        try:
            if getattr(self._explorer, 'state', None):
                self._explorer.state.set_project(str(root))
        except Exception:
            pass
        try:
            self._explorer.reload_for_new_project()
        except Exception:
            pass
        if self._file_header and hasattr(self._file_header, 'update_project_label'):
            try:
                self._file_header.update_project_label()
            except Exception:
                pass

        # Point editor at new project and open MRU (or blank if first-time)
        try:
            self._editor.project_root = root
        except Exception:
            pass
        last_rel = sidecar.get('last_file')
        if last_rel:
            try:
                self._editor.open_file(last_rel)
            except Exception:
                pass
        else:
            try:
                self._editor.open_blank()
            except Exception:
                pass
        return root

    def record_file_open(self, rel_path: str) -> None:
        try:
            root = Path(self._explorer.state.get_project())
        except Exception:
            stored = self._state_store.get_value('project', 'root')
            root = Path(stored).expanduser().resolve() if stored else Path.cwd()
        proj_id = self._project_id(root)
        sidecar = self._load_sidecar(proj_id)
        rel_norm = rel_path.replace('\\', '/')
        recents = [p for p in sidecar.get('recents', []) if p != rel_norm]
        recents.insert(0, rel_norm)
        sidecar['recents'] = recents[:50]
        sidecar['last_file'] = rel_norm
        sidecar['path'] = str(root)
        sidecar.setdefault('display_name', root.name)
        self._save_sidecar(proj_id, sidecar)

