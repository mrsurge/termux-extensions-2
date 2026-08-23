# TE2 Electron desktop client

This is the active TE2 Linux desktop client. It uses Electron's Chromium
renderer and keeps the desktop-owned launcher, Settings, persistent header,
asset updates, and app-scoped lifecycle controls from the earlier desktop
clients.

## Install from a source or Git Python package

The TE2 Python package carries this locked production source, the desktop shell
assets, and the exact shared dialog/component inputs used by the build. On a
glibc Linux x86-64 host with Node.js 22.12 or newer and npm:

```bash
te2 desktop install
te2-desktop
```

The explicit bootstrap runs `npm ci`, compiles the source, and packages the
Electron application in a cache staging tree. It then atomically publishes one
fingerprinted runtime beneath `$TE2_DATA_HOME/desktop/electron`, activates its
`current` link, and installs `~/.local/bin/te2-desktop`, the XDG desktop entry,
and icon. npm and Electron downloads remain beneath
`$TE2_CACHE_HOME/desktop/electron`; build intermediates are discarded.

At least 3 GiB of free space is required only when a build is needed. A matching
validated runtime is reused. The integration writer refuses to overwrite an
unrelated existing file, and uninstall removes external files only while their
hashes still match its private receipt.

Useful management commands are:

```bash
te2 desktop status
te2 desktop repair
te2 desktop uninstall
```

The later archive-based Linux installer remains a separate release path and
will ship a prebuilt Electron payload instead of requiring an end-user build.

## Run from source

Node 22.12 or newer is required.

```bash
npm install
npm run dev
```

`npm run dev` passes `--no-sandbox`. This is intentional because the client is
run from a user-owned tree, while Ubuntu's AppArmor policy prevents Electron's
unprivileged namespace sandbox and the setuid helper requires a root-owned
installation. Electron retains its automatic native Ozone backend selection.
Node integration remains disabled and context isolation remains enabled in both
renderer surfaces.

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
- Trusted shell IPC uses structured request results. Expected framework
  refusal, timeout, reset, and abort failures are reduced to concise recoverable
  errors instead of escaping Electron's native-request handler with a main
  process stack trace.
- Framework control requests use a five-second timeout. Launcher refreshes are
  coalesced, the local Settings card renders before the network probe, and the
  launcher continues polling so recovered framework apps reappear.
- While a framework app is open, one sequential status probe drives a native
  header `Framework offline — Launcher` control. Transient failures leave the
  app view in place; recovery clears the control, while the user can always
  close the app view and return to the local launcher without network access.
- Relay WebSocket tunnels own both socket lifetimes. Error, FIN, end, or close
  on either peer unpipes and destroys the pair, and guarded handshake writes
  cannot target an ended socket. HTTP and SSE proxy streams similarly cancel
  their upstream work when the browser side closes. Expected network teardown
  never escapes as an Electron main-process exception.
- Inventory-approved installed assets are served by the same relay origin. This
  preserves the origin required by Monaco module workers while keeping dynamic
  framework traffic live.
- A successful automatic or Settings-driven asset install clears the dedicated
  `persist:te2-framework` HTTP and V8 code caches before reloading an active app
  view. A force refresh therefore activates same-version bytes without
  restarting Electron; if no app is open, the next launch reaches the relay.
- Electron owns the Copy/Paste context menu. The actions call the focused
  renderer's native copy and paste commands directly.
- Code TE2 console workers in the Electron app view register as
  `electron:main_page:<suffix>`. Their frozen `window.te2Electron` bridge exposes
  identity and bounded launcher, asset, Run Profile instrumentation, Sidebar
  presentation, and detached-surface operations through an
  exact-view/origin-validated native command allowlist.
- Code TE2 Sidebar surfaces can detach into normal floating windows. Electron
  main owns their stable-surface registry, trusted local TSX header, and
  framework-partition content view. The full target marker is installed before
  navigation, and the inline iframe is removed only after the detached page is
  ready. Attach or user Close reconstructs the inline presentation; exact Stop,
  backend removal, app-view loss, and framework retarget retain their separate
  lifecycle semantics.
- On Linux, Electron automatically selects native Wayland when the desktop
  session supports it. Detached modal/dialog windows retain parent-modal
  ownership but do not request global always-on-top status. After a child has
  held native focus, losing that focus closes it through its normal lifecycle;
  a same-turn focus recovery cancels the pending close.

Connection/bookmark/zoom settings persist in
`~/.config/te2/desktop-shell.json`. Local framework launch policy persists
separately in `~/.config/te2/desktop-local-framework.json`; before that file is
created, Electron shows unsaved defaults and PATH-based `te2` detection. Shared
installed assets live in `~/.local/share/te2/desktop_assets` unless their XDG
roots are changed.

Useful smoke variables are `TE2_DESKTOP_EXIT_AFTER_SECONDS`,
`TE2_DESKTOP_AUTO_OPEN`, `TE2_DESKTOP_APP_ID`, and
`TE2_DESKTOP_URL`.
