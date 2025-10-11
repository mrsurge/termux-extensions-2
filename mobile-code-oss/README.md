# Mobile IDE Shell (Flask + VS Code Web bridge)

This is a minimal scaffold that hosts a **mobile chrome** around VS Code Web (Code-OSS / code-server) and drives it using a tiny **bridge extension**.

## What it gives you
- A parent UI (hamburger, bottom tabs) served by Flask
- An `<iframe>` that loads VS Code Web at **same origin** (`/ide/` by default)
- `postMessage` IPC between the parent and a **bridge extension** inside VS Code to:
  - Toggle Explorer as a drawer
  - Toggle/focus Panel (Terminal/Problems/Output)
  - Open Command Palette, Search
  - Open **Settings (JSON)** editor
  - Show a specific **view** in the Panel (e.g., a chat extension)
- API stubs for settings and extension install/uninstall (replace with real code-server CLI calls)

## Prereqs
- Python 3.10+
- Node 18+ (to build & install the bridge extension)
- VS Code Web or code-server hosted at `/ide/` **on the same origin** (configure your reverse proxy)

## Run
```bash
cd server
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export CODE_IFRAME_URL=/ide/   # adjust if needed
python app.py
```

Open http://localhost:5000/

## Bridge Extension
The `bridge-extension/` folder contains a simple web extension that:
- Listens for `postMessage` from the parent
- Executes VS Code commands (toggle sidebar/panel, focus terminal, open settings JSON, show view)
- Posts state updates back (sidebar/panel visibility) and lists chat providers

Build & package:
```bash
cd bridge-extension
npm i
npm run build
# Install into code-server or VS Code web (use Open VSX packager or vsce to make a VSIX)
```

## Same-origin routing
Use Nginx (example) to serve both Flask (`/`) and VS Code Web (`/ide/`) under the **same domain**:
```
location / { proxy_pass http://127.0.0.1:5000; }
location /ide/ { proxy_pass http://127.0.0.1:8080; }  # your code-server/vscode-web
```

## Notes
- Replace Extension install/uninstall stubs with a call to `code --install-extension` or code-server API.
- Some extensions require Node APIs and won’t run in web; prefer web-compatible chat/AI extensions.
