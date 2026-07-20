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
cd desktop_client/electrobun_spike
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run dev
```

`build` and `dev` first run `scripts/bootstrap-electrobun.ts`. It clones the
exact Electrobun 1.18.1 commit into one reusable
`$XDG_CACHE_HOME/te2/electrobun` source/build tree, applies the tracked TE2
Linux patch, builds it, and installs its platform output over the pinned npm
package. Build and installed-runtime markers are keyed by the patch hash, so a
matching subsequent bootstrap validates and reuses the runtime without another
build or platform-tree copy. The source checkout and downloaded CEF toolchain
are not vendored in this repository.

Electrobun's upstream `build.ts` intentionally waits up to 60 seconds between
GitHub vendor downloads to avoid rate limiting. A message such as `Pausing 56
seconds` is the remaining portion of that first-build throttle, not a TE2
bootstrap polling interval. Once the vendor and patched build caches are
complete, the pause is not part of normal `build` or `dev` startup.

For development against an already patched source checkout, set
`TE2_ELECTROBUN_SOURCE=/absolute/path/to/electrobun`. The bootstrap verifies the
pinned commit and reverse-applies the tracked patch as an integrity check before
copying the built runtime. Its patch-hash marker is stored in the TE2 cache, so
the bootstrap never resets or modifies that checkout.

## Shell behavior

- The launcher and Settings pages reuse `desktop_client/android_shell/`.
- Back, Forward, Home, Reload, 50%-200% zoom, Recents, Lock, app-scoped Quit,
  Minimize, Maximize, and window Close live in the persistent header.
- Home removes the child app view and returns to the local launcher.
- Quit posts only the current framework app's lifecycle endpoint, then returns
  home. It does not close the desktop window.
- The configured framework origin remains authoritative for HTML documents,
  APIs, Socket.IO, raw WebSockets, and SSE.
- CEF serves only the paths declared by
  `desktop_client/desktop_asset_inventory.json` from the installed asset root
  through a native resource handler. The framework URL and origin are
  preserved, including for module workers. Asset installs use version
  monotonicity, full staging validation, backup, atomic rename, and rollback;
  the loopback server remains available to the shared desktop asset system.
- A successful update refreshes the title-bar version, raises a toast, replaces
  the child view's asset rules, and reloads the app while bypassing CEF's
  cache.
- The native context menu keeps Copy and Paste while removing Back, Forward,
  and Reload.

The desktop connection and zoom remain shared with the GTK reference client in
`~/.config/te2/desktop-shell.json`. Desktop assets remain shared under
`$XDG_DATA_HOME/te2/desktop_assets`.

## Native fork boundary

`patches/electrobun-1.18.1-te2-linux.patch` is intentionally scoped and limited
to Linux CEF behavior required by this shell:

- per-child-view, same-origin allowlisted local-resource handling;
- CEF page zoom and cache-bypass reload;
- context-menu pruning with Copy/Paste preservation;
- ordered browser/helper shutdown without SIGTRAP or stack-smashing;
- documented ephemeral handling for a null/default view partition;
- correction of Electrobun's WebGPU generator so its generated path lookup
  retains the required `dirname` import;
- the corresponding BrowserView and `<electrobun-webview>` APIs.

Keep the npm dependency and upstream commit pinned together. Do not silently
fall back to the unpatched Linux runtime: the shell can render, but its asset,
zoom, and context-menu contracts would be false.

The automated diagnostic controls are optional environment variables:
`TE2_DESKTOP_SPIKE_AUTO_OPEN=1`, `TE2_DESKTOP_RESIZE_STRESS_SECONDS=<seconds>`,
`TE2_DESKTOP_EXIT_AFTER_SECONDS=<seconds>`, and
`TE2_DESKTOP_ASSET_TRACE=1`.
