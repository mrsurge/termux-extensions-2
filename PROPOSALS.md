# Proposals and Design Notes

Author: SESSIONS_AGENT (Sessions & Shortcuts)
Date: 2025-09-11

This document collects improvement proposals. Items are scoped to avoid breaking existing UI or logic; changes favor incremental adoption and clear separation between extension-local enhancements and framework-level utilities.

## Sessions & Shortcuts (This Extension)

### 1) Modal Utilities: Module-Safe, No Global Assumptions
- Usefulness: Prevents subtle failures when modules run in strict mode; easier testing and reuse.
- Principle: Keep local helpers in-module and expose only the minimal surface needed for inline HTML compatibility.
- Snippet (pattern we now follow):
```js
// main.js — local helpers
const openModal = (modalId, sid) => {
  if (sid != null) currentSessionId = sid;
  const el = document.getElementById(modalId);
  if (el) el.style.display = 'block';
};
const closeModal = (modalId) => {
  const el = document.getElementById(modalId);
  if (el) el.style.display = 'none';
};
// expose for template onclicks without relying on globals elsewhere
window.closeModal = closeModal;
window.openModal = openModal;
```

### 2) Context Propagation: Session-Aware Actions Without Hidden State
- Usefulness: Reduces reliance on mutable globals like `currentSessionId`; actions become self-describing and resilient.
- Heuristic: Prefer passing `sid` through DOM dataset attributes and function parameters.
- Snippet:
```js
// When building a menu, keep sid attached to actionable elements
sessionEl.querySelectorAll('.menu-item').forEach(item => {
  item.dataset.sid = session.sid;
});

// When handling an action, read from event target
const sid = target.closest('.menu-item')?.dataset.sid || currentSessionId;
openModal('shortcut-modal', sid);
```

### 3) Error Surfacing: Preserve Backend Messages
- Usefulness: Users can diagnose why a run failed (permissions, missing file, etc.).
- Principle: Always parse JSON error bodies; show a concise message.
- Snippet (fetch wrapper pattern):
```js
async function apiCall(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || JSON.stringify(j); } catch {}
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// usage in extension
api.post(`sessions/${sid}/shortcut`, { path })
  .then(() => notify('Shortcut queued'))
  .catch(err => toast(`Failed: ${err.message}`));
```

### 4) Shortcut List UX: Search, Sort, and Group
- Usefulness: Scales when `~/.shortcuts` contains many items; faster selection.
- Heuristics:
  - Local, client-side search over name/path.
  - Sort by last-used frequency (persist a small LRU in `localStorage`).
  - Group by top-level folder.
- Snippet (LRU update):
```js
function bumpUsage(shortcutPath) {
  const key = 'te.shortcut.usage';
  const map = JSON.parse(localStorage.getItem(key) || '{}');
  map[shortcutPath] = (map[shortcutPath] || 0) + 1;
  localStorage.setItem(key, JSON.stringify(map));
}
```

### 5) Run Feedback: Non-Blocking Confirmation
- Usefulness: Confirms action without modal churn; avoids duplicate submissions.
- Principle: Optimistic UI with a toast and temporary disabled state.
- Snippet:
```js
runBtn.disabled = true;
api.post(`sessions/${sid}/shortcut`, { path })
  .then(() => toast('Shortcut sent'))
  .finally(() => { runBtn.disabled = false; closeModal('shortcut-modal'); });
```

### 6) Optional Output Peek: Tail Recent Output
- Usefulness: Quick feedback to confirm a command ran (when sessions log to a known file or support attach).
- Approach: Offer a non-default “Show recent output” toggle that tries to tail a pre-agreed log (if available) or uses a future streaming API (see framework proposals).
- Guardrails: Disabled by default to avoid perf hits and privacy concerns; explicit user action required.

### 7) Confirmation Context: Rich Kill Dialog
- Usefulness: Prevents accidental termination by showing context (cwd, uptime).
- Heuristic: If metadata exposes these values, include them; otherwise fall back to current minimal confirm.
- Snippet (UI only, optional):
```js
if (confirm(`Kill session ${sid} (cwd: ${session.cwd})?`)) {
  api.delete(`sessions/${sid}`).then(refreshSessions);
}
```

