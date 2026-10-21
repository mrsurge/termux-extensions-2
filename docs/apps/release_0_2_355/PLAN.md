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

2026-10-19 renewed approval supersedes the APK-build hold: build all three .355
staging APKs on Debian, audit them, and copy to desktop Downloads. No device
installation or publication is approved. Include the latest Termux lifecycle and
auxiliary-context fix; preserve the current uncommitted source patch provenance.

### Termux scale lifecycle correction — approved 2026-10-19

User reports selected accessibility scale disappears after background/foreground;
the briefly visible old scale does not survive actual renderer reattachment.
Other APKs work. Approved scope is Termux-only main-browser native lifecycle
correction, focused unit/source checks and docs, with NO APK assembly/install.

Source/pinned SDK inspection: Activity resume/focus reapplies scale, but the
controller stops after its first WebContents-ready success. It did not observe
the SurfaceView or Chromium WebContents reattachment. In pinned Cefrium 0.9.0,
setPinchToZoomEnabled(false) also asynchronously rewrites viewport metadata;
calling it on each reapply introduces an unnecessary competing update. These
are confirmed source gaps, not a captured proof of the exact device reset order.

Further source-backed cause: main, toolbar and tools previously used the same
normal browser context/loopback host. Their resume order writes the chosen main
scale followed by auxiliary 100% resets. Chromium's HostZoomMap JNI writes both
the underlying host preference and the adjusted rendered scale; it is not an
isolated per-view property. Reference:
[Chromium host zoom implementation](https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/content/browser/host_zoom_map_impl.cc).
User separately approves isolating Termux auxiliary browsers through Cefrium's
existing private-context creation overload. Toolbar/inspector/process UI shares
an ephemeral context; the main page keeps its existing normal persistent context.
No profile migration or cookie/storage loss for the main page; auxiliary UI
storage becomes ephemeral. Non-Termux targets keep normal context creation.

Restore saved scale before browser.onResume(), then use SurfaceHolder and
WebContents visibility/native-window/frame/page callbacks for native restoration.
Apply synchronously and once after the current UI-thread handoff; fence stale
callbacks/queued work and remove listeners on close. Preserve initial SDK pinch
policy plus native gesture suppression, but omit repeat viewport-JS injection
for the Termux lifecycle path. No global host/default zoom, engine fork, CSS zoom,
infinite polling, altered background-rendering policy or other-renderer change.
Compile shared Android source and run JVM/source tests only. Device seamlessness
remains pending a separately approved APK. The connected Pixel has an older POC,
not the user's current reported test build, so do not claim live reproduction.

The shared source seed is refreshed to .355 (445 files); no .355 APK exists yet.
Android source-only changes do not change the already-built candidate wheel
runtime payload. Final source/tag provenance still needs normal reconciliation.

### Artifact sequence (APK steps on hold)

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

Completion 2026-10-19: user-approved wheels/APKs are published as .355; PyPI
hashes and all eleven public GitHub downloads verified, normal Latest enabled.
After a separate bounded cleanup approval, 22 obsolete Debian test installs were
removed (actual 16.6 GiB recovered). Protected paths and all build/native caches
remain. Earlier holds/approval statements above describe the execution sequence;
they are superseded by the completed gates and exact inventory in TRACKER.md.
