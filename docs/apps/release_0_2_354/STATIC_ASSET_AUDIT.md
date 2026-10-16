# Built-in static asset delivery audit

Source checkpoint 2e77c843; audited 2026-10-15. User approved the two proven
fixes, regression tests and documentation only. No APK, OTA, runtime transition
or publication occurred. Existing unrelated files/deletions remain untouched.

## Coverage and ownership

The common app/android_editor_assets_bundle.json supplies both Rust OTA ZIPs and
scripts/bundle_gecko_assets.sh APK seeds. URL interception is separate:
desktop_client/desktop_asset_inventory.json for Electron, Gecko's
asset_intercept/background.js, and CefriumAssetRoutes.kt shared by Cefrium and
TE2 Termux. The Termux build uses the Cefrium build definition/source set.

| App | Static dependencies inspected | Source result |
| --- | --- | --- |
| Code TE2 | Host/CSS, icons, Monaco CSS/font/workers, TextMate resources, Sidebar metadata | Sidebar metadata and alternate font URL corrected |
| File Explorer | Main adapter/minified bundle, shared JS, filter worker, icon definitions/SVGs, xterm/fonts/touch helper | Existing trees/mappings cover inspected paths |
| Terminal | Minified module, xterm/addons/CSS, owned touch/Ctrl helper tree, Nerd fonts, Socket.IO | Existing trees/mappings cover inspected paths |
| File Editor | Minified module, external CM6, guarded navigation and preferences | Covered by existing vendor/shared JS trees |
| Archive Manager | Minified module and shared jobs client | Covered |
| Aria Downloader | Minified module and inline template styling | Covered; dynamic download/shell issues are separate |
| Settings | Minified module and inline template styling | Covered |
| ALS-RS | Wrapper entrypoints and all 148 hash-checked pinned static resources | Covered at current 0.2.132 snapshot; refresh with selected ALS dependency later |

All declared manifest source paths exist. The literal dependency walk follows
61 distinct static URLs from all app entries plus shared shell helpers, including
relative JS imports and CSS URLs after native alias mapping. It deliberately is
not a JavaScript interpreter or an exhaustive live request capture. Existing
tests cover canonical/by-ID entrypoints, Terminal helper aliases and exclusion of
dynamic/custom/private routes. Computed file icons use the bundled definitions
and individual SVG tree; rmd uses the markdown codicon rather than requesting a
missing rmd.svg. ALS's complete snapshot is independently hash-checked.

The shared app shell still references Google Fonts externally. This is not a
missing first-party OTA mapping and was not changed in this bounded slice.
Dynamic shell HTML, app catalog/data, readiness, sockets and user/extension
resources remain server-owned. No broad /apps or API interception was added.

## Corrected gaps

1. Sidebar startup fetches the static
   /apps/code_te2/extensions/sidebar_extension/manifest.json for its icon.
   Add that exact file to the common bundle and exact native routes. Do not
   intercept other extension manifests or extension trees.
2. Monaco bootstrap CSS references ./codicon-LN6W7LCM.ttf. When loaded through
   /api/app/code_te2/ui/monaco_vscode/lang/bootstrap/, that relative request did
   not pass local admission, although its canonical /static/vendor font was
   already bundled. Admit the exact alternate URL and reuse the existing alias
   mapping. No second font copy or duplicate bytes were added.

## Validation and remaining gates

- Node asset/ALS/launcher regressions: 12 passed, including CSS-derived font
  resolution and the literal static dependency walk.
- Actual Electron mapLocalAssetPath tests: 4 passed.
- Actual CefriumAssetRoutes Kotlin/JUnit tests: 4 passed using cached Kotlin
  2.2.10 compiler, with no Gradle/APK build. The system kotlinc was too old to
  parse existing trailing commas; no production syntax was changed for it.
- Source whitespace check passed. No generated frontend bundle changed because
  this slice changes inventories/routing, not app TypeScript.

Native mapping activation requires rebuilt Electron/Gecko/Cefrium/TE2 Termux
clients; OTA alone cannot teach older clients a new URL. Publish the matching
asset tree separately. Final release still needs generated-source freshness,
ALS snapshot/version alignment and exact-client slow-connection Sidebar request
evidence. These are pending, not implied by source/test success.

Follow-up actual APK inspection found the compression trials reused the stale
October seed, which omitted the entire ALS frontend despite correct source and
served OTA inventory. User approved seed refresh and a Termux rebuild. The new
refreshed-assets APK verifies every one of 444 seed entries plus ALS's 148 static
hashes; see TERMUX_COMPRESSION_AUDIT.md. Final device activation remains separate,
especially equal-version APK updates which skip reseeding.
