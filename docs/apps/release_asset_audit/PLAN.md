# Release asset compression and retired vendor audit

## Approved scope

Inspect shipped APK ZIP compression and wheel/OTA inventories. Remove confirmed
unused Highlight.js and orphaned registry plus deprecated Monaco JS/CSS; retain
source maps and all accepted release artifacts. Upload the exact accepted 0.2.353
Android wheel to PyPI beside the Linux wheel, not rebuilt current-branch content.
Update README release references and platform-wheel guidance. No APK assembly,
native compression flag changes, runtime restart or dependency refactor.

## ALS proxied static frontend interception — additional approved slice

Bundle immutable ALS static resources for Electron, Gecko, Cefrium and TE2 Termux
under the existing native asset pipeline. Only the TE2 wrapper was previously
mapped; actual frontend URLs use `/api/app/als-rs/proxy/static/`.

- Pin ALS 0.2.132 source/served hashes, commit/version and license in the app-owned
  vendor tree. Preserve all static scripts/fonts/images/WASM/auxiliary files
  except the existing excluded map/backup suffixes; regenerate explicitly.
- Project text using the existing ALS proxy rewrite declaration, bypassed by
  local responses. Add full shared OTA/APK tree, core required inputs and static-
  only mappings. Resolve Gecko local-origin aliases, WASM MIME and no-store.
- Preserve dynamic HTML/runtime transport settings, APIs/sockets and installed
  extension resources on the proxy. Provenance is not remote-version negotiation.
- Validate complete inventory/hashes/routes, existing built-ins, Electron types/
  tests and isolated Kotlin route tests; update owning docs/repo memory.
- No dependent-repo edits, framework restart, APK assembly or client publication.
  Route changes need rebuilt clients and matching assets; older APKs cannot gain
  native routing from editor OTA alone. Live acceptance is a separate gate.

## Earlier retired-vendor work

- Current snippet highlighting uses shared TextMate. Highlight.js vendor tree
  has no production consumer; its generated TS language registry is orphaned.
- Both accepted wheels contain 394 Highlight.js entries, 1,673,031 bytes raw,
  535,737 bytes compressed. Neither tree is present in shipped editor APK assets.
- Deprecated Monaco JS/CSS/maps are already excluded from wheels and not declared
  in Android/OTA inventories. Retain map files on source disk; remove JS/CSS only.
- Remove unused vendor files/registry and defensively exclude stale Highlight.js
  from source archives, ordinary wheel staging and private-domain materialization.
  Do not strip other apps' independent dependencies.
- Rebuild/typecheck frontend and validate TextMate rendering/package policy.
  Existing release wheel/APKs remain immutable; cleanup affects future builds.

## APK compression evidence

0.2.353 Cefrium and TE2 Termux editor assets are already ZIP-compressed. Recompressing
stored assets with raw Deflate level 6 estimates 6,458,729 bytes savings, primarily
`icudtl.dat` (6,177,399) and `stored-locales/en-US.pak` (236,697). These are native
CEF resources under explicit `noCompress` policy; this is not a safe savings claim
without auditing extraction/mmap requirements. No flags changed. Gecko's analogous
stored-asset estimate is only 27,587 bytes (a PNG); no meaningful JS/CSS opportunity.

## PyPI publication

Accepted production Android wheel:
`te2-0.2.353-cp314-cp314-android_24_arm64_v8a.whl`, 48,653,226 bytes,
SHA256 `884d2620872913ff9f90b287c4f0fe44de37d37c1c6addb1cb9fdbe81a5bed9d`.
Pixel metadata/tag inspection confirms matching pip tags and Android-specific
dependency-marker selection. Desktop Node dependency remains Linux/x86-64-only.
Use isolated Debian publishing tooling and ephemeral SSH-stdin credentials.
Verify on Pixel, local transfer, publisher and published PyPI metadata; prove pip
selects Android vs manylinux without installing/restarting environments.

PyPI's per-file limit permits separate platform wheels under one project/version:
[compatibility tags](https://packaging.python.org/en/latest/specifications/platform-compatibility-tags/),
[storage limits](https://docs.pypi.org/project-management/storage-limits/).
TE2's own wheel is prebuilt; dependent native packages may still require Termux
build tools or the recommended installer's audited wheelhouse. Publishing this
artifact does not fold current editable-bootstrap changes into the released wheel.

## Next workstream, not started

User requests removing FastAPI from the remaining app workers after this slice.
Inventory worker imports/routes/lifecycle and transitive dependencies, establish
raw ASGI/native alternatives per owner, then remove runtime requirements only
after route, transport, lifecycle and installed-wheel parity are proven. Maintain
a dedicated plan/tracker when implementation begins. No dependency is removed here.
