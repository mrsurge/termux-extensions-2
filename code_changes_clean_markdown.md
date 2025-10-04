# Code Changes

This document reformats the prior diff-style notes into clean, readable Markdown without changing core content.

---

## 1) Remove Run Mode Toggle & Update UI (`app/apps/termux_lm/template.html`)

**Goal:** Delete the non‑functional “Run Mode” (chat/interpreter) radio toggle. Add two new buttons to the Shell Status panel—**Start Interpreter Server** and **Open Interpreter Chat**—plus a status line for the interpreter server.

### What to remove
Delete the entire **Run Mode** section from the template:

```html
<section class="tlm-section tlm-runmode" data-role="runmode">
  <div class="tlm-section-header">
    <div>
      <h2 class="tlm-section-title">Run Mode</h2>
      <p class="tlm-section-hint">Pick how the active model should run when a session starts.</p>
    </div>
  </div>
  <div class="tlm-runmode-options">
    <label class="tlm-radio">
      <input type="radio" name="run-mode" value="chat" checked>
      <span>Chat Interface</span>
    </label>
    <label class="tlm-radio">
      <input type="radio" name="run-mode" value="open_interpreter">
      <span>Open Interpreter (placeholder)</span>
    </label>
  </div>
</section>
```

### What to add (Shell Status panel)
Below the existing **Start Chat** button, add:

```html
<button class="tlm-btn primary tlm-btn-wide" data-action="start-interpreter">
  Start Interpreter Server
</button>

<button class="tlm-btn tlm-btn-wide" data-action="open-interpreter">
  Open Interpreter Chat
</button>

<div class="tlm-status" data-role="oi-status">
  <span class="tlm-status-dot" data-status="idle"></span>
  Open Interpreter Inactive
</div>
```

**Notes:**
- Uses existing button styles (`tlm-btn`).
- “Start Interpreter Server” is primary (full width); “Open Interpreter Chat” is secondary.
- The status line shows a grey dot when inactive and green when running.

---

## 2) Frontend Logic (`app/apps/termux_lm/main.js`)

**Add references, events, and polling for interpreter status.**

### Map new elements
Add to your element map (example):

```js
const els = {
  // existing mappings…
  startChatButton: container.querySelector('[data-action="start-chat"]'),
  startInterpreterButton: container.querySelector('[data-action="start-interpreter"]'),
  openInterpreterButton: container.querySelector('[data-action="open-interpreter"]'),
  shellStdout: container.querySelector('[data-role="shell-stdout"]'),
  shellStderr: container.querySelector('[data-role="shell-stderr"]'),
  // …
  oiStatus: container.querySelector('[data-role="oi-status"]'),
};
```

### Bind events

```js
if (els.startChatButton) {
  els.startChatButton.addEventListener('click', handleStartChat);
}
if (els.startInterpreterButton) {
  els.startInterpreterButton.addEventListener('click', handleStartInterpreter);
}
if (els.openInterpreterButton) {
  els.openInterpreterButton.addEventListener('click', () => {
    window.location.href = '/apps/oi_console/';
  });
}
```

### Start‑interpreter handler

```js
async function handleStartInterpreter() {
  const model = getModel(state.activeModelId);
  if (!model) {
    host.toast?.('Load a model before starting the interpreter');
    return;
  }
  if (!isModelReady(model)) {
    host.toast?.('Model is still loading');
    return;
  }
  try {
    await API.post(api, 'interpreter/start', {});
    host.toast?.('Interpreter server started');
    updateOIStatus(); // immediate refresh
  } catch (err) {
    host.toast?.(err.message || 'Failed to start interpreter');
  }
}
```

### Live status polling
Poll framework shells and reflect status. Enable **Open Interpreter Chat** only when a server is running.

```js
async function updateOIStatus() {
  if (!els.oiStatus) return;
  try {
    const resp = await fetch('/api/framework_shells');
    const shellsData = await resp.json();

    let statusHTML = '<span class="tlm-status-dot" data-status="idle"></span> Open Interpreter Inactive';
    let enableChat = false;

    if (shellsData && shellsData.ok !== false && Array.isArray(shellsData.data)) {
      const shells = shellsData.data;
      const oiShells = shells.filter(sh => sh.label?.startsWith('oi_console:') && sh.stats?.alive);
      if (oiShells.length > 0) {
        const shell = oiShells[0];
        const pid = shell.pid || shell.stats?.pid;

        const cpuVal = (typeof shell.stats?.cpu_percent === 'number')
          ? shell.stats.cpu_percent
          : (typeof shell.stats?.cpu === 'number' ? shell.stats.cpu : null);
        const cpuStr = (cpuVal !== null) ? `${cpuVal.toFixed(1)}% CPU` : '';

        const rssBytes = shell.stats?.memory_rss ?? shell.stats?.rss_bytes ?? 0;
        let memStr = '';
        if (rssBytes > 0) {
          const mbytes = rssBytes / (1024 * 1024);
          memStr = (mbytes >= 1024)
            ? `${(mbytes/1024).toFixed(1)} GB`
            : (mbytes >= 10 ? `${Math.round(mbytes)} MB` : `${mbytes.toFixed(1)} MB`);
          memStr += ' RAM';
        }

        const stateText = shell.status ? (shell.status[0].toUpperCase() + shell.status.slice(1)) : 'Running';
        statusHTML = `<span class="tlm-status-dot" data-status="active"></span> Open Interpreter ${stateText} – PID ${pid}${cpuStr ? `, ${cpuStr}` : ''}${memStr ? `, ${memStr}` : ''}`;
        enableChat = true;
      }
    }

    els.oiStatus.innerHTML = statusHTML;
    if (els.openInterpreterButton) {
      els.openInterpreterButton.disabled = !enableChat;
    }
  } catch (err) {
    console.warn('termux-lm: failed to update interpreter status', err);
  }
}
```

