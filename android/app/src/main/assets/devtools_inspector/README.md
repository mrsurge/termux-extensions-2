# TE2 Native Developer Tools

This package powers the Android native Inspector surface. It does not inject a
visible inspector into the framework page.

The inspected page receives only the Chobitsu target runtime and a headless
native-messaging bridge. The separate persistent Inspector browser surface
loads Chii's Chromium DevTools frontend in embedded mode. Kotlin forwards raw
CDP messages between the target and inspector WebExtension/WebView endpoints;
there is no WebSocket or framework network endpoint in this path.

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
target loader/runtime, Gecko and WebView native bridges, and inspector
shell/runtime.

Increment the final component of the WebExtension version whenever packaged
extension behavior changes so GeckoView replaces its persisted built-in copy.