### 8) Accessibility & Keyboard Navigation
- Usefulness: Better mobile screen-reader support and power-user flow.
- Principles: Focus trap within modals, `Esc` to close, ARIA labels.
- Snippet (focus trap skeleton):
```js
function trapFocus(modal) {
  const foci = modal.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])');
  // add keydown handler to cycle focus
}
```

## Framework-Level Proposals

### A) Shared UI Primitives: Modal and Toast Manager
- Usefulness: Reduces duplication; standardizes UX across extensions.
- Guideline: Provide a tiny, dependency-free module exposed by the core page that extensions can call.
- Snippet (interface sketch):
```js
// window.teUI
const teUI = {
  modal: { open(id, ctx), close(id) },
  toast: (msg, opts = {}) => { /* position, type, timeout */ },
};
```

### B) Fetch Wrapper With Consistent Error Envelope
- Usefulness: Single place to parse JSON, map errors, add CSRF headers if needed.
- Backend Guideline: Always return `{ ok: boolean, error?: string, data?: any }`.
- Frontend Snippet:
```js
async function teFetch(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `${res.status}`);
  return body.data ?? body; // backwards compatible
}
```

### C) Extension Event Bus
- Usefulness: Enables cross-extension features without tight coupling (e.g., Sessions opens Shortcut Wizard to edit a script).
- API: `teBus.on(event, fn)`, `teBus.emit(event, payload)`.
- Snippet:
```js
const teBus = (() => { const m = new Map();
  return {
    on: (e, f) => (m.has(e) ? m.get(e).push(f) : m.set(e, [f])),
    emit: (e, p) => (m.get(e) || []).forEach(f => f(p)),
  };
})();
window.teBus = teBus;
```

### D) Typed Extension SDK (JSDoc/TS Types)
- Usefulness: Autocomplete and safer refactors without adding a build step.
- Principle: Ship `.d.ts` or JSDoc typedefs for the API object given to extensions.
- Snippet:
```js
/** @typedef {{ get:(e:string)=>Promise<any>, post:(e:string,b:any)=>Promise<any>, delete:(e:string)=>Promise<any> }} ExtApi */
/** @param {HTMLElement} container @param {ExtApi} api */
export default function init(container, api) { /* ... */ }
```

### E) Optional Streaming: SSE/WebSocket for Session Output
- Usefulness: Live feedback for long-running commands without polling.
- Backend Sketch (Flask + SSE):
```python
@app.route('/api/stream/<sid>')
def stream(sid):
    def gen():
        yield 'data: {"ready": true}\n\n'
        # tail -f or dtach attach read loop
    return Response(gen(), mimetype='text/event-stream')
```
- Frontend Sketch:
```js
const es = new EventSource(`/api/stream/${sid}`);
es.onmessage = (e) => appendOutput(JSON.parse(e.data));
```

## Cross-Extension Ideas

### 1) Sessions ↔ Shortcut Wizard Deep Link
- Usefulness: Quickly jump from selecting a shortcut to editing it if it fails.
- Flow: Sessions emits `shortcut:edit` with a path; Shortcut Wizard listens and opens the editor preloaded with that script.
- Snippet:
```js
// Sessions
teBus.emit('shortcut:edit', { path });
// Shortcut Wizard
teBus.on('shortcut:edit', ({ path }) => openEditorWith(path));
```

### 2) PATH Executable Picker as Shared Utility
- Usefulness: Reuse across Wizard and other extensions.
- Guideline: Implement once in core or as a tiny helper extension that exposes a modal via `teBus`.

### 3) Safety Guard for Executing Scripts
- Usefulness: Avoid accidental execution outside trusted directories.
- Heuristic: If a selected file is outside `~/.shortcuts`, show a warning and require confirmation; allow whitelist in settings.
- Snippet (client-side guard):
```js
function isSafeShortcut(p) {
  return p.startsWith(`${HOME}/.shortcuts/`);
}
```

