# CM6 — Open Project + Explorer Drawer (Agent Instructions + Stubs)

> **Scope ONLY:** Open Project logic (with per‑project recent files) and File Explorer Drawer (collapsible tree). Put drawer logic into **new helpers**: one JS and one Python. Do not touch editor, autosave, WS, or anything else.

Relevant existing hooks to use (already in your app): the toolbar has **Browse** and **Recent Files** UI (ids `#fe-browse`, `#recent-files-btn`, `#recent-files-dd`)
— see template lines with those IDs. The backend already exposes **per‑project recent files** endpoints bound to the current project root (get/touch/remove).

---

## 0) New files (create exactly)
- `app/apps/file_editor_cm6/explorer_helper.py`  
- `app/apps/file_editor_cm6/static/js/explorer.js` (or import from `main.js` via `import './static/js/explorer.js'`)

---

## 1) Minimal DOM additions in `template.html` (drawer only)
Insert once, as a sibling of the editor container. Keep all existing elements.

```html
<aside id="fe-drawer" class="fe-drawer" hidden>
  <header class="fe-drawer-head">
    <strong>Project:</strong>
    <span id="fe-project-label"></span>
    <button id="fe-drawer-close" class="fe-btn">Close</button>
  </header>
  <div class="fe-drawer-body">
    <ul id="fe-file-tree" class="fe-tree" data-project=""></ul>
  </div>
</aside>
```

**IDs used by JS:** `fe-browse`, `recent-files-btn`, `recent-files-dd`, `fe-drawer`, `fe-drawer-close`, `fe-project-label`, `fe-file-tree`.

---

## 2) Backend: add EXACT routes to `main.py`

Add imports at top:
```py
from .explorer_helper import set_project_root, get_project_root, list_dir
from .history_store import HistoryStore
```

Add/keep a single `HistoryStore` and the project root:
```py
_history_store = HistoryStore()
```

### 2.1 Open Project
```py
@file_editor_cm6_bp.post('/project/open')
def project_open():
    data = request.get_json(silent=True) or {}
    path = (data.get('path') or '').strip()
    if not path:
        return jsonify({"ok": False, "error": "path required"}), 400
    try:
        abs_path = set_project_root(path)   # validates and sets global project root
        _history_store.touch_project(str(abs_path))
        return jsonify({"ok": True, "data": {"path": str(abs_path)}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400
```

### 2.2 Current Project
```py
@file_editor_cm6_bp.get('/project/current')
def project_current():
    root = get_project_root()
    return jsonify({"ok": True, "data": {"path": str(root)}})
```

### 2.3 List Directory (for drawer)
```py
@file_editor_cm6_bp.get('/explorer/list')
def explorer_list():
    rel = request.args.get('dir', '.')
    try:
        return jsonify({"ok": True, "data": list_dir(rel)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400
```

> Reuse existing endpoints for per‑project recent files (already present):
> - `GET /history/files` (list for current project)
> - `POST /history/touch` (add a file for current project)
> - `DELETE /history/file` (remove from current project)

---

## 3) `explorer_helper.py` (create)
A tiny helper to centralize project root and directory enumeration.

```py
from __future__ import annotations
from pathlib import Path
import os, stat, time

# Global project root for this app (default: HOME)
_PROJECT_ROOT = Path.home()

def set_project_root(path: str) -> Path:
    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_dir():
        raise ValueError("project path must be an existing directory")
    global _PROJECT_ROOT
    _PROJECT_ROOT = p
    return _PROJECT_ROOT

def get_project_root() -> Path:
    return _PROJECT_ROOT

# Return a dict suitable for UI rendering of a directory listing
# rel can be '.' or a path relative to project root

def list_dir(rel: str = '.') -> dict:
    root = get_project_root()
    base = (root / rel).resolve()
    if not str(base).startswith(str(root.resolve())):
        raise ValueError("dir outside project root")
    if not base.exists() or not base.is_dir():
        raise ValueError("not a directory")

    entries = []
    with os.scandir(base) as it:
        for e in it:
            try:
                info = e.stat(follow_symlinks=False)
                mode = stat.S_IMODE(info.st_mode)
                ext = ''
                if e.is_file(follow_symlinks=False):
                    ext = Path(e.name).suffix.lstrip('.')
                entries.append({
                    'name': e.name,
                    'rel': str((base / e.name).relative_to(root)),
                    'kind': 'dir' if e.is_dir(follow_symlinks=False) else 'file',
                    'mtime': int(info.st_mtime),
                    'size': int(info.st_size),
                    'mode': oct(mode),
                    'ext': ext,
                })
            except Exception:
                continue

    # Sort: dirs first, then files, case-insensitive
    entries.sort(key=lambda x: (x['kind'] != 'dir', x['name'].lower()))
    return { 'cwd': str(base.relative_to(root)), 'entries': entries }
```

