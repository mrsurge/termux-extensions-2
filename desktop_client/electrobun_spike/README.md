# TE2 Electrobun/CEF desktop shell

This directory contains the CEF desktop client candidate. A trusted local
Electrobun view owns the frameless window, persistent header, launcher, and
Settings surface. Framework apps run in a separate sandboxed CEF child view;
they do not receive Electrobun RPC or Bun APIs.

The implemented shell passes the Code TE2 workload gate on Intel Mesa/ANGLE:
six nested iframes, Monaco, xterm, the Monaco module worker, and seven live
sockets remained intact through a 227-step resize stress. The module worker and
all resources reported zero errors after local interception.

## Linux prerequisites

```bash
sudo apt-get install \
  build-essential cmake pkg-config \
  libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

GTK 3 and WebKitGTK 4.1 are compile-time requirements of Electrobun 1.18.1's
Linux native wrapper even when the application bundles and runs CEF.

## Build and run

```bash
git submodule update --init --recursive worktrees/electrobun-te2
cd desktop_client/electrobun_spike
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run dev
```

`build` and `dev` first run `scripts/bootstrap-electrobun.ts`. The TE2 fork is
the pinned `worktrees/electrobun-te2` submodule on its published `te2-linux`
branch. Bootstrap fingerprints its committed and local source state, builds in
place only when that fingerprint changes, and installs its platform output
over the pinned npm package. Electrobun's ignored `package/vendors/` tree stays
inside the submodule checkout, so editing fork source no longer deletes and
downloads the CEF, WGPU, Bun, Zig, or helper vendors again.

Before starting a required native rebuild, bootstrap checks the filesystem
containing the submodule and stops when less than 3 GB is available.

Electrobun's upstream `build.ts` intentionally waits up to 60 seconds between
GitHub vendor downloads to avoid rate limiting. A message such as `Pausing 56
seconds` is the remaining portion of that first-build throttle, not a TE2
bootstrap polling interval. Once the vendor and fork build caches are
complete, the pause is not part of normal `build` or `dev` startup.

## Shell behavior

- The launcher and Settings pages reuse `desktop_client/android_shell/`.
- Back, Forward, Home, Reload, 50%-200% zoom, Recents, Lock, app-scoped Quit,
  Minimize, Maximize, and window Close live in the persistent header.
- Home removes the child app view and returns to the local launcher.
- Quit posts only the current framework app's lifecycle endpoint, then returns
  home. It does not close the desktop window.
- For every configured HTTP framework origin, the bundled Bun worker binds a
  free `127.0.0.1` port and relays raw TCP bytes to the configured host and
  port. Browser-facing app documents, catalog assets, Framework-Shells,
  Socket.IO, raw WebSockets, and SSE use that loopback origin. HTTPS remains
  direct. Native catalog/lifecycle probes and asset updates continue to use the
  configured origin directly.
- Changing one HTTP framework host or port to another retargets that existing
  loopback listener in place. The desktop process and browser origin remain
  stable; current upstream connections are closed so Framework-Shells, sockets,
  and subsequent requests reconnect to the new server. Protocol transitions
  also apply immediately without relaunching the desktop client.
- CEF automatically accepts only clipboard permission requests from the exact
  browser framework origin. Remote HTTP no longer needs Chromium's
  insecure-origin-as-secure switch; other origins and permission types retain
  their normal gates.
- CEF serves only the paths declared by
  `desktop_client/desktop_asset_inventory.json` from the installed asset root
  through a native resource handler. The framework URL and origin are
  preserved, including for module workers. Asset installs use version
  monotonicity, full staging validation, backup, atomic rename, and rollback;
  the loopback server remains available to the shared desktop asset system.
- A successful update refreshes the title-bar version, raises a toast, replaces
  the child view's asset rules, and reloads the app while bypassing CEF's
  cache.
- A GTK context menu continues CEF's Chrome-runtime Copy and Paste commands
  (`IDC_CONTENT_CONTEXT_COPY`/`PASTE`) while omitting Back, Forward, and Reload.
  The older CEF menu IDs 113/114 are invalid for this runtime.

The desktop connection and zoom remain shared with the GTK reference client in
`~/.config/te2/desktop-shell.json`. Desktop assets remain shared under
`$XDG_DATA_HOME/te2/desktop_assets`.

## Native fork boundary

`worktrees/electrobun-te2` pins
`mrsurge/electrobun@98303d1190f4768c4b2962fc469eb4ec2cd547b0`, based on
upstream Electrobun 1.18.1 commit
`4eba723c85b97559e1d9e13439d9a92ede0832e8`. Its `te2-linux` branch is scoped
to Linux CEF behavior required by this shell:

- per-child-view, same-origin allowlisted local-resource handling;
- CEF page zoom and cache-bypass reload;
- exact browser-origin clipboard permission handling;
- GTK-backed CEF Copy/Paste context-menu handling;
- ordered browser/helper shutdown without SIGTRAP or stack-smashing;
- documented ephemeral handling for a null/default view partition;
- correction of Electrobun's WebGPU generator so its generated path lookup
  retains the required `dirname` import;
- the corresponding BrowserView and `<electrobun-webview>` APIs.

Keep the npm dependency and submodule commit pinned together. Do not silently
fall back to the upstream Linux runtime: the shell can render, but its asset,
zoom, and context-menu contracts would be false.

The automated diagnostic controls are optional environment variables:
`TE2_DESKTOP_SPIKE_AUTO_OPEN=1`, `TE2_DESKTOP_RESIZE_STRESS_SECONDS=<seconds>`,
`TE2_DESKTOP_EXIT_AFTER_SECONDS=<seconds>`, and
`TE2_DESKTOP_ASSET_TRACE=1`. `TE2_DESKTOP_RELAY_TRACE=1` logs byte counts and
lifecycle events for the loopback relay without logging payload contents.