## Adoption Plan (Incremental)

1. Introduce fetch wrapper and toast utility locally in Sessions & Shortcuts.
2. Add search + LRU sort in shortcut modal (no API changes).
3. Publish a minimal `teBus` in the core page; wire optional cross-extension actions.
4. Standardize error envelope in backend responses (non-breaking if we keep current fields).
5. Explore optional SSE endpoint for live output, guarded by a feature flag.

---

## System Stats (This Extension)
Author: SYSTEM_STATS_AGENT (System Stats)
Date: 2025-09-11

Title: Robust IP display, root-aware CPU, and client→server error logging

- Usefulness/Necessity:
  - Prevent brittle parsing from breaking the module loader (e.g., Unexpected token ':' from nested awk strings).
  - Provide accurate CPU under root via su when available; display root availability clearly.
  - Improve IP UX on mobile: show one IP at a time with its interface, tap to cycle, long-press to copy only the IP.
  - Surface client-side errors to server logs for faster diagnosis without attaching a debugger.

- Guiding Principles:
  - Prefer JS-side parsing over complex shell quoting in strings sent to /api/run_command.
  - Defensive parsing against BusyBox vs. proc variants; clamp UI values to [0, 100].
  - Non-blocking, failure-isolated UI updates (one metric failing does not blank others).
  - Progressive enhancement: detect su once, then use when beneficial.

- Logic & Heuristics:
  - Root detection: id -u; if not 0, check if su -c id -u returns 0. If yes, mark “Available via su” and use su for CPU collection.
  - CPU parsing: extract idle percent from lines matching 'CPU:' or '%Cpu(s):', usage = 100 - idle. Fallback to first percentage.
  - Memory parsing: from 'Mem:' line (free/busybox free), usage = used/total.
  - IP collection strategy (no awk in JS strings):
    1) ip -o -4 addr show | parse with regex in JS.
    2) ifconfig | parse iface blocks + inet lines.
    3) hostname -I tokens | treat as bare IPs.
    4) Fallback route inference: ip route get 1 | extract dev and src.
    - Deduplicate by iface|ip; exclude loopback/docker/veth; IPv6 optional.
  - UX: ip tile shows {iface, ip}; click cycles; long-press copies ip only.

- Code Snippets:
  - Root detection:
    ```js
    async function detectRootAndSu() {
      const uid = (await runCommand('id -u')).trim();
      const suUid = (await runCommand('command -v su >/dev/null 2>&1 && su -c id -u 2>/dev/null || echo ""')).trim();
      suRootAvailable = suUid === '0';
      // update UI: Yes (uid 0) | Available via su | No
    }
```
  - CPU via su when available:
    ```js
    let cmd = 'top -bn1 2>/dev/null | head -n 5 || top -n 1 | head -n 5';
    const out = await runCommand(suRootAvailable ? `su -c "${cmd}"` : cmd);
    const usage = parseCpuUsage(out);
    ```
  - IP collection (JS regex parsing):
    ```js
    async function collectIpEntries() {
      const entries = [];
      try {
        const raw = await runCommand('ip -o -4 addr show 2>/dev/null || busybox ip -o -4 addr show 2>/dev/null || true');
        raw.split('\n').forEach(line => {
          const m = line.trim().match(/^\d+:\s*([^\s]+)\s+inet\s+([0-9.]+)\//);
          if (m) { const iface = m[1].replace(/:$/, ''); const ip = m[2];
            if (ip !== '127.0.0.1' && !/^lo$/.test(iface) && !/^docker|^veth/.test(iface)) entries.push({ iface, ip }); }
        });
      } catch(_) {}
      // ifconfig, hostname -I, and route fallbacks similar; then dedup and return
      return dedup(entries);
    }
    ```
  - Long-press copy:
    ```js
    tile.addEventListener('mousedown', start);
    tile.addEventListener('touchstart', start, { passive: true });
    function start(){ pressTimer = setTimeout(() => navigator.clipboard.writeText(currentIp), 600); }
    ```

