# Integrating the Flask Mobile IDE as a Full-Page App

To add a Full-Page App version of the Flask Mobile IDE alongside the existing "windowed" (iframe/modal) version, implement a dedicated route, HTML shell, static asset pipeline, and auth/session hand-off that reuse the same backend APIs, event bus, and job runners you already have.

---

## Goals

- **Single, dedicated URL** that opens the IDE as a full-page experience (no surrounding dashboard chrome).
- **Shared backend**: reuse the same Flask APIs, jobs, sockets/events, and state as the current embedded IDE.
- **Same UI pieces** (editor, file explorer, console, job/progress toasts) but laid out for full screen.
- **Auth/session continuity** so users coming from your main dashboard do not re-login.
- **Linkability**: users can bookmark/share a deep link into a specific project/file.

---

## Minimal Architecture

- **Flask route**: `/ide` (and optionally `/ide/<project_id>` and `/ide/<project_id>/file/<path>`)
- **HTML shell**: a standalone template that mounts your SPA (or progressive-enhancement JS) without the dashboard navbar/sidebar.
- **Static assets**: CSS + JS built by your existing build step; loaded by the full-page shell.
- **Auth**: reuse session cookie or JWT from the main app.
- **Events**: your existing websocket/SSE channel; identical events for embedded vs full-page.

---

## URL Structure (Deep Links)

- `/ide` → opens last workspace/project the user worked on.
- `/ide/<project_id>` → opens a specific project/workspace.
- `/ide/<project_id>/file/<path>` → opens a specific file in the editor.
- Optional query params:
  - `?view=explorer|editor|console` to focus a pane
  - `?line=123&col=4` to place the caret
  - `?branch=main` to set git branch context

---

## Flask Routes

```python
# app/routes/ide_fullpage.py
from flask import Blueprint, render_template, redirect, url_for, request
from flask_login import login_required

bp = Blueprint("ide_fullpage", __name__, url_prefix="/ide")

@bp.route("/")
@login_required
def ide_home():
    # Resolve last workspace or default
    return render_template("ide_fullpage.html",
                          project_id=None,
                          seed_state=_seed_state())

@bp.route("/<project_id>")
@login_required
def ide_project(project_id):
    return render_template("ide_fullpage.html",
                          project_id=project_id,
                          seed_state=_seed_state(project_id))

@bp.route("/<project_id>/file/<path:file_path>")
@login_required
def ide_project_file(project_id, file_path):
    return render_template("ide_fullpage.html",
                          project_id=project_id,
                          file_path=file_path,
                          seed_state=_seed_state(project_id, file_path))


def _seed_state(project_id=None, file_path=None):
    # Return minimal boot props for the SPA (user, perms, last files, etc.)
    return {
        "user": _current_user_summary(),
        "project_id": project_id,
        "file_path": file_path,
    }
```

> Mount this blueprint in your app factory and ensure it’s served behind login.

---

## Template (HTML Shell)

```html
<!-- templates/ide_fullpage.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>IDE – Full Page</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='css/ide_fullpage.css') }}" />
</head>
<body>
  <div id="ide-root" data-seed='{{ seed_state|tojson }}'></div>
  <script src="{{ url_for('static', filename='js/ide_fullpage.js') }}" defer></script>
</body>
</html>
```

- The page mounts `#ide-root` with your SPA. Use the `data-seed` JSON to boot initial state.
- No dashboard chrome/nav; keep it clean for full-screen work.

---

## Front-End Bootstrapping

```js
// static/js/ide_fullpage.js
(function(){
  const root = document.getElementById('ide-root');
  const seed = JSON.parse(root.dataset.seed || '{}');

  // Initialize your existing IDE app
  IDEApp.mount(root, {
    mode: 'fullpage',
    user: seed.user,
    projectId: seed.project_id,
    filePath: seed.file_path,
  });
})();
```