---

## 4) `static/js/explorer.js` (create)
Owns drawer open/close, project selection, per‑project recent list dropdown, and tree rendering. Import from `main.js`.

```js
// explorer.js
let currentProjectPath = '';

export async function initExplorerUI() {
  const btnBrowse = document.getElementById('fe-browse');
  const ddBtn = document.getElementById('recent-files-btn');
  const dd = document.getElementById('recent-files-dd');
  const drawer = document.getElementById('fe-drawer');
  const drawerClose = document.getElementById('fe-drawer-close');
  const treeEl = document.getElementById('fe-file-tree');

  await refreshCurrentProject();
  await renderRecentMenu();
  renderTreeRoot(treeEl);

  btnBrowse?.addEventListener('click', openProjectPrompt);
  ddBtn?.addEventListener('click', () => dd.classList.toggle('show'));
  drawerClose?.addEventListener('click', () => drawer.setAttribute('hidden', ''));
  document.getElementById('fe-drawer-open')?.addEventListener('click', () => drawer.removeAttribute('hidden'));

  treeEl?.addEventListener('click', onTreeClick);
}

async function refreshCurrentProject() {
  const r = await fetch('project/current');
  const j = await r.json();
  currentProjectPath = j?.data?.path || '';
  document.getElementById('fe-project-label').textContent = currentProjectPath || '(none)';
}

async function openProjectPrompt() {
  const p = prompt('Enter project directory path'); // simple prompt; can replace with native picker later
  if (!p) return;
  const r = await fetch('project/open', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: p })});
  const j = await r.json();
  if (j?.ok) { location.reload(); }
}

async function renderRecentMenu() {
  const dd = document.getElementById('recent-files-dd');
  dd.innerHTML = '';
  const r = await fetch('history/files');
  const j = await r.json();
  (j?.data || []).forEach(entry => {
    const div = document.createElement('div');
    div.className = 'fe-dd-item';
    div.textContent = entry.label;
    div.title = entry.path;
    div.addEventListener('click', () => openFile(entry.path));
    const x = document.createElement('button');
    x.textContent = '×';
    x.className = 'fe-btn';
    x.addEventListener('click', (e) => { e.stopPropagation(); removeRecent(entry.path); div.remove(); });
    div.appendChild(x);
    dd.appendChild(div);
  });
  document.getElementById('recent-files-btn').disabled = false;
}

async function removeRecent(path) {
  const u = new URL('history/file', location.href);
  u.searchParams.set('path', path);
  await fetch(u, { method: 'DELETE' });
}

function renderTreeRoot(treeEl) {
  treeEl.replaceChildren();
  addTreeChildren(treeEl, '.');
}

async function addTreeChildren(parentEl, rel) {
  const u = new URL('explorer/list', location.href);
  u.searchParams.set('dir', rel);
  const r = await fetch(u);
  const j = await r.json();
  const entries = j?.data?.entries || [];
  entries.forEach(e => {
    const li = document.createElement('li');
    li.className = 'node';
    li.dataset.kind = e.kind;
    li.dataset.rel = e.rel;
    li.innerHTML = `<button class="twisty"></button><span class="text"></span>`;
    li.querySelector('.text').textContent = e.name;
    parentEl.appendChild(li);
  });
}

async function onTreeClick(ev) {
  const li = ev.target.closest('li.node');
  if (!li) return;
  const rel = li.dataset.rel;
  if (li.dataset.kind === 'dir') {
    if (li.dataset.open === 'true') {
      li.dataset.open = 'false';
      [...li.querySelectorAll(':scope > ul')].forEach(ul => ul.remove());
    } else {
      li.dataset.open = 'true';
      const ul = document.createElement('ul');
      li.appendChild(ul);
      await addTreeChildren(ul, rel);
    }
  } else {
    openFileRel(rel);
  }
}

// The editor already has an open-file function; call into it.
function openFile(absPath) { window.appOpenFile?.(absPath); }
function openFileRel(rel) { window.appOpenFileRel?.(rel); }
```

> **Integration note:** In `main.js`, call `import { initExplorerUI } from './static/js/explorer.js'; initExplorerUI();` after the editor bootstraps and global `appOpenFile/appOpenFileRel` shims are assigned.

---

## 5) Done criteria
1) Clicking **Browse** posts `/project/open` and reloads; recent list now shows only files for that project.  
2) **Recent Files** dropdown lists per‑project files; clicking opens; × removes.  
3) Clicking **Explorer** button reveals the drawer; directories expand/collapse; clicking a file opens it via the editor hook.  
4) No other app behavior changed.