- Error Logging to Server (Framework addition recommended):
  - Endpoint:
    ```python
    @app.route('/api/log_client_error', methods=['POST'])
    def log_client_error():
        data = request.get_json(force=True, silent=True) or {}
        print(f"[CLIENT-ERROR] ext={data.get('ext')} where={data.get('where')} msg={data.get('message')}\nstack={data.get('stack')}", flush=True)
        return ('', 204)
    ```
  - Loader integration (safe parse + log on import failure):
    ```js
    let savedOrder = null;
    try{ savedOrder = JSON.parse(localStorage.getItem('extensionOrder')||'null'); }
    catch{ localStorage.removeItem('extensionOrder'); }
    try { const module = await import(scriptPath); module.default(extContainer, api); }
    catch(e) {
      fetch('/api/log_client_error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ext:ext.name,where:'import',message:e.message,stack:e.stack})});
    }
    ```

- Rollout (Incremental):
  1) Land IP parsing rewrite in System Stats (JS-parsed outputs).
  2) Add root detection and optional su-path for CPU.
  3) Ship tap/long-press IP UX.
  4) Add logging endpoint and safe loader parse.

---

## Framework & Other Extensions (General)
Author: SYSTEM_STATS_AGENT
Date: 2025-09-11

Title: Client Error Telemetry + Safer Loader

- Usefulness: Captures module import/runtime failures across all extensions; debug without device inspector.
- Principle: Logging must be best-effort and non-fatal; never block UI.
- Snippets: As shown above in Error Logging to Server.

Title: Extension SDK Utilities (Bus, Toast, Fetch)

- Usefulness: Accelerates consistent UX and error handling; fewer bespoke patterns within each extension.
- Principles: Dependency-free, exposed globally (`window.teBus`, `window.teUI.toast`, `window.teFetch`).
- Snippets: See Framework-Level Proposals A–C in this file.

Title: Defensive Parsing Guidelines

- Usefulness: Eliminate class of “Unexpected token” errors originating from nested shell quoting inside JS string literals.
- Guideline: Avoid embedding awk/sed scripts into JS strings passed to `/api/run_command`. Prefer:
  1) Run a simpler command (e.g., `ip -o -4 addr show`).
  2) Parse in JS with regex/string ops.
  3) Chain multiple smaller commands sequentially from JS instead of with `||` pipelines inside a single quoted string.


All proposals are opt-in and aim to maintain current UI structure and user flows while improving robustness, UX, and extensibility.

---

## Shortcut Wizard (This Extension)
Author: SHORTCUT_WIZARD_AGENT (Shortcut Wizard)
Date: 2025-09-11

Title: Pipeline UI, Simple Editor, PATH Picker, and Robustness

- Why
  - Clarify pipe vs. newline and reduce user error when composing scripts.
  - Provide a lightweight raw editor for non-wizard scripts scoped to ~/.shortcuts.
  - Improve mobile UX for choosing commands via a PATH picker with good perceived performance.
  - Ensure reliable metadata and a smooth path from legacy single-command format.

- Guiding Principles
  - Piping is explicit: users choose “Add Pipe (|)” vs “Add New Command” (newline).
  - Apply environment variables once at the start of the script, not per line.
  - Use Core APIs for enumeration; keep extension read/write limited to ~/.shortcuts.
  - Progressive enhancement with graceful fallbacks and safe defaults.

### 1) Pipeline Builder: Explicit Connectors (+ Reorder)
- Usefulness: Avoids confusion between adding a command vs. piping; prepares for reordering.
- Logic
  - Each block has `pipe_to_next: boolean`.
  - Payload: `commands: [{ command, args, pipe_to_next }]`.
  - Backend groups segments into lines; `pipe_to_next` joins with `|`, otherwise starts a new line. Env vars prefix the first line only.
