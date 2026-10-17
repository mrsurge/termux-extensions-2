# ALS-RS proxy wrapper and native static assets

## Worker serving readiness

TE2 launches `als-rs --stdio --port 12459` as a native-testing pipe shell.
`readiness_support: "pipe"` makes the current worker's `app.readiness`
MessagePack notification the only serving gate. After router preparation and
listener bind, ALS emits `status: ready`, `phase: serving` to framework.rust.
The stream uses concatenated MessagePack envelope maps, NOT the separate
extension-adapter's length-prefix framing. Stdout is protocol-only throughout
bootstrap/native startup; diagnostics/build output go to stderr. There is no
HTTP callback/probe fallback. `/api/health` remains an ordinary diagnostic route.

Without --stdio, ALS is still standalone: no framework readiness publication or
stdin ownership. Pipe EOF ends the owned server; malformed/truncated pipe input
fails explicitly. Unknown requests receive framework method-not-found errors;
this does not implement Sidebar intent migration. The existing
sidebar_state.readiness.callback controls UI presentation readiness separately.
The frontend wrapper trusts app_shell's framework readiness gate rather than
polling /api/health a second time; its metadata request still resolves start_url.
Activation needs the new ALS install, refreshed TE2 registry/worker launch and
updated wrapper bytes through OTA/reload. No Code TE2 mypyc or APK is required.

TE2 opens ALS through `/api/app/als-rs/proxy/`. The wrapper's `main.js` and
`template.html` remain generic proxy-shell resources; native clients also package
the actual ALS static frontend, not just that wrapper.

## Pinned frontend snapshot

`vendor/frontend/manifest.json` pins the ALS version, source commit, source/served
SHA-256 inventories and license. `vendor/frontend/static/` contains all 148 static
resources (~4.82 MiB raw), excluding the existing map/backup policy. No backend,
templates, installed-extension assets or mutable runtime data are vendored.
Reproduce/update explicitly from a clean ALS checkout:

```bash
python -B scripts/vendor_als_frontend.py --source-repo ../agent_log_server
python -B scripts/vendor_als_frontend.py --check
```

Do not hand-edit this managed snapshot. Static/version/license source must be
committed; missing inputs, unknown vendor content, symlinks or modified snapshots
fail instead of silently replacing user files. Text is projected according to
the existing ALS quoted API/WS/static and CSS URL rewrite declaration because
local serving bypasses the server response rewrite. Source and served hashes
distinguish this projection; binary fonts/images/WASM remain unchanged.

The shared OTA/APK manifest packages `apps/als_rs/frontend/`. Electron and Gecko
map `/api/app/als-rs/proxy/static/*` into its `static/*` subtree. Android's shared
`AlsProxyAssets` alias is used by Cefrium/TE2 Termux and Gecko's LocalAssetServer,
including module/CSS requests on the redirected local origin. WASM uses
`application/wasm`; ALS local responses use no-store across same-version OTA.
Provenance/core scripts and CSS are required before OTA activation.

ALS HTML remains server-rendered because it contains runtime-selected socket and
transcript transport settings. API/health/socket, manifest/service-worker and
installed-extension routes stay remote through the proxy. Never intercept the
entire `/proxy/` or `/api/` namespace. Provenance records the bundled version; it
does not negotiate compatibility with unknown remote ALS versions. Align ALS and
this snapshot when upgrading/releasing; validate different remote versions.

Activation is separate: native route changes require rebuilt Electron/Android
clients plus matching OTA/APK seed publication. No deployment, APK assembly or
runtime restart is implied by build success. The complete shared Android seed
publisher is `scripts/bundle_gecko_assets.sh` (all three Android targets).

## Reusable proxy-shell template

This is a first-party template for onboarding non-native worker apps through the shared `proxy_shell` engine.

Copy this directory to `app/apps/<your_app_id>/` and then update:
- `manifest.json` (`id`, `name`, `description`, icon, and `proxy_shell` paths),
- `shellspec/app_worker.yaml` (worker command + readiness),
- optional UI styling/text in `template.html`.

The `main.js` file is app-id agnostic and resolves `app_id` from `/app/<app_id>` URL path at runtime.

## Expected Runtime

- Proxy metadata endpoint:
  - `/api/apps/{app_id}/proxy_shell`
- Proxied start URL and health URL are read from that endpoint.

No per-endpoint proxy module is required.
