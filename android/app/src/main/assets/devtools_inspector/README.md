# TE2 Native Developer Tools

This package powers the Android native Inspector surface. It does not inject a
visible inspector into the framework page.

Eligible inspected documents receive only the Chobitsu target runtime and a
headless native-messaging bridge. The separate persistent Inspector GeckoView
loads Chii's Chromium DevTools frontend in embedded mode. Kotlin forwards raw
CDP messages between the selected target and Inspector WebExtension
native-messaging ports; there is no WebSocket or framework network endpoint in
this path.

The framework page is always the default target. Run Profiles may opt their
Sidebar URL iframe into inspection with the canonical `"devTools": true`
profile field. The Sidebar assigns that iframe a namespaced `window.name`
marker containing a stable project/profile target id before navigation. The
WebExtension runs at document start in all frames, but `target-config.js`
allows Chobitsu and the native target port to load only for the top-level page
or a marked child frame. Ordinary iframes are untouched.

Kotlin retains one connection per target id and renders the live registry in a
native target picker above the Inspector GeckoView. Selecting a target
reattaches the existing raw CDP broker. The Inspector document's HTML selector
is hidden and receives snapshots only for routing and debug telemetry. If a
selected iframe navigates and recreates its content-script port, its target id
remains selected and reconnects automatically.

Vendored releases:

- Chii 1.15.5: https://registry.npmjs.org/chii/-/chii-1.15.5.tgz
  - npm integrity:
    `sha512-O8c5ddK9iz0jsPqzl1JgeNanh04+4e/sXOBhqRnsr4ip4zwk7iRrv4Ff5NAH2Ddh2h3UwCI5GLt5mAbA0mY57Q==`
- Chobitsu 1.8.6:
  https://registry.npmjs.org/chobitsu/-/chobitsu-1.8.6.tgz
  - npm integrity:
    `sha512-8Eb4TiKyEnX8/huSX/iXe4K37cloQFc8PIDeP/wod94dUJ3BfNFuZ8pHbxnozGL3UH8MEOyXuaEarWUDEdYXKg==`

`front_end/` is the unmodified Chii npm release frontend. `chobitsu.js` is the
unmodified Chobitsu UMD release bundle. TE2-owned files are the manifest,
target configuration/loader/runtime, Gecko native bridge, and Inspector
shell/runtime.

Increment the final component of the WebExtension version whenever packaged
extension behavior changes so GeckoView replaces its persisted built-in copy.
