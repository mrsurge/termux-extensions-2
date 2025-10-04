
# Targeted Edits for Universal Picker + File Explorer App

Apply the following **surgical edits** to your existing codebase.

---

## 1) Broaden non-root browse base in `app/main.py`

Make non-root browsing fluid across the entire Termux sandbox (`/data/data/com.termux/**`). In your `/api/browse` implementation, update the allowed base path logic:

```diff
- home_dir = os.path.expanduser('~')
- # Only allow under $HOME
- if not expanded.startswith(home_dir):
-     return jsonify({ "ok": False, "error": "Access denied" }), 403
+ home_dir = os.path.expanduser('~')
+ # Allow anywhere inside Termux sandbox as non-root
+ termux_base = os.path.abspath(os.path.join(home_dir, '..', '..'))
+ allow_outside = request.args.get('root', 'home') != 'home'  # 'home' | 'system'
+ if not allow_outside and not os.path.abspath(expanded).startswith(termux_base):
+     return jsonify({ "ok": False, "error": "Access denied" }), 403
```

Notes:
- When the frontend passes `root=home`, browsing is constrained under `/data/data/com.termux/**`.
- On `Access denied`, the picker retries with `root=system`, activating sudo-backed listing.

---

## 2) Picker root-mode toggle + New Folder in `app/static/js/file_picker.js`

Add a root-mode state flag, a ⚡ indicator in breadcrumbs, and a **New Folder** button. Example snippets to integrate (adjust selectors to your picker DOM):

**State + request:**
```js
// state.rootMode => false initially
const DEFAULT_START = '/data/data/com.termux/files/home';
state.rootMode = false;

async function requestBrowse(absPath, includeHidden) {
  const params = new URLSearchParams({
    path: absPath,
    hidden: includeHidden ? '1' : '0',
    root: state.rootMode ? 'system' : 'home'
  });
  const res = await fetch(`/api/browse?${params}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Browse failed');
  return data.data;
}
```

**Auto-escalation:**
```js
async function navigate(targetPath) {
  try {
    const entries = await requestBrowse(targetPath, prefs.showHidden);
    state.currentPath = targetPath;
    state.entries = entries;
    state.rootMode = !targetPath.startsWith('/data/data/com.termux');
    renderBreadcrumbs(targetPath);
    renderEntries(entries);
  } catch (e) {
    if ((e.message || '').includes('Access denied') && !state.rootMode) {
      state.rootMode = true;        // escalate once
      return navigate(targetPath);  // retry with root=system
    }
    teUI.toast(e.message || 'Browse failed');
  }
}
```

**Breadcrumb indicator:**
```js
function renderBreadcrumbs(path) {
  const crumbs = computeCrumbs(path);
  if (state.rootMode && crumbs.length) {
    crumbs[0].label = '⚡ /';
  }
  // ...render as before...
}
```

**New Folder button:**
```html
<!-- Add to picker footer toolbar -->
<button class="te-fp-btn-new-folder">New Folder</button>
```

```js
// Handler (uses /api/run_command; prefixes with sudo if outside sandbox)
elements.btnNew.addEventListener('click', async () => {
  const name = (prompt('New folder name:') || '').trim();
  if (!name) return;
  const target = joinPath(state.currentPath, name);
  const useRoot = !target.startsWith('/data/data/com.termux');
  const cmd = `${useRoot ? 'sudo ' : ''}mkdir -p "${target}"`;
  const res = await fetch('/api/run_command', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ command: cmd }) });
  const data = await res.json();
  if (!res.ok || !data.ok) return teUI.toast(data.error || 'Failed to create folder');
  teUI.toast(`Folder "${name}" created.`);
  navigate(state.currentPath);
});
```

---

## 3) Register the new full-page app

Create the folder `app/apps/file_explorer/` and add the three files provided:

- `manifest.json`
- `file_explorer.py`
- `main.js`

No core template changes are required; the framework auto-loads apps via manifest discovery.

---

## 4) Optional: retire the old explorer extension

If an older explorer exists under `app/extensions/<something>/`, remove or disable it so the new **File Explorer** appears as the canonical file manager.
```
