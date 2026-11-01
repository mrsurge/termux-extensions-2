# 0.2.357 plan

## User-priority intake — ahead of the existing backlog (2026-10-31)

Work in this order; further user additions may precede the older sections below.
Preserve the existing deferred work and its acceptance/history.

1. **Experimental WBA native AOT trial.** Follow the repository-root SKILL.md
   (bun-typescript-aot), distinguish true native AOT from JIT/bytecode executable
   bundling, and verify actual toolchain support before building. Local Bun
   1.3.14 does not advertise AOT. Use a separately pinned toolchain and visible
   project workspace on the VPS, not a global upgrade. Audit the current typed
   WBA entrypoint, dynamic/runtime-relative module resolution, VS Code runtime
   imports and browser-served assets. Attempt an isolated native Linux build;
   preserve diagnostics and compare compatible JIT/source controls. No production
   launcher/transport change, shared restart, APK packaging, Any escape hatch or
   unapproved source rewrite. A successful compile is not integration acceptance;
   test readiness, actual protocol traffic and relocated assets before adoption.
   Assess Termux platform support separately; do not assume a glibc binary works.
   Read the supplied skill directly; formal skill installation is not required.
2. **Main page and app-shell favicons.** Audit actual rendered HTML and routes.
   Both templates currently declare manifest/apple-touch icons but no explicit
   standard favicon. Reuse TE2's existing icon for the launcher and resolve app
   shell icons from existing manifest/registry metadata with a TE2 fallback.
   Preserve image/text/emoji distinctions and URL safety; avoid app-ID branches.
   Check client interception/OTA mapping as well as browser HTTP behavior.
3. **Client framework-bookmark settings consistency.** Move the create-bookmark
   affordance immediately below the host/port/Connect row. Collect bookmark name
   through the existing generic text-entry dialog, rather than its separate
   permanent inline name field. Audit Electron's shared android_shell UI and
   Gecko/Cefrium/Termux native settings paths; reuse established dialog methods,
   preserve saved bookmarks/connection behavior, and validate cancel/empty/error
   flows and narrow/wide layouts. Android source/bundle/build changes require
   approval of that implementation slice; scheduling is not publication approval.

User approves recording this intake and isolated VPS AOT investigation/build on
2026-10-31. Favicon/settings implementation remains a subsequent approval gate.

First trial: actual AOT requires the tested canary da867c60b, not the current
stable 1.4.4 release despite documentation examples. Unchanged WBA compiles and
passes AOT type checking, but its executable cannot start after relocation due
to missing runtime theme assets; JIT bundling also has a runtime-relative vendor
import failure. The ordinary generated-dist process passes isolated protocol and
asset controls under the same Bun. Approve a concrete packaged-asset/module-root
strategy before further edits; compilation alone is not adoption. Full receipts
and exact commands/limits are in TRACKER.md. Keep the root user-supplied SKILL.md
unchanged and qualify its toolchain assumptions with observed evidence.

2026-11-01 packaging follow-up: an explicit app-level build root and embedded
shipped resources resolve AOT startup and browser-asset lookup without production
code edits. The generated codec is staged byte-identically at its source-relative
resource path in the disposable build checkout. Relocated executable passes
isolated pipe/Socket.IO/HTTP/asset/EOF checks even with that checkout temporarily
hidden. User-installed themes/extensions remain external runtime inputs; they
are not embedded. Full code-server/exthost and installed-theme integration is
still required before adoption. The JIT standalone has separate import/asset-name
problems; retain the passing ordinary dist process as the qualified control and
do not claim a complete AOT/JIT performance comparison. Exact receipts: TRACKER.md.

WBA follow-up approved 2026-11-01: implement the missing optional
@socket.io/bun-engine for Bun/AOT, retain Node/missing-module fallback and a
TE2_WBA_BUN_ENGINE=0 diagnostic control. Share HTTP/RPC logic, not a loopback
proxy, and report the actual engine. Rebuild AOT before comparing interpreted
and compiled transport behavior; older benchmark receipts used standard
Engine.IO in every mode. Preserve the live experimental launcher until the user
approves replacing it. Pixel Termux compilation remains a separate next test.

## Release dependency order: wheels before APKs

