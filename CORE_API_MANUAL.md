# Agent Development Guide for Termux Extensions

## 1. Purpose

This guide documents the core APIs exposed by the Termux Extensions framework and reiterates the guardrails every extension agent must follow. Extension-specific prompts live in each `*_AGENT.txt` file; this manual only covers platform-wide expectations.

## 2. Critical Guardrails

1. **Stay in your sandbox.** Only modify files inside your assigned extension directory under `app/extensions/<extension_name>/` or app directory under `app/apps/<app_id>/` if you are building a full-page app. Core framework files (`app/main.py`, `app/templates/`, `scripts/`, `docs/`, `README.md`, etc.) are off-limits unless the user explicitly requests a change.
2. **Use official APIs.** Never reach into the filesystem or spawn commands directly from frontend code. Route everything through the documented endpoints or your per-extension/backend blueprint.
3. **Preserve the response envelope.** All framework and extension endpoints must respond with `{ "ok": true|false, "data": ... }` on success or `{ "ok": false, "error": "..." }` on failure. Avoid leaking stack traces or raw exceptions.

## 3. Core API Overview

The Flask host exposes a small set of shared endpoints intended for all extensions. Access them with `window.teFetch` or regular `fetch` calls from the frontend. Response objects always adhere to the envelope described above.

### 3.1 Directory Browser — `GET /api/browse`
Browses the filesystem beneath the user's home directory.

- **Query Parameters**
  - `path` (optional): absolute path or `~`-relative path to inspect. Defaults to `~`.
- **Success (200)**
  ```json
  {
    "ok": true,
    "data": [
      { "name": "Downloads", "type": "directory", "path": "/data/data/.../Downloads" },
      { "name": "script.sh", "type": "file", "path": "/data/data/.../script.sh" }
    ]
  }
  ```
- **Errors (403/500)**
  ```json
  { "ok": false, "error": "Access denied" }
  ```

### 3.2 Command Runner — `POST /api/run_command`
Executes a shell command inside the Termux environment. Use sparingly and prefer purpose-built APIs whenever possible.

- **Request Body**
  ```json
  { "command": "uname -a" }
  ```
- **Success (200)**
  ```json
  { "ok": true, "data": { "stdout": "..." } }
  ```
- **Failure (500)**
  ```json
  { "ok": false, "error": "Command failed", "stderr": "..." }
  ```

### 3.3 PATH Executable Index — `GET /api/list_path_executables`
Returns every executable discovered on the current `PATH`. Useful for building pickers.

- **Success (200)**
  ```json
  {
    "ok": true,
    "data": [
      { "name": "aria2c", "path": "/data/.../bin/aria2c" },
      { "name": "python", "path": "/data/.../bin/python" }
    ]
  }
  ```

### 3.4 Extensions Registry — `GET /api/extensions`
Lists extension manifests loaded at startup so the launcher can render them.

- **Success (200)**
  ```json
  { "ok": true, "data": [ { "name": "Sessions & Shortcuts", "_ext_dir": "sessions_and_shortcuts", ... } ] }
  ```

### 3.5 Apps Registry — `GET /api/apps`
Lists full-page apps registered under `app/apps/`.

- **Success (200)**
  ```json
  { "ok": true, "data": [ { "name": "File Editor", "id": "file_editor", ... } ] }
  ```

### 3.6 Static Asset Helpers
- `GET /extensions/<ext_dir>/<filename>` serves static files from an extension directory.
- `GET /apps/<app_dir>/<filename>` serves static files from a full-page app directory.

### 3.7 Framework Shells — `/api/framework_shells`
Manage long-lived background shells that inherit `TE_SESSION_TYPE=framework`, keeping them out of the Sessions UI. Mutating requests honour the response envelope and require the optional `X-Framework-Key` header when `TE_FRAMEWORK_SHELL_TOKEN` is configured.

- **GET `/api/framework_shells`** — List all registered shells with status and resource stats.
- **GET `/api/framework_shells/<id>`** — Detailed metadata; pass `logs=true&tail=200` to include recent log lines.
- **POST `/api/framework_shells`** — Spawn a new shell. Body example:
  ```json
  {
    "command": ["aria2c", "--enable-rpc"],
    "cwd": "~/services/aria2",
    "env": {"ARIA2_SECRET": "..."},
    "label": "aria2",
    "autostart": true
  }
  ```
- **POST `/api/framework_shells/<id>/action`** — `{ "action": "stop" | "kill" | "restart" }`.
- **DELETE `/api/framework_shells/<id>`** — Remove metadata and kill the process (force via `?force=1`).


## 4. Per-App / Per-Extension APIs

Each extension or app blueprint mounts under `/api/ext/<extension_name>/` or `/api/app/<app_id>/`. Consult the corresponding `*_AGENT.txt` file for the endpoints you must implement or consume. Always wrap responses using the envelope defined earlier.

## 5. Testing Notes

- Run the framework locally with `TE_SESSION_TYPE="framework" python app/main.py` and browse to `http://localhost:8080`.
- Use the Chrome/Firefox network inspector to confirm responses respect the envelope.
- When adding new shared endpoints, update this manual immediately so other agents stay in sync.
