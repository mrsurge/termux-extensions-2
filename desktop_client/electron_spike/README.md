# TE2 Electron desktop client

This is the active TE2 Linux desktop client. It uses Electron's native
Chromium/Wayland path and keeps the desktop-owned launcher, Settings, persistent
header, asset updates, and app-scoped lifecycle controls from the earlier
desktop spikes.

## Run from source

Node 22.12 or newer is required.

```bash
npm install
npm run dev
```

`npm run dev` passes `--no-sandbox`. This is intentional: the client is run from
a user-owned tree, while Ubuntu's AppArmor policy prevents Electron's
unprivileged namespace sandbox and the setuid helper requires a root-owned
installation. Node integration remains disabled and context isolation remains
enabled in both renderer surfaces.

## Build the packaged directory

Check that at least 3 GB is free before building, then run:

```bash
npm run typecheck
npm test
npm run build
./build/TE2Desktop-linux-x64/TE2Desktop
```

The packaged `TE2Desktop` launcher supplies `--no-sandbox` to the bundled
`TE2Desktop-bin`, so it starts without a root permission step or manual flag.

## Runtime shape

- A local `te2-desktop://shell/` renderer owns the launcher, Settings, header,
  zoom, asset badge/toasts, and native window controls.
- Framework apps run in a separate `WebContentsView` with Node integration off
  and context isolation on.
- A stable free `127.0.0.1` port relays HTTP, HTTPS, Socket.IO, raw WebSocket,
  and SSE traffic to the configured framework origin. Changing the configured
  target retargets that listener and does not restart the desktop process.
- Inventory-approved installed assets are served by the same relay origin. This
  preserves the origin required by Monaco module workers while keeping dynamic
  framework traffic live.
- Electron owns the Copy/Paste context menu. The actions call the focused
  renderer's native copy and paste commands directly.
- On Linux the Ozone platform hint remains `auto`, allowing Electron to select
  native Wayland for a Wayland session.

Settings persist in `~/.config/te2/desktop-shell.json`; shared installed assets
live in `~/.local/share/te2/desktop_assets` unless their XDG roots are changed.

Useful smoke variables are `TE2_DESKTOP_EXIT_AFTER_SECONDS`,
`TE2_DESKTOP_SPIKE_AUTO_OPEN`, `TE2_DESKTOP_SPIKE_APP_ID`, and
`TE2_DESKTOP_SPIKE_URL`.