User requires this order beginning with the next release (2026-10-28): finish
and jointly validate companion/runtime wheels on Linux and Termux first, then
make those exact versions available to the APK install/start workflow, then
freeze/bundle/build the APKs and perform device acceptance against those wheels.
APK-local assets do not remove the dependency on the installed framework/editor
backend. Do not present a new APK tested against an older backend as complete
release validation. Preserve separate wheel and APK acceptance gates; do not
start final APK packaging before its wheel prerequisites are ready.

## Fail-closed built-in asset routing

Deferred from .356 by the user on 2026-10-27 to preserve the release schedule.
The corrected exact codex-ext approval-module alias remains in .356; broader
routing hardening is not a .356 release blocker.

The approval incident exposed different miss behavior: Cefrium/TE2 Termux's
unmatched module request fell through the framework relay to the server, hiding
the bad local alias, while Gecko's local asset origin returned 404. Bundled-file
presence and hashes did not prove that the actual dynamic-import URL was local.

Define a manifest-backed distinction between local-only built-in static assets
and genuinely dynamic/backend requests. Declared asset requests must fail closed
when missing or unmapped, never silently fetch from the upstream server. Preserve
normal API/socket/document routing; do not indiscriminately block unknown API
requests. Audit Gecko, Cefrium, TE2 Termux and Electron against the same contract.

Add end-to-end regressions for actual request URLs, redirected ESM/local-origin
imports, absent files and incorrect aliases. Verify that asset misses generate
clear failures and zero upstream requests, while dynamic routes still proxy.
Resume only with separately approved implementation and client validation.

## Code TE2 pipe concurrency — deferred O2 continuation

Deferred from .356 at the user's request on 2026-10-26. Completed DTO/PyO3
byte-ingress/native-type optimizations remain accepted, not pending work.
The user reports searching 6,000+ files and delivering all needle-in-a-haystack
results in under one second without earlier stalls. This is user-observed
behavior, not a controlled benchmark or a new throughput guarantee.

The original request includes multiprocessing, multithreading and event queuing
on Code TE2's receiving/processing side, using the main framework scheduler as a
reuse candidate. Tokio tasks alone are not multiprocessing. Historical synthetic
Ferrous/JSON-RPC tests demonstrated tens of thousands of concurrent real RPCs
per second; the reported search backpressure was Python-worker intake, not FD
transport capacity. Preserve that distinction when investigating.

Resume only if workloads demonstrate sustained queue pressure, unrelated RPC
responsiveness problems, or a new concurrency requirement. Audit the current
framework scheduler and Python ownership/GIL boundaries before choosing processes,
threads or bounded queues. Preserve ordering, cancellation, bounded memory and
state authority; measure a user-visible benefit against coordination and
serialization costs before production adoption. Scheduling this backlog does
not approve implementation or require resuming it first in .357.

## Shared Rust runtime libraries

User defers this work from .356 on 2026-10-25. Target final product size,
duplicated build work and developer ergonomics, not request-speed claims.
No production integration, build, version bump or publication is authorized
by this scheduling decision.

Preserve the isolated source and methodology in
../../../framework/shared_runtime_probe/README.md and historical evidence in
../release_0_2_356/TRACKER.md (O5). The equally stripped C-ABI cdylib fixture
reduced total ZIP bytes from 1,136,342 to 902,159 (~20.6%), with library-only
private implementation updates. Initial build times were essentially tied.
These are small synthetic fixture results, not production savings estimates.
The earlier ordinary Rust-dylib control was larger and is not the intended design.

## Continuation gates

1. Approve a bounded production candidate/API after auditing actual duplicated
   linked code. PyO3 is worker-only, not a shared framework dependency.
2. Specify versioned C ABI, buffer/handle ownership, panic/error boundaries,
   library identity and relocation. A compiler pin does not stabilize Rust ABI.
3. Qualify dependency/Ferrous alignment and platform-specific compiler/toolchain
   policy; preserve Linux private Python versus Termux system ABI boundaries.
4. Design manifests, fingerprints and receipts so private implementation changes
   rebuild the library without rebuilding compatible consumers. The PoC driver
   demonstrates this policy; production bootstrap does not implement it yet.
5. Measure complete compressed wheel/native payloads and clean/incremental
   builds; validate loaders, missing/wrong libraries and compatible replacement
   on Linux and Termux before adoption or release.

Direct search/FS/Git operations reuse is a separate potential stage, not implied
by shared packaging. Preserve authoritative framework state, authorization and
scheduling; do not create competing owners. Runtime activation and live acceptance
remain explicit gates after any separately approved implementation.
