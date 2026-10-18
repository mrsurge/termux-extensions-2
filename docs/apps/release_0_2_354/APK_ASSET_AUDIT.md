# Android asset wiring and Termux settings OTA

Source audit: 2026-10-18, based on `8db7682e` plus the approved settings fix.
This is static evidence, not acceptance of an assembled or installed APK.

## Settings update ownership

TE2 Termux packages `desktop_client/android_shell/` through Cefrium's
`bundleTermuxShell` Sync task. Generated entry HTML selects
`electromux-bootstrap.js`; `TermuxShellAssets` serves the exact APK-owned
`/electromux-shell/` namespace before editor OTA interception. Consequently the
settings fix requires a newly assembled APK; editor OTA cannot replace it.

The defect was an obsolete bootstrap capability-disabling observer plus a
missing `update_assets` branch in `electromux-platform.js`. The adapter now sends
POST `/android-api/assets/update` through the existing same-origin Android
gateway. `AndroidShellGateway` invokes the activity-owned force updater and
returns `{started:true}` with HTTP 202. Shared settings distinguish that
admission acknowledgement from Electron's completed update/status response.
No new bridge capability, updater, server route or retry mechanism is added.

Cefrium's activity calls `EditorAssetManager.forceUpdateFromServer`, then clears
the browser cache and reloads only on success; native feedback handles failure.
Gecko already wires the same gateway route to `updateTe2Ui` and its guarded
force-update/cache-clear/reload implementation. The ordinary Gecko/Cefrium
settings entry uses `app/android_shell/host.js`, whose update method already
posts to that Android endpoint.

## APK seed and interception

All three APK targets consume `android/app/src/main/assets/editor_static`:
Gecko through the app main source set, Cefrium and TE2 Termux through the shared
assets source set in `android/cefrium/build.gradle.kts`. The Termux-specific shell
and embedded Node assets are additional generated source sets, not replacements
for that editor seed.

`app/android_editor_assets_bundle.json` and `scripts/bundle_gecko_assets.sh`
declare/publish the seed. Existing `native_builtin_asset_coverage.test.mjs`
checks canonical and by-ID app entry URLs, literal static dependencies, shared
helpers, fonts and exclusions against inventories and Gecko/Cefrium routes;
Termux reuses Cefrium routes. `launcher_icon_assets.test.mjs` checks icons.
These nine tests pass. Four Python asset-route tests also pass. Dynamic APIs,
sockets, private resources and extension-owned resources remain outside static
interception.

Read-only manifest expansion and byte comparison found 445 expected seed files,
zero missing files, zero extra files, and 16 stale files:

- `apps/als_rs/frontend/manifest.json`
- `apps/als_rs/frontend/static/dist/codex_agent.js`
- `apps/als_rs/frontend/static/js/codex_agent/composer/runtime.ts`
- `apps/als_rs/frontend/static/js/codex_agent/render/utils.ts`
- `apps/als_rs/frontend/static/js/codex_agent/rpc/ui/client.ts`
- `apps/als_rs/frontend/static/js/codex_agent/transcript_cards.ts`
- `apps/als_rs/frontend/static/js/console_bridge.js`
- `static/js/file_explorer_main.js`
- `static/js/file_explorer_terminal.js`
- `static/js/te2_console_bridge.js`
- `apps/code_te2/static/dist/host.js`
- `apps/code_te2/static/dist/explorer.css`
- `apps/code_te2/vendor/android-terminalapp-assets-js/touch_to_mouse_handler.js`
- `apps/terminal/template.html`
- `apps/terminal/static/dist/main.js`
- `apps/terminal/vendor/android-terminalapp-assets-js/touch_to_mouse_handler.js`

Comparison applied declared tree/file/glob/template/version transformations and
exclusions without writing the seed. It proves current source/seed disagreement,
not installed-client contents. Refresh the seed with the established bundler
before final assembly, repeat the comparison, then inspect each final APK's
payload. Same-version installs may retain newer/equal app-private assets; force
OTA is a separate device acceptance step, not something static analysis proves.

Subsequent user-approved refresh: `bash scripts/bundle_gecko_assets.sh` completed
and the independent manifest/source byte comparison now finds all 445 files
matching, with zero missing/stale/extra files. The nine static inventory/routes/
icon tests pass again. Seed source version remains `0.2.353`; this operation did
not bump versions, build APKs or touch Rust/mypyc artifacts. The original stale
list above is retained as audit evidence, not outstanding seed work.

## Accepted native builds and next release

User reports the current Rust binaries and newly completed mypyc extension run
well and wants them retained. This slice does not compile, activate, select,
delete or replace native artifacts; later packaging must validate/reuse their
existing receipts rather than infer acceptance for arbitrary artifacts.

User direction: this is the last three-APK release (Gecko, Cefrium, TE2 Termux).
The following release should have one Android application/codebase with
standalone and Termux/shared-UID build variants using the same selected renderer,
not two independently maintained applications. Renderer choice and migration are deferred;
none of the three current APK targets is removed by this fix.
