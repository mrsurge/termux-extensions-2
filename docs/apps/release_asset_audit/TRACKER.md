# Release asset audit tracker

- [x] Read-only investigation and concrete cleanup/publication approvals.
- [x] APK compression inventory/Deflate savings estimate.
- [x] Remove 397 confirmed unused source files; preserve `.map` files.
- [x] Stale Highlight.js packaging exclusion and regression tests.
- [x] Code TE2 frontend typecheck/build; 14 focused snippet/diff tests pass.
- [x] README version/download references updated from 0.2.352 to 0.2.353.
- [x] Android wheel copied Pixel → local → Debian; exact accepted SHA256 verified.
- [x] Twine metadata check and upload succeeded using isolated Debian tooling.
- [x] Verify published PyPI digest and platform-specific pip selection.
- [x] Final package/native-runtime regressions: 50 pass.

The asset-route suite has one pre-existing failure:
`test_main_mounts_only_resources_from_editor_http_boundary` asserts
`TE2_ASGI_APP = build_code_te2_asgi_app(` is in `main.py`, but HEAD already moved
HTTP/Socket.IO ownership to the Rust native worker. Do not restore retired Python
serving to satisfy this stale assertion; test modernization is deferred to the
next FastAPI-dependency cleanup workstream. Other 53 tests in that run passed.

No native APK compression settings, accepted artifacts, installed environments or
running frameworks/workers were changed. Earlier uncommitted mypyc tooling changes
and unrelated user files remain preserved.

Published PyPI SHA256 matches the accepted Android wheel exactly:
`884d2620872913ff9f90b287c4f0fe44de37d37c1c6addb1cb9fdbe81a5bed9d`.
Existing Linux wheel/sdist digests are unchanged. Pip dry-run on isolated Debian
publisher selects the Android cp314 wheel for android_24_arm64_v8a/CPython 3.14,
and the manylinux wheel for Linux x86-64/CPython 3.13. No package installation
took place. PyPI index propagation initially returned older listings; fresh
metadata and a subsequent Android dry-run verified successful publication.
