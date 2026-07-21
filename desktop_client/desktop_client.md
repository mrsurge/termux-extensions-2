# TE2 Desktop Client

The active desktop client is the Electron shell under
`desktop_client/electron_spike/`. It uses Electron's native Chromium/Wayland
path while retaining the launcher, Settings, asset updates, and app-scoped
lifecycle behavior established by the earlier desktop spikes.

The Electrobun/CEF implementation under `desktop_client/electrobun_spike/` and
the GTK 4/WebKitGTK 6 implementation in `desktop_client/ui.py` remain behavioral
references. They are not the current desktop runtime.

## Run the Electron client

Node 22.12 or newer is required:

```bash
cd desktop_client/electron_spike
npm install
npm run dev
```

Build a self-contained Linux directory with:

```bash
npm run build
./build/TE2Desktop-linux-x64/TE2Desktop
```

Both launch paths intentionally pass Chromium `--no-sandbox`: this development
client runs from a user-owned tree, while Ubuntu AppArmor blocks Electron's
unprivileged namespace sandbox and the setuid helper requires a root-owned
install. Renderer Node integration stays off and context isolation stays on.

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

Electron projects every configured HTTP or HTTPS framework origin through one
in-process server on a dynamically allocated `127.0.0.1` port. The server
proxies ordinary HTTP, streaming SSE, Socket.IO, and raw WebSocket upgrades. It
serves only inventory-approved installed assets itself, from that same origin,
which keeps Monaco module workers same-origin. Changing the target retargets the
existing listener and closes active connections without restarting the client.
Native app URLs use `gv_native=1` so the PWA service worker cannot mask the
desktop asset layer.

## Native shell behavior

- Back, Forward, Home, Reload, Recents, Lock, and Quit are persistent shell
  header actions.
- Home returns to the desktop-owned launcher.
- Quit posts only the current `/app/<app_id>` lifecycle endpoint and then
  returns to the desktop-owned launcher; it never exits the Electron wrapper.
- The framework app toolbar is hidden while its actions remain callable by the
  native header.
- The title bar shows the installed desktop asset version. Successful automatic
  asset installs raise an in-window native toast; manual Settings updates retain
  their page toast.
- Header zoom controls range from 50% to 200%, reset at 100%, and persist in
  `~/.config/te2/desktop-shell.json`.
- Electron's native context menu exposes Copy and Paste and invokes those
  commands directly on the focused renderer. It has no native navigation
  actions.
- Electron's Linux Ozone hint is `auto`, so Wayland sessions use Electron's
  native Wayland path instead of forcing X11.

## Validation

```bash
node --check desktop_client/android_shell/host.js
node --check desktop_client/android_shell/settings.js

cd desktop_client/electron_spike
npm run typecheck
npm test
npm run build
```
