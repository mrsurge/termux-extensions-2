# 0.2.355 corrective release plan

Created 2026-10-19 from checkout `1041fa4a`. This is the execution owner for
the post-.354 corrective artifacts. The .354 plan/tracker and user notes remain
intact as historical implementation and acceptance evidence.

## Scope and invariants

Ship the accepted Electron New Project/floating-picker repair and TE2 Termux
toolbar/accessibility scaling. Retain Cefrium 0.9.0 and existing renderer targets.
This version number does not activate previously deferred .355 framework-pipe,
sticky-scope, renderer, shared-library or other architectural work.

Published .354 PyPI artifacts and tags are immutable. Keep the existing .354
GitHub release draft unpublished; prepare its eventual .355 replacement only
after corrected artifacts pass validation. ALS .139 and FWS .65 remain unchanged.
No shared runtime restart, data clearing or automatic device installation.

## Ordered procedure

1. Approve the concrete source checkpoint/build scope, then align package,
   framework, Electron and three APK versions/codes to .355. Preserve the
   installer's .354 compatibility cutoff. Commit only the approved source,
   generated assets, tests and documentation; preserve unrelated files.
2. Build on Debian (`100.74.145.70`) in fresh named output/validation roots,
   retaining existing compiler/toolchain caches. Rebuild/relink the framework
   because its version is embedded. Reuse accepted editor-worker/mypyc artifacts
   only where complete source/ABI/hash receipts validate reuse; do not merely
   relabel old payloads. Linux retains private CPython 3.14.6/libpython.
3. Use the connected Pixel (`~/mrselect6`, APK-started Termux SSH) for the Android
   wheel lane if needed. Inspect dirty source, concurrent builds and free space
   before syncing. Reuse its verified compiled domain when valid. No broad cache
   deletion; retain accepted snapshots and previous selections.
4. Validate Linux and Android wheels as one acceptance group in fresh isolated
   venvs: strict <100,000,000-byte wheel budget, version/receipts/native closure,
   compiled imports, actual Node/WBA, joint ALS/FWS and platform uvloop selection.
   Stop for user live acceptance before publication.
5. Refresh the shared editor asset seed, then assemble Gecko, Cefrium and TE2
   Termux staging APKs on Debian. Audit final ZIP payloads against seed, URL
   interception, versions, native/DEX compression, signing and alignment; retain
   matching R8 mappings. The accepted accessibility debug APK is not a final
   staging artifact. Stop for grouped APK live acceptance.
6. Final packaging must pass existing clean-source/tag provenance gates. Candidate
   builds may precede the tag; final tag/source receipts and final wheel hashes
   require revalidation. Never weaken production gates to reuse a candidate.
   Obtain release permission before uploading wheels, changing tags/draft identity
   or publishing GitHub; verify uploaded digests and final installer inventory.
7. Only AFTER successful builds and wheel publication: inventory obsolete Debian
   release acceptance/build copies and present a bounded deletion dry run. Retain
   latest wheels, active-process references, accepted current artifacts and caches.

## Debian cleanup exclusions — mandatory

Never remove or modify these protected trees during cleanup:

- `/home/mrsurge/joint-stable-0.2.354-als-0.2.139/`
- `/home/mrsurge/geckotron/`
- Any `.codex` directory (conservatively preserve `.codex*` and descendants).

Do not delete a parent that contains an excluded tree. The user permits removal
of the similarly named `/root/joint-stable-0.2.354-als-0.2.139/` duplicate if it
exists and is verified unrelated to protected/live state. Discover exact paths
first. No blanket filesystem, Docker, Cargo or SDK pruning. Cleanup is deferred,
not an immediate way to create build space.

## Progress and evidence

TRACKER.md owns current gates and artifact receipts. The .354 BUILD_STATUS.md
retains accepted predecessor hashes and build nuances; do not overwrite them.