- Reuse the same modules/components you have for the embedded IDE.
- Gate certain layout changes behind `mode: 'fullpage'` to enable full-height panes, different toolbar density, etc.

---

## Layout Considerations (Full-Page)

- **Header**: compact toolbar with project selector, breadcrumbs, run/build buttons, and status indicators (git, LSP, job queue).
- **Left rail**: file explorer + search + git panel (collapsible).
- **Center**: editor tabs + problems panel.
- **Bottom**: terminal/console, job progress, toast area (height-resizable, togglable).
- **Right rail**: optional inspector (LSP outline, variables, extensions UI).

Use CSS grid to allow dynamic resizing and stable min/max widths.

---

## Auth & Session

- Maintain the same auth cookie/session used by the dashboard.
- For tokenized APIs (e.g., websockets/SSE), your SPA should include the bearer token or rely on cookie auth on same origin.
- Provide a **sign-out** in the full-page header that returns to the dashboard.

---

## Jobs & Progress (Re-use)

- The full-page version listens to the same job/progress events as the embedded IDE (copy/extract/build/lint/test).
- Persist job history in memory (last N jobs) so toasts can show recent completions even if the panel is collapsed.
- Ensure that long-running jobs survive a server restart (supervisor/process manager on the backend) and that the UI reconnects to stream updates.

---

## Keyboard Shortcuts

- Keep shortcuts consistent with the embedded IDE.
- Add **fullscreen** toggle, **focus editor**, **focus terminal**, **toggle explorer**, **palette**.

---

## Extension Surface (Optional)

- Render an Extensions panel in the right rail for installing/enabling/disabling editor or project extensions.
- Same registry/provider as embedded IDE. In full-page, show more detail.

---

## Settings Access

- Provide a settings panel that writes to the same JSON config used by your windowed mode.
- Include search, and basic categories (Editor, Theme, Keymap, Workspace, Git, LSP, Python, Termux, etc.).

---

## Theming

- Respect app-wide light/dark theme.
- Ensure high-contrast for terminals and code editors. Persist per-user.

---

## Build/Deploy

- Add a `vite`/`webpack` bundle target for `ide_fullpage.js` and `ide_fullpage.css`.
- Use cache-busting filenames if needed and `url_for('static', filename=...)` in the template.

---

## Example: App Factory Wiring

```python
# app/factory.py
from flask import Flask
from .routes.ide_fullpage import bp as ide_bp


def create_app():
    app = Flask(__name__)
    # ... config, db, login_manager, etc.
    app.register_blueprint(ide_bp)
    return app
```

---

## Deep-Link Handling in SPA

- On boot, read `projectId`/`filePath` from the seed and load/open accordingly.
- If only `projectId` is present, load last open files from local storage or backend.
- When user opens a new file, **update the address bar** with `history.replaceState` to reflect the new deep link.

---

## Error States

- 404 project/file → show a friendly error with a button back to the file explorer.
- Permission denied → offer a safe return to dashboard.
- Backend disconnected → show non-blocking banner and auto-retry.

---

## Testing Checklist

- [ ] Route protection works; redirects unauthenticated users to login.
- [ ] Full-page layout renders on mobile and desktop breakpoints.
- [ ] Editor opens files via deep link; caret jumps to `?line`/`?col`.
- [ ] Websocket/SSE reconnect logic restores progress streams.
- [ ] Jobs started in embedded mode continue to stream in full-page mode.
- [ ] Settings edits persist and reflect after reload.
- [ ] Extensions install/enable flows work end-to-end.

---

## Rollout Plan

1. Ship behind a feature flag (per-user or per-team).
2. Dogfood internally; gather layout/keyboard feedback.
3. Enable for a small beta cohort.
4. Gradually expose a link/button from the dashboard to “Open Full-Page IDE”.

---

## Notes

- Keep the **embedded** and **full-page** modes sharing as much code as possible—ideally just a different shell/layout + routing.
- All APIs, events, and background jobs should be identical to reduce maintenance.