- Snippets
  - Client connector:
    ```js
    function setConnectorAfter(wrapper, type) { // 'pipe' | 'block'
      wrapper.dataset.pipeToNext = (type === 'pipe') ? 'true' : 'false';
      // render dashed “|” for pipe; faint solid rule for newline
    }
    ```
  - Server line builder:
    ```python
    command_lines = []
    current_line, prev_pipe = None, False
    for block in commands_payload:
        seg = f"{block['command']} {build_args_str(block.get('args'))}".strip()
        if current_line is None:
            current_line = seg
        elif prev_pipe:
            current_line = f"{current_line} | {seg}"
        else:
            command_lines.append(current_line)
            current_line = seg
        prev_pipe = bool(block.get('pipe_to_next'))
    if current_line: command_lines.append(current_line)
    if env_vars_str: command_lines[0] = f"{env_vars_str} {command_lines[0]}".strip()
    ```
- Heuristics
  - Guard against dangling pipe on the last block.
  - When reordering, move connector with the “from” block.

### 2) Simple Raw Editor: Scoped Read/Write
- Usefulness: View/edit non-wizard scripts without the full wizard parsing.
- Logic
  - `GET /api/ext/shortcut_wizard/read_raw?path=...` and `POST /api/ext/shortcut_wizard/save_raw` operate only within `~/.shortcuts`.
  - “New Raw Script” opens textarea + filename; saves to `~/.shortcuts/<file>`.
- Snippet
  ```python
  p = os.path.abspath(path)
  if not p.startswith(os.path.abspath(SHORTCUTS_DIR) + os.sep):
      return jsonify({'error':'Access denied.'}), 403
  ```

### 3) PATH Executable Picker: Loading-first UX
- Usefulness: Smooth mobile UX even if enumeration is slow; simple filtering.
- Logic
  - `$` opens a Loading modal, then shows the PATH picker once `/api/list_path_executables` returns.
  - Picker filters by name/path on the client.
  - Core endpoint should dedupe and optionally cache.
- Snippet
  ```js
  openModal('loading-modal');
  fetch('/api/list_path_executables')
    .then(r=>r.json()).then(items=>{ render(items); closeModal('loading-modal'); openModal('path-exec-modal'); })
    .catch(()=>{ showError(); closeModal('loading-modal'); openModal('path-exec-modal'); });
  ```

### 4) Metadata Migration
- Usefulness: Backwards compatibility for legacy `command/args` sidecars.
- Logic
  - On load, map legacy fields to a single block with `pipe_to_next: false`.
  - Save in new `commands[]` format.

### 5) Validation & UX Polish (Follow-ups)
- Filename validation (no spaces, default `.sh`).
- Disallow save if last block has `pipe_to_next: true`.
- Debounce PATH search; remember last browser directory; toasts instead of alerts.

---

Accomplishments (Shortcut Wizard)
- Multi-command editor with explicit pipe vs. newline control and visual connectors.
- Backend `/create` accepts `commands[]` and generates multi-line scripts with proper piping; env vars applied once.
- File browser wired to `GET /api/browse`; basic Up nav client-side.
- Simple editor with `read_raw`/`save_raw` for `~/.shortcuts`; “New Raw Script” in main view.
- PATH picker UI with loading modal; consumes `GET /api/list_path_executables`.
- Input UX: lowercase-first-word on filename, command, arg-option.

Short Examples
- Save payload (pipe on first line, then newline):
  ```json
  {
    "filename":"example.sh",
    "shebang":true,
    "env_vars":{"FOO":"bar"},
    "commands":[
      {"command":"cat","args":[{"value":"file.txt"}],"pipe_to_next":true},
      {"command":"grep","args":[{"value":"foo"}],"pipe_to_next":false},
      {"command":"wc","args":[{"option":"-l"}],"pipe_to_next":false}
    ]
  }
  ```
- Generated script:
  ```bash
  #!/data/data/com.termux/files/usr/bin/bash
  # Generated by Termux Extensions Shortcut Wizard v1.3

  FOO="bar" cat "file.txt" | grep "foo"
  wc -l
  ```

Follow-up TODOs
- Implement command block reordering with connector preservation.
- Add filename and pipe validation; replace alerts with toasts.
- Core: finalize `/api/list_path_executables` with search/dedupe/cache; enhance `/api/browse` parent handling and optional metadata.