### Add to the existing refresh loop

```js
function startAutoRefresh() {
  const timer = setInterval(() => {
    refreshState()
      .then(() => {
        renderModelCards();
        updateShellLogs();
        updateOIStatus();
      })
      .catch((err) => console.debug('termux-lm: refresh tick failed', err));
  }, 6000);
}
```

---

## 3) Backend Support (`app/apps/termux_lm/backend.py`)

**Add a new route** `POST /interpreter/start` to launch the Open Interpreter server using the current model’s configuration. The shell is labeled `oi_console:<model-id>` so the frontend can detect it.

```python
@termux_lm_bp.route("/interpreter/start", methods=["POST"])
def start_interpreter() -> Any:
    manager = get_framework_shell_manager()
    state = _load_state()
    model_id = state.get("active_model_id")
    if not model_id:
        return jsonify({"ok": False, "error": "No model loaded"}), 400

    model = _load_model(model_id)
    if not model:
        return jsonify({"ok": False, "error": "Active model not found"}), 404

    # Determine base URL for OpenAI-compatible API
    if model.get("type") == "remote":
        endpoint = (model.get("endpoint") or "").strip().rstrip('/')
        if not endpoint:
            return jsonify({"ok": False, "error": "Remote model missing endpoint"}), 400
        if endpoint.lower().endswith('/chat/completions'):
            base_url = endpoint.rsplit('/chat/completions', 1)[0]
        elif endpoint.lower().endswith('/v1'):
            base_url = endpoint
        else:
            base_url = endpoint + '/v1'
    else:
        host = model.get("host", "127.0.0.1")
        port = model.get("port", 8081)
        base_url = f"http://{host}:{port}/v1"

    command = ["interpreter", "--server", "--api_base", base_url]

    env: Dict[str, str] = {}
    if model.get("type") == "remote":
        api_key = (model.get("api_key") or "").strip()
        if not api_key:
            return jsonify({"ok": False, "error": "Remote model missing API key"}), 400
        env["OPENAI_API_KEY"] = api_key
        if model.get("remote_model"):
            env["OPENAI_MODEL"] = str(model["remote_model"])
    else:
        env["OPENAI_API_KEY"] = "sk-local"
        env["OPENAI_MODEL"] = "gpt-3.5-turbo"

    try:
        record = manager.spawn_shell(
            command,
            cwd=str(Path.home()),
            env=env,
            label=f"oi_console:{model_id}",
            autostart=True,
        )
    except Exception as exc:
        current_app.logger.error("termux_lm: failed to spawn interpreter server: %s", exc)
        return jsonify({"ok": False, "error": f"Failed to start interpreter: {exc}"}), 500

    return jsonify({"ok": True, "data": {"shell_id": record.id}})
```

**Behavior:**
- For **local** models: uses local llama.cpp server host/port to build `--api_base`; injects a dummy key and default model name.
- For **remote** models: uses the provided endpoint (normalized to `/v1`), requires `api_key`, and passes a `remote_model` name if present.
- Lifecycle is handled by the framework shell manager; state files are not modified.

---

## 4) Usage Flow Overview

```
Frontend (Termux‑LM UI)
  ├─ User clicks "Start Interpreter Server"
  │    → handleStartInterpreter() → POST /api/app/termux_lm/interpreter/start
  │
  │    Backend (start_interpreter)
  │      ├─ Read active model from state
  │      ├─ Build API base (local or remote)
  │      ├─ Spawn `interpreter --server` via framework_shells
  │      └─ Return { ok: true, shell_id }
  │
  ├─ User clicks "Open Interpreter Chat"
  │    → Client navigates to /apps/oi_console/
  │
  └─ Every 6s: updateOIStatus()
       → GET /api/framework_shells → find label prefix "oi_console:"
       → If found: show green dot + PID/CPU/RAM and enable Open Chat
         Else: show grey dot and disable Open Chat
```

---

**Summary:**
- Remove the unused Run Mode toggle.
- Add **Start Interpreter Server**, **Open Interpreter Chat**, and a live status line.
- Frontend: element mapping, click handlers, status polling, refresh loop.
- Backend: `/interpreter/start` spawns `interpreter --server` with the correct API base and env.
- Status reflects real process info and enables chat only when running.

