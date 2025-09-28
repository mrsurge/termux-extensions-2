# termux-extensions-2

**`termux-extensions-2`** is a web framework for Termux that provides a mobile-friendly UI to manage and interact with the Termux environment. It operates as a local Flask-powered web server, presenting a clean UI for controlling your terminal sessions.

The core functionality is delivered through a system of "extensions" that leverage standard command-line tools to provide rich, interactive control over your Termux sessions.

## Project Philosophy

While this framework can assist users unfamiliar with shell scripting, its primary audience is **power users**. The core goal is to transcend the inherent limitations of using touchscreen keyboards with a traditional command-line interface. Even with excellent terminal emulators like Termux, typing complex commands and managing multiple sessions on a touch device has reached a plateau of efficiency.

This project aims to break through that plateau by creating a fluid, intuitive, and **touch-friendly interface** for navigating and controlling the Termux multitasking environment. It draws inspiration from the philosophy of frameworks like *Oh My Zsh* and *Oh My Fish*—which enhance the shell experience with smart helpers and plugins—and adapts that spirit to a graphical, touch-centric paradigm.

## Quick Start

The framework now ships with a bootstrap helper tailored for Termux devices. On a fresh Termux install you can get up and running with:

```bash
pkg update
pkg install git
git clone https://github.com/mrsurge/termux-extensions-2.git
cd termux-extensions-2
./scripts/bootstrap_termux.sh
```

The script (see [`docs/termux_lm_setup_termux.md`](docs/termux_lm_setup_termux.md)) checks that you are running `bash`, installs required Termux packages (including `llama-cpp`), installs Python requirements, ensures `scripts/init.sh` is sourced from `~/.bashrc`, and links a `start-te` helper into `~/bin/`.

After the bootstrap completes, open a new shell (so `.bashrc` reloads) and launch the supervisor:

```bash
start-te
```

Then browse to `http://localhost:8080` from the device (or another host on your LAN if you bind externally).

### Manual setup

If you prefer a manual install, follow these steps instead:

1. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Hook monitored shells**
   ```bash
   source scripts/init.sh
   ```
   Add the above line to `~/.bashrc` to make new shells register automatically.

3. **Run the server (dev)**
   ```bash
   TE_SESSION_TYPE="framework" python app/main.py
   ```

4. **Access the UI**
   Navigate to `http://localhost:8080` in a browser.
### Production run (serve to other devices)

To allow other devices on your network to access the UI, run with Gunicorn and bind to all interfaces:

```bash
# Install requirements (if not already)
pip install -r requirements.txt

# Run Gunicorn, binding to 0.0.0.0:8080
TE_SESSION_TYPE="framework" gunicorn -w 2 -k gthread --threads 8 -b 0.0.0.0:8080 wsgi:application
```

Then open from another device on the same network: `http://<your-device-ip>:8080`

## Testing

The framework now exposes runtime metadata via `TE_RUN_ID` and a metrics endpoint. To verify a deployment:

1. Launch the supervisor entrypoint, which tags the run automatically:
   ```bash
   scripts/run_framework.sh
   ```
   The script prints the generated `TE_RUN_ID` and keeps the Flask app in the foreground.

2. In a separate shell, confirm the server is reporting metrics:
   ```bash
   curl http://localhost:8080/api/framework/runtime/metrics | jq
   ```
   The response includes the active `run_id`, supervisor/app PIDs, aggregate CPU usage, RSS totals for all framework-managed shells, and the list of interactive sessions stamped with the current run.

3. Spawn a framework shell (either from the UI or via the API) and re-query the metrics endpoint. The process list and memory totals should reflect the new shell.

If you are iterating on backend changes, restart the supervisor script to issue a fresh `TE_RUN_ID` for the next test cycle. Press `Ctrl+C` in the supervisor window to trigger an orderly shutdown (framework shells and dtach sessions tagged with the run ID are cleaned up automatically).

Notes:
- The built-in Flask server is now non-debug by default and binds to `0.0.0.0` on port 8080, but Gunicorn is recommended for multi-client stability.
- Adjust workers/threads based on your device resources. On low-memory phones/tablets, `-w 1 --threads 4` might be better.


### Install as a Web App (PWA)

On mobile (Android Chrome/Edge, recent Firefox):

- Open `http://localhost:8080` in the browser on the same device.
- Use the browser menu and select "Install app" or "Add to Home screen".
- Launch from the home screen icon for a full-screen experience.

Notes:

- A service worker and manifest are included; localhost is treated as a secure context, so installation works without HTTPS.
- If you previously installed an older version, you may need to remove it and re-install after updating.

## Key Features

*   **Web-Based UI:** A clean, modern interface accessible from any local browser.
*   **Session Management:** The Sessions & Shortcuts extension controls active shells, launches shortcuts (now with the universal picker), and renames or kills sessions without leaving the UI.
*   **Background Framework Shells:** Long-running jobs (aria2, distro helpers, etc.) are tracked with health checks, log tails, a cleanup action, and inline debug consoles.
*   **Settings App:** A full-page diagnostics hub for runtime metrics, framework shell management, and supervised shutdown controls.
*   **Universal File/Directory Picker:** A shared modal with breadcrumb navigation, hidden-file toggle, home button, and per-mode start-path memory is available to every app/extension.
*   **Built-In Diagnostics:** Apps such as the Distro manager ship with inline debug consoles so you can pause, inspect, and clear log streams while reproducing issues.
*   **Embedded Terminal App:** A full-page app built atop framework shells offers multi-terminal management with xterm.js, WebSocket streaming, and soft-key controls directly in the browser.
*   **Easy Installation:** Designed to be installed as a standard Debian package via `apt`.

## Persistent State Store

Front-end settings that need to survive browser reloads (framework tokens, custom
session names, picker preferences, etc.) use the shared `/api/state` endpoints via
`window.teState`. See [`docs/state_store.md`](docs/state_store.md) for details on the
available helper methods and storage format.
