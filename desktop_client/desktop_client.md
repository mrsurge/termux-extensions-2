# TE2 Desktop Client

The active desktop candidate is the Electrobun/CEF shell under
`desktop_client/electrobun_spike/`. The GTK 4/WebKitGTK 6 client remains in
`desktop_client/ui.py` as the behavioral reference for the launcher, Settings,
asset updates, and app-scoped lifecycle controls; its renderer was rejected for
the real Code TE2 resize/iframe workload.

## Run the Electrobun client

See `desktop_client/electrobun_spike/README.md` for its pinned native fork and
build prerequisites. The normal commands are:

```bash
cd desktop_client/electrobun_spike
bun install --frozen-lockfile
bun run build
bun run dev
```

## Run the GTK reference client

Ubuntu/Debian development packages:

```bash
sudo apt install build-essential libwebkitgtk-6.0-dev python3-gi
```

Start the client from the repository root:

```bash
python -m desktop_client.ui
```

The WebKit request interceptor is compiled automatically on first run and after
its C source or the installed WebKit version changes. Its single shared object
is cached under `~/.cache/te2/desktop_shell/web_extensions/`; no Node or vendor
tree is created.

## Desktop assets

The client reuses the framework's Android OTA contract:

- `/api/editor_version`
- `/api/editor_assets_bundle`

The shared framework/editor files are installed under
`$XDG_DATA_HOME/te2/desktop_assets` (normally
`~/.local/share/te2/desktop_assets`). Android's `android-shell/` launcher and
Settings files are deliberately omitted because `desktop_client/android_shell/`
owns the desktop launcher.

Updates are monotonic and replace the complete installed tree through staging,
validation, backup, atomic rename, and rollback. The desktop Settings page shows
the installed version and interceptor state and provides a force-update action.
The client also checks for a newer bundle at startup.

A loopback-only HTTP server exposes the installed tree. The GTK reference uses
a WebKit web-process extension; Electrobun's CEF fork uses a native resource
handler that returns local bytes without changing the framework URL or origin,
which keeps module workers valid. Both intercept only the immutable static path
allowlist used by the Android wrappers. Electrobun projects configured HTTP
framework traffic through an in-process, dynamically allocated localhost TCP
relay; changing the HTTP target retargets the same listener and closes existing
upstream connections without restarting the client. HTTPS stays direct. Native
app URLs use the existing `gv_native=1` shell mode so the PWA service worker
cannot race the native asset layer.

## Native shell behavior

- Back, Forward, Home, Reload, Recents, Lock, and Quit are persistent shell
  header actions.
- Home returns to the desktop-owned launcher.
- Quit posts only the current `/app/<app_id>` lifecycle endpoint and then
  returns to the desktop-owned launcher; it never exits the GTK wrapper.
- The framework app toolbar is hidden while its actions remain callable by the
  native header.
- The title bar shows the installed desktop asset version. Successful automatic
  asset installs raise an in-window native toast; manual Settings updates retain
  their page toast.
- Header zoom controls range from 50% to 200%, reset at 100%, and persist in
  `~/.config/te2/desktop-shell.json`.
- The context menu exposes Copy and Paste but omits native navigation actions.

## Validation

```bash
python -m unittest discover -s desktop_client -p 'test_*.py' -v
python -m py_compile desktop_client/ui.py desktop_client/assets.py
node --check desktop_client/android_shell/host.js
node --check desktop_client/android_shell/settings.js

cd desktop_client/electrobun_spike
bun run typecheck
bun test
bun run build
```
