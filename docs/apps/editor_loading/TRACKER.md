# Editor loading maintenance tracker

- [x] Approve separate maintenance scope and branch.
- [x] Create initial plan and source entrypoint inventory.
- [ ] Complete end-to-end file/theme/TextMate loading and cache audit.
- [ ] Identify request/byte counts and sequential dependency waves.
- [ ] Establish cold/warm Markdown and comparison-language baselines.
- [ ] Audit rapid file switches, reconnect and primary/secondary readiness races.
- [x] Approve a concrete implementation slice supported by evidence.
- [x] Implement and pass delayed-response regression tests/build validation.
- [ ] Publish matching assets/compiled domain to explicitly approved test clients.
- [x] Record user acceptance of the observed Markdown/cache and browser HTTP paths.
- [ ] Prepare maintenance release only after separate release approval.

Acceptance is not implied by implementation or static checks. Record measurements
and concrete findings here as they become available.

## Offline dependency probe (2026-10-09)

- [x] Repeatable real-parser/production-batch-loader probe, no runtime mutation.
- [x] Synthetic transitive dependency/injection batching, warm cache and revision
  reset regressions: 2 tests pass.
- [x] Installed bundled Code Server 4.130.0 comparison with 200ms simulated RPC cost.
- [ ] Capture the active native client's registry/request trace; offline inventory
  alone does not prove its exact grammar selection or cause of a reported stall.

| Root scope | Body count | Raw bytes | Cold RPCs | Cold time | Warm RPCs/time |
| --- | ---: | ---: | ---: | ---: | ---: |
| text.html.markdown | 72 | 3,640,286 | 7 | 1,051ms | 0 / 28ms |
| source.python | 1 | 78,248 | 1 | 203ms | 0 / 1ms |
| source.js | 4 | 382,925 | 4 | 811ms | 0 / 3ms |

Markdown discovery waves contain 1, 58, 10 and 3 bodies. Actual loader batch sizes
are 1, 16, 16, 16, 10, 10 and 3; its two-active-batch limit subdivides the large
wave. Revision reset repeats all cold requests (Markdown 1,036ms). Warm body-cache
reuse transfers no bodies. These are offline simulated results, not device timings.
Markdown's own grammar is only 60,461 bytes; embedded/injected dependencies dominate
the cold closure. Throughput remains relevant as well as sequential latency.

Source observations: model attachment awaits grammar preparation; ordinary live
opens are queued, so an awaited grammar alone is not proof of an overlapping-open
race. Revision-tagged notifications skip unchanged projections, while the generic
extension-contribution refresh resets grammar bodies without an expected revision.
Audit that refresh's frequency before proposing cache retention. Backend batch
reads reload the persisted registry and stat/read requested grammar files; no WBA
fetch is involved. Closure delivery must preserve those revision/resource guards.

## Closure projection / cache retention slice (2026-10-09)

- [x] Backend reachable-dependency resolver and revision/resource-guarded editor RPC.
- [x] Cache-aware bounded preload; oversized graphs retain the existing batch path.
- [x] Atomic browser cache seeding, single-flight preparation and stale-reply fencing.
- [x] Same-revision contribution refresh preserves installed tokenizers/cache.
- [x] Synthetic closure equivalence against the real pinned TextMate loader.
- [x] Installed bundled-grammar closure matches earlier probe counts/raw bytes:
  Markdown 72 / 3,640,286; Python 1 / 78,248; JavaScript 4 / 382,925.
- [x] Python projection/dependency/editor-boundary tests; browser loader and actual
  Oniguruma/provider-refresh regressions; theme regressions.
- [x] Targeted Python static checking, frontend typecheck and `node build.mjs`.
- [x] Local matching mypyc rebuild/activation; 136 compiled imports validated.
- [ ] Authorized app lifecycle transition to load the selected group.
- [ ] Native client asset publication and live poor-connection acceptance.

One closure RPC now seeds the synthetic transitive graph; the real TextMate loader
then constructs it with zero follow-up body requests. No measured device-speed
claim follows from these tests. Catalog, selected-theme and content transactions
remain separate and are candidates for a later end-to-end audit.

Local rebuild on 2026-10-09 used ordinary system CPython 3.14.4 via `.jitenv`,
the existing compiler cache and ccache. Build took 337.90s; validation loaded all
136 compiled modules with none missing. Selected snapshot:
`~/.cache/te2/code_te2/build/mypyc-snapshots/check-20261009-184442-1791571482880455460`.
The existing selector retained the previous group. Running workers and client
assets were not changed. Lazy grammar projection/dependency helpers remain source
modules outside this startup compilation group, as intended by the current inventory.

## Live closure timeout probe

The current Cefrium main-page probe captured an 8-second timeout on
`editor.textmate.closure.get` before README model mounting, followed by a second
closure timeout and host file-open timeout. No comparable main-thread long task
preceded model mounting; the request/reply cause is not yet established.

Temporary diagnostic shellspec sets `CODE_TE2_MYPYC_DIR` to empty, retaining the
Rust executable/transport while interpreting the Python domain on the next app
worker restart. Restore its environment substitution after this comparison.
Runtime-debug-only `[textmate_probe]` logs identify request, dispatch, registry,
per-grammar read/parse, traversal, return and reply-emission stages without body
contents. Existing `runtime.debug.eval` is already bound to the Python domain
inside the Rust worker; compiled mode does not inherently remove that route.
The user owns the pending worker restart; no framework restart or OTA was done.

## Bundled Markdown dependency cache

- [x] Deterministic built-in 4.130.0 cache: 72 bodies, 4,153,325-byte JSON asset.
- [x] Compact closure selection/fingerprints; no body payload in metadata mode.
- [x] Verified local seeds, exact ID/hash matching, extension-override misses.
- [x] 64 KiB UTF-8 chunk replies, codepoint offsets, two-stream limit and revision fences.
- [x] Oversized-prefix on-demand reads stay bounded; no WBA fallback.
- [x] Existing Android/Electron TextMate inventory covers the new asset.
- [x] 19 Python and 22 Node regressions pass; targeted Python static checks clean.
- [x] Frontend typecheck and host rebuild pass; source diff whitespace check clean.
- [ ] User client OTA and live high-latency Markdown/markup acceptance.

Local validation and rebuild results are recorded at handoff. No worker/framework
restart, APK assembly, device installation, OTA, version bump or commit performed.

User subsequently reported Markdown loading is instant with the cache slice.
This is acceptance of that observed client/path, not every client or markup language.

## Generic-browser gzip delivery

- [x] Shared opt-in asset policy; framework frontend and Code TE2 worker wired.
- [x] Gzip negotiation and decompression round-trip tests pass in both binaries.
- [x] Refused/absent gzip, Brotli-only, ranges/HEAD, encoded and unmarked bodies bypass.
- [x] Worker preserves Accept-Encoding variation alongside CORS Origin.
- [x] Both Rust cargo checks pass; bootstrap cache-input regression passes.
- [x] Bootstrap tests: 11 pass with inherited worker selectors removed from test env.
- [ ] Rebuilt runtime activation and actual browser response/header acceptance.

No APK/client-asset changes or shared-runtime restart. UUID correction and stable
loopback ports are not implemented in this gzip slice.

## Plain-HTTP browser UUID correction

- [x] Reuse pinned Monaco `generateUuid`, including its secure-byte fallback.
- [x] Host client/window, native bridge, console/terminal and Sidebar ID callers updated.
- [x] Plain-HTTP regression with `randomUUID` absent verifies UUID bits, persistence,
  separate primary/secondary identities and explicit reset.
- [x] Frontend typecheck and host bundle rebuild pass.
- [ ] Generic-browser live acceptance after loading the rebuilt assets.

Native installation identity and stored values are preserved. No global Crypto
polyfill, new dependency, backend/runtime restart, APK build, OTA or version bump.

## Generic-browser grammar HTTP delivery

- [x] Guarded dynamic route outside native asset interception; RPC selection retained.
- [x] Browser-only HTTP misses; native packaged/chunk path unchanged.
- [x] Bounded reads/deadline, gzip marker, no-store and revision/hash guards.
- [x] 19 Python and 9 Node grammar regressions; frontend typecheck/build pass.
- [x] Rust query regression passes.
- [x] Final native-worker cargo check.
- [x] User live acceptance: generic-browser HTTP grammar loading works remarkably well.

No shared-runtime restart, APK work, OTA, version bump, commit or publication.

User acceptance above records the tested browser path, not universal native-client
or release-package acceptance. The interpreted-domain diagnostic shellspec remains
selected in this checkpoint; restoring compiled activation is a separate step.

## Deferred work — execution order

- [x] 1a. Rebuild/validate current mypyc group and restore compiled selection.
- [x] 1b. User live acceptance of the newly selected compiled group: working good.
- [x] 2a. Implement preferred native loopback ports; source/tests/compile validation.
- [ ] 2b. Native deployment and cross-relaunch live origin/storage acceptance.
  Razr TE2 Termux staging is installed and user live-accepted; explicit origin/
  storage survival across relaunch and other client deployment remain separate.
- [x] 3. Investigate polling/WebSocket compression independently; benchmark before enabling.
- [x] 4. Design/validate persistent revision/ID/hash-scoped grammar caching across reloads.
- [x] 5. Investigate OTA archive/transfer compression and compatibility; retain Deflate ZIP.
- [x] 6. Finish poor-connection cold/warm, switch/reconnect and secondary-editor audit.
- [ ] 7. Read-only unused vendored/stale asset inventory; report evidence and sizes,
  accounting for dynamic loaders and package manifests. No deletion approval.
- [ ] 8. Separately approved maintenance release: matched binaries/domain/assets,
  staging APKs, target acceptance, merge/tag/publication.

Older publication/lifecycle checkboxes above describe their specific checkpoints.
User acceptance establishes the observed Markdown and generic-browser HTTP paths;
it does not establish all-client OTA, compiled-mode, gzip-header, UUID-specific or
packaged-release acceptance. Those unverified gates remain open. See PLAN's
Deferred follow-up sequence for scope and approval boundaries.

## Compiled restoration checkpoint (2026-10-09)

Cached build through `.jitenv/bin/python -B app/apps/code_te2/build_mypyc.py`
completed in 434.25s with ccache enabled on ordinary CPython 3.14.4. Isolated
validation loaded all 136 compiled modules, none missing (144.96ms import probe;
not a live startup measurement). Published and selected snapshot:
`~/.cache/te2/code_te2/build/mypyc-snapshots/check-20261009-224346-1791585826838308569`.
The previous selector is retained. Shellspec now forwards `${env:CODE_TE2_MYPYC_DIR}`
again; the interpreted diagnostic override is removed.

17 frontend grammar tests, 19 Python projection tests, 14 extension-restart tests,
and 23 build-workflow/launch-context tests passed (one skipped, two subtests).
The frontend refresh fixture now supplies native window location metadata; no
production behavior change was needed. No runtime restart, Rust/APK build,
OTA, commit or publication was performed during the build slice. User subsequently
confirmed compiled-mode live acceptance: working good. Earlier interpreted
acceptance is retained; this is not release-package or all-client acceptance.

## Stable native origins slice

- [x] Electron per-install config, separate from visible endpoint settings.
- [x] Android app-private preferred port wired through the service-owned relay.
- [x] Direct preferred bind, collision-only fallback and preferred/actual diagnostics.
- [x] Electron typecheck and all 117 tests pass, including persistence/reuse/collision/retarget.
- [x] Cefrium Kotlin compilation passes.
- [x] Gecko relay JVM test and Kotlin compilation.
- [x] TE2 Termux Kotlin compilation.
- [ ] Native rebuild/deployment and cross-relaunch live origin/storage acceptance.

No Python or framework changes, shared-runtime restart or version bump. Local
Gradle validation selects JDK21/Linux AAPT2 for Gecko and JDK25 for the
standalone Cefrium/Termux builds without modifying build-environment files.

Termux validation also supplied the existing verified embedded Node SDK and NDK
28.0.13004108 through environment variables. Archive SHA-256
`e3cd29a1be03405f11dd5c857af8cd3ad13f84f1409ea648f5328f0bada5bd76`
and ARM64 library SHA-256
`955b308b1dfdf7662e8fe5ee4eb8c0c7d0a313f2d306387f2307529993c4bc32`
match `vendor/electromux/runtime/node-sdk.json`. `compileDebugKotlin` passed;
this is compile validation, not an APK or physical acceptance result.
Diff review/whitespace checks passed. Existing deprecated Wi-Fi API/compiler
warnings remain unrelated. The untracked user `ty.toml` is preserved untouched.

### Razr TE2 Termux staging publication

The approved build/install slice regenerated the existing Android seed with
`scripts/bundle_gecko_assets.sh` (219 files, asset version 0.2.352), then built
`android/termux` staging with minification enabled. Gradle completed in 7m 23s.
The APK is 202,717,933 bytes; SHA-256
`d0a0ab2e9225a3f369d243ad4e844b4f67d438a6a11e10fd01a088c4c627dec2`.
Its signer matches the installed Termux GitHub test certificate; signature and
16 KB ZIP alignment checks pass. The packaged host bundle and Markdown cache
hashes match the regenerated seed. Existing Cefrium final-resource-ID shrinker
warnings remain; assembly alone does not establish live resource acceptance.
ADB in-place installation on `motorola-razr-2024-xt2453v:5555` succeeded with
`install -r`, preserving app data. No app launch, data clearing or framework
restart was performed. Cross-relaunch origin/storage user acceptance remains
pending; Gecko/Cefrium APK deployment is not covered by this Termux installation.

User subsequently confirmed the installed Razr build is working fine. This closes
TE2 Termux general live acceptance for this slice, not an independently observed
cross-relaunch storage/collision test or Gecko/Cefrium/Electron deployment gate.

## Socket compression — initial investigation

The native worker's `web.rs` wraps its ordinary HTTP service in asset gzip,
then wraps that service with Socketioxide. Engine.IO responses bypass the inner
asset layer. Pinned Engineioxide 0.17.7's WebSocket upgrade emits no negotiated
extensions and uses Tungstenite raw sockets; there is no application compression
toggle in the current configuration. Polling gzip therefore requires a separately
scoped outer response layer, while Rust WebSocket compression requires a supported
transport change—not an asset-gzip flag.

WBA's `server/editor-socket.ts` allows only WebSocket and does not set
`perMessageDeflate`. Its vendored Node Engine.IO supports that option; HTTP polling
compression cannot help this WebSocket-only lane.

Approved offline probe: `node scripts/probe_socket_compression.mjs <payload-file>`.
It reports bytes, warmed mean encode time and coarse RSS delta, without starting
a server or enabling compression. Markdown seed JSON (4,153,325 bytes) compressed
to 454,802 bytes with gzip (~11%) at ~66.8 ms per encode on this desktop; raw
deflate was 454,784 bytes/~62.0 ms. This seed is a large corpus, **not a captured
current socket payload** (native seeds/browser HTTP already avoid that transfer).
RSS deltas are allocation/GC-sensitive, not peak-memory evidence. These results
do not establish Android cost, wire overhead, actual permessage-deflate behavior
or end-to-end latency. Representative bounded RPC payloads and target-device
measurements are still required before any transport enablement proposal.

### Real payload / Razr codec comparison

User-approved passive console instrumentation on the exact live Electron
main-page worker wrapped the existing Socket.IO `Socket.prototype.emitEvent`
and `packet` methods, forwarding the original calls unchanged. Only binary `rpc`
arguments were copied, capped at 16 messages/512 KiB/60 seconds. The user switched
files; collection retained 16 messages/159,712 bytes. Both hooks were restored
and the probe removed. No RPC was generated, socket reopened or worker restarted.
Only method/size/timing metadata is retained; private payload scratch is removed.

Decoded metadata identifies the two large messages as `editor.file.opened`
(77,837 bytes) and the `editor.textmate.grammars.get` result (78,525 bytes).
Remaining messages were 49–711 bytes across Editor, Explorer and WBA. This is
one file-switch sample, not a cold-start or language-wide distribution.

The same captured bytes were benchmarked on desktop Node 24.16.0 and Razr
Termux Node 24.18.0 via `astermux -s <device> -c 'node'` reading the temporary
probe on stdin; no benchmark file was installed remotely. Thirty-two warmed
encode/decode iterations per message verified byte-identical round trips.

| Message | Desktop gzip median | Razr gzip median | Razr gzip bytes | Razr decode median |
| --- | ---: | ---: | ---: | ---: |
| File opened | 1.34 ms | 1.52 ms | 10,724 | 0.39 ms |
| Grammar response | 1.30 ms | 1.55 ms | 11,430 | 0.24 ms |

With payloads below 1 KiB left untouched, total bytes fall from 159,712 to
25,504 (~84% reduction) on Razr. Independent raw-deflate with sync-flush had
similar size/cost (25,477 total, ~1.47–1.56 ms for the large messages); it is
not a negotiated WebSocket test. Some small messages expand under compression.
Different Node/zlib builds yield slightly different output sizes.

No end-to-end latency, peak-memory, browser decode or concurrent/battery claim
follows from this synchronous codec-only test. Socket.IO envelopes, polling
base64, network delay and context takeover were not measured. The bulk savings
in this sample belong to the Rust editor lane, not Node WBA. Recommendation:
do not enable WBA-only compression as a purported editor-loading fix; retain
polling/WS transport work as a separately approved implementation and proceed
to persistent grammar caching to eliminate repeat grammar transfers directly.

### Application-envelope POC (no transport fork)

Following user approval, `scripts/poc_rpc_compression.mjs` tests an independent
binary wrapper around the **existing MessagePack bytes**, not a DTO re-encoding:
12-byte header (TE2C magic, version, raw/gzip flag, reserved bits and big-endian
uncompressed length), followed by raw or gzip bytes. Compress only at 1 KiB or
above and only if smaller. Entire frames remain below the current 8 MiB budget.
An explicit POC capability is required; this is a test guard, **not implemented
production negotiation**. A future codec must not sniff gzip or silently change
`msgpack-v1` semantics.

Node bounded gunzip and native Web API `DecompressionStream('gzip')` decoding
both recover exact original bytes. Web output is counted before collecting each
chunk, cancelled on failure, and must equal the declared length. Internal browser
codec buffers/peak memory are not proven by this admission bound.

Desktop and Razr both pass 5 valid round trips, incompressible bypass and 13
malformed cases (header/version/flags/reserved bits, invalid lengths, truncation,
CRC corruption, extra gzip member and expansion beyond the declared length),
plus capability guards. Commands:

```bash
node scripts/poc_rpc_compression.mjs
astermux -s motorola-razr-2024-xt2453v:5555 -c 'node --input-type=module' < scripts/poc_rpc_compression.mjs
```

The retained-in-session 16 real RPC samples were exercised privately in a
temporary runner, then removed. All round trips passed on both targets. Framed
total: desktop 25,708 bytes / Razr 25,696 bytes versus 159,712 raw (~84% saving).
Fourteen small messages bypassed compression. Razr large-frame encode means
were 1.63–1.64 ms; **Node's Web API** decode means were 2.41–2.74 ms (desktop
~1.01–1.49 ms). These are bounded codec microbenchmarks, not Chromium, Rust
encoding, end-to-end latency or concurrent/battery measurements.

This establishes an application-codec route compatible with Socketioxide's
binary carriage without changing Engineioxide; the earlier transport limitation
does not rule out compression. Production integration is not approved or enabled.
Next design gate: capability/version negotiation with matched peers, Rust encoder
and bounded browser decoder, serialized async receive ordering per lane, queued
byte/backpressure bounds, disconnect generation fencing, and WBA/native/browser
coverage. No DTO parsing is needed merely to compress the MessagePack byte buffer.

## Editor application compression implementation (2026-10-09)

The user approved production source integration on `/rpc/editor` only. The
earlier POC approval limits above describe that prior checkpoint, not this slice.

- [x] Explicit `msgpack-gzip-v1` auth, with unchanged legacy editor codec and
  no opt-in on Explorer/UI IPC/WBA/Sidebar/terminal.
- [x] Rust frames existing encoded bytes and lazily compresses once per fan-out
  at >=1024 bytes when smaller; requests remain raw framed MessagePack.
- [x] Browser ordered async decode, 64-item/8-MiB declared-output queue bounds,
  10-second decode deadline and disconnect-generation abort/fencing.
- [x] Native pending-connect framed queues have count/wire-byte bounds.
- [x] Eight browser codec/transport regressions, including decoding a real
  Rust-generated gzip fixture and timeout/disconnect cancellation.
- [x] Rust suite: 34 worker + 6 transport tests; release worker build and fmt.
- [x] Python auth/editor-boundary tests: 14 passed, 3 subtests.
- [x] All 25 isolated native integration tests pass, including old/new codecs
  concurrently connected and identical preference fan-out on polling/WebSocket.
- [x] Frontend typecheck and `node build.mjs` pass.
- [ ] Matching compiled-domain rebuild/activation and approved worker lifecycle.
- [ ] Client OTA and installed native/browser high-latency live acceptance.

The isolated fixture now excludes inherited `CODE_TE2_*`: otherwise a stale live
mypyc selector causes it to test old compiled auth rather than current source.
No shared process was restarted. Frontend generation does not update any native
client. Python changes are only editor codec-name validation, but still require
a matching compiled group before live testing. No APK, version or release change.

Full `socketio_transport.test.mjs` still has four pre-existing TextMate runtime
fixture failures (`window.location.search` absent, then obsolete grammar mocks).
Those tests were left unchanged; no production TextMate behavior was altered to
make them pass. Generated host bundle retains vendor whitespace flagged by
`git diff --check`; authored-source whitespace checks pass.

### User checkpoint acceptance (2026-10-10)

The user rebuilt the compiled domain and reported the editor compression slice
working pretty well. This is acceptance of their tested runtime, not proof of
all-client OTA or packaged-release validation. WBA permessage-deflate remains
disabled: its mostly small messages and possible same-device Termux hosting do
not yet justify compression overhead. Any WBA change requires payload/CPU
measurements and separate approval. No runtime restart or release accompanies
this checkpoint commit.

## Persistent grammar cache (2026-10-10)

- [x] Frontend-only IndexedDB adapter and optional verified-content cache.
- [x] Existing closure metadata selects exact IDs/hashes before any cache reuse.
- [x] Memory/package/persistent/network order; matching packaged bodies do not
  read or write the database.
- [x] Batched small-metadata admission before body reads; <=8 MiB and 250ms
  deadline. Storage/WebCrypto failures disable persistence for the page only.
- [x] SHA-256 verification on persistence and reuse, with 4-MiB per-body limit.
- [x] Background bounded writes and transactional eviction to 512 records/32 MiB
  UTF-8 body bytes; no model gate or backend round trip for housekeeping.
- [x] Eleven cache/adapter/loader regressions plus two projection regressions.
  Tests cover new-instance reuse, changed hashes, corrupt/oversized rows,
  blocked/late database opens, quotas, read deadlines, eviction and reset fencing.
- [x] Frontend typecheck and `node build.mjs` pass.
- [ ] Explicit client OTA and physical cross-reload/cross-relaunch acceptance.

Database name: `te2-textmate-bodies`, version 1, stores `bodies` and `metadata`.
Keys are JSON `[logicalGrammarId, sha256]`; records carry raw body, UTF-8 byte
count and last-write time. Eviction is oldest stored, not an access-log polling
system. Different upstreams can reuse identical verified content only when their
current backend selects the same ID/hash. Revisions invalidate runtime selection,
not immutable matching content. Preferred-port fallback creates a separate origin
cache and a normal miss. Browser eviction, app-data clearing or storage denial
also cause normal misses. Insecure origins without WebCrypto skip persistence.

No new Python/Rust exports, compiled-domain build, runtime restart, APK assembly,
version bump or release. Native clients still need explicit OTA to receive the
generated host. Test doubles prove adapter scheduling/limits, not Chromium/Gecko
disk durability, native storage partition lifetime or device timing. The combined
cache/projection/gzip run passes 20 tests with one optional Rust-fixture skip;
the earlier four unrelated full-suite TextMate fixture failures remain separate.

### Live persistent-cache acceptance

The user exercised Kotlin and TOML on the TE2 Termux client, then reloaded and
switched files again. Read-only console inspection of the exact main-page worker
confirmed `te2-textmate-bodies` version 1 at `http://127.0.0.1:55952`, with two
body/metadata pairs: `fwcd.kotlin` 18,576 bytes and `tamasfe.even-better-toml`
9,212 bytes. After reload, the new page time origin postdated both records while
their ID/hash, byte counts and write timestamps remained unchanged. This proves
cross-page persistence and is consistent with reuse without refetch/rewrite;
no request probe captured zero network body reads. User live acceptance passed
for this observed path. Cross-app-process relaunch, all-client validation and
release packaging are separate gates. OTA compression investigation is next.

---

## OTA compression investigation (2026-10-10)

- [x] Inspect framework archive generation and Android/Electron extraction.
- [x] Compare bounded offline manifest payloads at Deflate levels 1, 6 and 9.
- [x] Verify every extracted entry against its source SHA-256.
- [x] Retain ZIP/default compression; no production change justified.

`framework/rust/crates/te2-server/src/android_assets.rs` already selects
`CompressionMethod::Deflated`. Pinned zip 2.4.2 with the enabled flate2 backend
defaults to level 6; enabling the zopfli feature does not itself select its
high-cost compression levels. The endpoint builds the current manifest anew
on a blocking task, completes the archive before responding and reads it into
a response buffer. Same-version forced updates must retain fresh-source behavior.

Shared Android `EditorAssetManager` streams the response through
`ZipInputStream` into staging. Electron downloads a temporary ZIP and extracts
with yauzl; Python desktop installation uses zipfile. Existing clients already
decode Deflate ZIPs. Browser HTTP gzip is separate; do not add a second gzip
wrapper or change archive formats based on this investigation.

An in-memory Python stdlib/zlib probe expanded the current manifest, including
template replacements/exclusions/version, to 219 entries / 45,127,009 bytes.
Input was bounded to 128 MiB; no archive, build or runtime mutation occurred.

| Deflate level | ZIP bytes | Encode seconds | Decode + SHA verification seconds |
| --- | ---: | ---: | ---: |
| 1 | 14,803,438 | 0.571 | 0.420 |
| 6 | 12,900,561 | 1.327 | 0.378 |
| 9 | 12,829,230 | 2.875 | 0.398 |

All entry round trips passed. Level 6 reduced source bytes by about 71.4%;
level 9 saved only 71,331 bytes (0.55%) relative to level 6. Peak probe RSS was
106,556 KiB and includes Python, retained source buffers and the in-memory
archive; it is not the server's memory footprint. These single-run local proxy
measurements establish neither native Rust encode timings nor mobile extraction
CPU/network performance. No APK, OTA, framework restart or release was performed.

Recommendation: keep current compression and move to the final loading audit.
Any future archive streaming/content-fingerprinted reuse work needs separate
evidence/approval and must not reintroduce stale same-version bundles. User
follow-ups below remain deferred and are included in the next checkpoint only;
none were implemented in this slice.

---

## Loading audit — reconnect/open supersession (2026-10-10)

Read-only tracing found that explicit opens use the retained transaction queue,
while SSOT reconnect snapshots apply through a separate async path. An isolated
production-handler probe held A.md grammar preparation, applied a newer B.txt
open, then released A: the old snapshot mounted A again. Snapshot sequence checks
only covered other snapshots, and document revisions are per-path, so selecting
B did not invalidate A. This reproduces a control-flow gap, not an attribution
of every historical loading incident to this cause.

Approved frontend correction shares a presentation supersession sequence across
SSOT and explicit opens, advancing it on disconnect without clearing the visible
model. Queued obsolete opens skip application; the actual transaction runner
rechecks before/after editor readiness, after grammar preparation and after
completion awaits. Existing backend document revisions, open queue and grammar
cache ownership remain unchanged. Late SSOT language hydration cannot schedule
agent-review work after a newer selection. No HTTP preflight or new transport.

- [x] Five production-handler/transaction regressions: delayed replay vs open,
  delayed open vs replay, newest queued open, empty replay and disconnect.
- [x] Combined open-flow, secondary lifecycle, projection/cache suite: 25 pass.
- [x] Code TE2 TypeScript check.
- [x] Code TE2 frontend build (`node build.mjs`).
- [ ] Explicit native client OTA and poor-connection live acceptance.

User reported the correction working and recognized the previously rare stale
selection behavior on 2026-10-10. Observed live acceptance passes; exhaustive
poor-connection/all-client deployment coverage remains a separate gate.

The secondary lifecycle test initially failed to resolve its relative entrypoint
from repo root; rerunning from the Code TE2 app directory passed all six tests.
No test-source repair was needed. The broader loading audit and separate stale
asset inventory remain open. No backend rebuild, OTA, APK assembly, runtime
restart, commit or release was performed in this slice.

---

## Vendored/stale assets — preliminary inventory (2026-10-10)

- [x] Inspect browser build inputs, OTA manifest/native mapping inventory and
  wheel/materializer exclusions; read-only file-size inventory.
- [ ] Complete per-candidate dynamic-consumer and compatibility checks.
- [ ] Separately approve any cleanup and validate matching packaged clients.

Sizes below are uncompressed source bytes, not estimated APK/wheel/ZIP savings.
No assets were deleted or repackaged. A missing direct reference establishes a
candidate, not proof that an externally reachable resource can be removed.

| Candidate | Bytes | Evidence / restriction |
| --- | ---: | --- |
| TextMate grammar files other than JSON | 7,314,418 | 91 of 92 files; the full tree is copied by the OTA manifest and native payload materializer. No direct consumer found for the other filenames in the inspected authored runtime. Check dynamic/compatibility use before removal. |
| TextMate `grammar_index.json` | 4,987 | No authored runtime reference found in inspected paths; still included by tree publication. Candidate only. |
| TextMate adjacent UMD copies | 70,419 | `vscode-oniguruma.umd.js` + `vscode-textmate.umd.js`; main editor imports the vendor packages into host.js and publishes their globals. No direct loader found for these adjacent copies. Check standalone/settings loaders before removal. |
| Static `ws` vendor tree | 122,307 | OTA/Desktop/Cefrium routing declares it, but no runtime consumer found in inspected authored code. Route declaration is not proof of execution; compatibility remains unresolved. |
| Static reconnecting-websocket module | 21,962 | Terminal imports its npm package, not this path. Further generic-client/compatibility review needed; this module is outside the current OTA manifest. Preserve license when retaining any consumer. |
| Monaco bootstrap `.bak` + `.bak2` | 17,798,991 | Obsolete local backup candidates; already excluded by MANIFEST.in, release package policy and OTA extension filters. No release transfer-size saving. |
| Monaco bootstrap `_deprecated` | 34,495,797 | Already excluded from wheels and not selected by the OTA manifest. Repository cleanup only, not a shipped-size reduction. |

Required assets that must not be swept up:

- `main_page/frontend/ui/cm6-json-textmate-field.ts` explicitly fetches
  `textmate/grammars/json.JSON.tmLanguage.json` (5,084 bytes), the settings theme
  and onig.wasm. Its fallback script loaders point into the vendor package
  `release/main.js` paths, not the adjacent UMD copies above.
- `editor_textmate_runtime.ts` imports vscode-textmate/vscode-oniguruma, loads
  onig.wasm and uses the revision/hash-verified Markdown seed. Keep those resources
  and notices even when considering the legacy grammar tree.
- `scripts/build_monaco_bootstrap_bundle.mjs` resolves the pinned Monaco ESM
  editor API and main entry, plus prebuilt basic/language contributions when its
  optional source worktree is unavailable. The 38.17 MB ESM tree and associated
  contribution chunks are build dependencies, not unused just because host.js
  embeds the resulting bootstrap.
- Touch selection CSS/patched UMD are explicitly loaded by inline_host.ts and
  covered by historical touch tests. The local `.bak` is publication-excluded.
- Font, worker and dynamic resource mappings remain separate contracts; do not
  remove them based on directory-level size totals.

Source authorities inspected: `app/android_editor_assets_bundle.json`,
`desktop_client/desktop_asset_inventory.json`, `CefriumAssetRoutes.kt`, Code TE2
build/loader source, `scripts/materialize_code_te2_runtime.py`, MANIFEST.in and
`app/release_runtime/package_policy.py`. Findings are preliminary and do not
establish complete cross-app reachability or fresh package acceptance. User
follow-ups below remain untouched and deferred.

---

## Legacy grammar trim (2026-10-10)

Approved scope removes only 91 legacy grammar files (7,314,418 raw bytes) from
`monaco_editor/textmate/grammars`, retaining `json.JSON.tmLanguage.json`. The main
editor's backend catalog/body projection resolves installed extension roots, not
this old directory; `build_textmate_cache.mjs` independently reads the Code Server
extensions root. The settings JSON editor is the remaining direct consumer of
the retained file. Its includes are self-contained repository rules.

In-memory level-6 Python/zlib ZIP comparison before deletion: all 92 grammars
903,324 bytes versus retained JSON 1,421 bytes; estimated reduction 901,903 bytes
(0.860 MiB, ~7% of the earlier 12,900,561-byte bundle). Native Rust ZIP sizes may
differ. No bandwidth measurement or full package validation is implied.

- [x] Delete exactly the 91 approved candidates; retain JSON unchanged.
- [x] Regression checks retained directory, self-contained JSON scope/includes,
  settings loader reference, manifest tree publication and unchanged valid
  72-body Markdown seed; targeted grammar/loading suite: 16 pass.
- [x] Code TE2 typecheck and frontend build.
- [x] Client asset-update/live settings and Markdown validation.

Existing tree-based OTA/native-payload copies naturally pick up the smaller
source directory. No archive format, loader, Python/Rust module, Android source
or manifest change was needed. Other candidates—including the unused legacy
index, adjacent UMD copies and static ws—remain deferred. No mypyc rebuild, OTA,
APK/wheel assembly, shared runtime restart or publication was performed. Older
installed copies are not trimmed by a page reload; update assets explicitly.

---

## Plain HTTP grammar verification (2026-10-10)

Chrome inspection confirmed IndexedDB exists at the plain HTTP framework origin,
but WebCrypto does not; the previous implementation therefore skipped persistence.
Both packaged seed and persistent-body verification now share SHA-256 with
WebCrypto preferred and pinned `@noble/hashes` 2.4.0 as the unavailable-API fallback.
This supersedes the earlier WebCrypto-less skip policy, without changing cache
schema, backend selection authority, budgets or transports. Large fallback hashes
yield every 256 KiB; no weak hash/size-only admission or HTTP authentication claim.

- [x] Known vectors, Unicode/block boundaries, million-byte input, preferred
  WebCrypto, event-loop yielding, persistent reuse and same-size corruption tests.
- [x] Targeted tests: 33 pass; Code TE2 typecheck and frontend build pass.
- [x] Measured host bundle: 7,873,798 → 7,879,538 bytes raw; gzip level 6
  2,150,725 → 2,153,785 bytes (**3,060-byte compressed increase**).
- [x] Generic plain HTTP browser reload/persistent-cache live acceptance.

Live Chrome inspection confirmed the plain HTTP origin has no WebCrypto but now
contains `te2-textmate-bodies` version 1: five Kotlin/TOML grammar records,
including Markdown injections, totaling 30,784 UTF-8 body bytes. All stored byte
counts match their bodies; user reports 46 KB site storage after viewing Markdown.
This confirms fallback-backed writes, not reload reuse or zero network requests.

No runtime restart, native OTA, APK build, release or publication was performed.
Packaged seed hits need not create database records; test a fetched closure miss
to demonstrate persistent writes/reuse.

## Loading audit user acceptance (2026-10-10)

The user confirmed all three closeout checks: plain HTTP persistent-cache reuse
after reload; poor-connection rapid file switching, reconnect and secondary-editor
behavior; and retained JSON grammar loading in Settings and Run Profiles. The
poor-connection checks prompted the user's report that the editor is now almost
enjoyable rather than practically unusable. These are user live acceptance,
not instrumented zero-request or all-device measurements. Earlier unchecked
slice-local loading/cleanup gates are superseded for these tested behaviors.
Remaining asset candidates stay deferred; packaging/release and native-client
deployment gates remain separate. Next scope is the user follow-ups below or a
separately approved maintenance release.

## Follow-up implementation tracker

Preliminary source investigation and plan integration are complete. See PLAN.md,
**Follow-up maintenance workstream**, for ownership, entrypoints and gates. The
original user list below is retained verbatim as the requirement record.

- [x] Record loading closeout live acceptance separately from release evidence.
- [x] Map all follow-ups to current source and distinguish bugs from new features.
- [x] F1: marketplace settings access using existing configuration RPC/dialog (source validated; live gate below).
- [x] F1: installed user-extension list using existing registry/list RPC (source and user live acceptance).
- [x] F1: mutually exclusive Marketplace/Installed viewport panels and lazy README rendering (source and user live acceptance).
- [x] F1: reproduce astral-sh.ty issue; capture exact ID/version/platform and failure.
- [x] F1: approved fixes, regressions/build and live extension lifecycle acceptance.
- [x] F2: shared picker single-select/double-enter directory behavior (source/regressions).
- [x] F2: depth-one regex filter, bounded/invalid-pattern handling (source/regressions).
- [x] F2: vendored Codicon directory/file-type rows with muted grey-blue styling (source).
- [ ] F2: shared consumer mouse/touch/keyboard and picker-mode acceptance.
- [x] F3: detached Sidebar minimize, exact native window ownership (source/regressions/build).
- [x] F3: detached Sidebar minimize/restore user live acceptance.
- [x] F3: editor Explorer ellipsis-menu Collapse all using existing expansion authority (source/tests/build).
- [x] F3: vertical Explorer ellipsis icon (source/build).
- [x] F3: Collapse all and vertical ellipsis user live acceptance.
- [x] F3: halve draft-highlight background opacity (source/regressions/build).
- [x] F3: lighter draft highlights user live acceptance (reported working).
- [x] F3: unprefixed Quick Access default (source/regressions/build), preserve explicit command/symbol/line modes.
- [x] F3: Ctrl+colon clarified as simultaneous keys; add approved Ctrl+Shift+P and F1 bindings (source/regressions/build).
- [x] F3: unprefixed picker and shortcut user live acceptance (reported working).
- [ ] F3: desktop/mobile input and detached-window live acceptance.
- [ ] F4: define disk-backed tab-session identity/lifetime and shared drawer transport contract.
- [ ] F4: persist tab path/options and live shell association, referenced by Sidebar state.
- [ ] F4: typed fresh versus existing-session query mounts; reload/Sidebar restore never creates duplicates.
- [ ] F4: bare-open session list with New/Close; mounted-session close warning and owned terminal teardown.
- [ ] F4: shared picker icon helper/rules in File Explorer list/grid rows.
- [x] F4: implement checkbox-free file selection (icon toggles, body long press/menu, desktop range/additive toggles), Clear selection and Esc.
- [ ] F4: native asset publication and live acceptance of icons/selection.
- [ ] F4: explicit terminal close; exited-shell disassociation; hide/reload retains live shell.
- [ ] F4: drawer minimize/maximize and Lock directory with pipe-backed command injection.
- [ ] F4: reuse Code TE2 shellspec/Pyte plus standalone Terminal xterm/mobile/extra-key behavior.
- [ ] F4: extra keys absent for desktop user agents, including narrow windows.
- [ ] F4: depth-one regex listing and asynchronous directory usage view.
- [ ] F4: multi-client, standalone/sidebar, lifecycle and large-tree acceptance.
- [ ] Separately approve maintenance packaging/release scope after chosen slices.

### F4 revised tab-session direction — investigation gate

Mount/selection clarification: fresh Code TE2 Explorer opens create a session;
existing Sidebar state mounts its durable ID, irrespective of query-string
presence. Creation must resolve/publish that ID before restoring the same tab;
reload/iframe recreation is never new-session intent. Bare opens show a list with
New/Close session actions; closing a mounted session warns and ends its active
terminal. User approved path-create/session-ID restore URL distinction and
icon buttons toggling selection and body long press opening the context menu. Shared picker icons,
checkbox-free range/discontiguous selection, top Clear selection/Esc, and
mobile-UA-only extra keys are recorded in PLAN. Session/terminal work remains planning-only.

### F4 icons and selection implementation checkpoint

File Explorer now imports the existing lazy shared file-icon provider and uses
icon buttons for selection in both list/grid layouts. File selection checkboxes
are removed; permissions/bookmark settings controls are retained. Body clicks
select one item; body double-click retains opening. Modifier clicks use the
displayed sorted order; icon/modifier double-clicks never open. Context on a
selected item preserves its batch; an unrelated item replaces selection. Clear
selection is visible at the top on mobile/desktop, and Escape respects input,
dialog and existing menu ownership. Directory changes reset selection/anchor;
view/sort rerenders retain selected paths and their mirrored visual/ARIA state.

Validation: 24 targeted DOM/selection/picker regressions pass, JavaScript syntax
checks pass, Code TE2 typecheck and frontend build pass, and git diff --check is
clean. Shared JS/Codicon/Seti roots already belong to the Android asset manifest;
no manifest change or Kotlin/backend/mypyc/native build is required. No OTA,
APK installation, runtime restart, commit or push was performed in this slice.
Native live acceptance remains pending after asset publication. Disk-backed
session identity and terminal lifecycle are still the next independent slice.

User chose explicit terminal close only and replaced presentation-owned terminal
identity with disk-backed File Explorer tabs (path/options/live shell association).
Sidebar state references tab sessions; exited shells are disassociated. Requested
drawer minimize/maximize, Lock directory and pipe-backed command injection, exact
Code TE2 Pyte/shellspec reuse with standalone Terminal's custom xterm/frontend,
mobile handling and extra keys. PLAN retains the complete requirements and safety
questions. Documentation and read-only investigation approved; no F4 code changes,
runtime restart or packaging approved. ALS source is at
`../agent_log_server/rust/crates/als-server/src/conversation_store.rs`, not the
historical `app/apps/als_rs` path. Current terminal injection uses the native manager's `write_to_pty`;
extractability and readiness/foreground safety remain investigation items.

### F3 unprefixed Quick Access — implementation checkpoint

User clarified Ctrl+colon as simultaneous keys. Authored Monaco bootstrap
registers `editor.action.te2QuickAccess`, using the existing `IQuickInputService`
empty-prefix help/options provider. F1 and Ctrl/Cmd+Shift+P plus Ctrl/Cmd+Shift+Semicolon
(colon on US layouts) use this action. Editor-scoped helper also recognizes the
actual Ctrl/Cmd+colon key value and routes the mobile palette gesture to it.
Ordinary typing, Ctrl+semicolon, Alt combinations and composition remain untouched.
Stock `editor.action.quickCommand` still opens explicit `>` commands, and symbol/line
actions remain intact. Quick Access has its own context-menu entry; stock Command
Palette remains the explicit commands entry, not a renamed or removed action.

Fifteen palette/mobile-key regressions pass, including existing find/undo/copy;
typecheck, Monaco bootstrap and
frontend builds pass. User reported this slice working on 2026-10-10, closing
its reported live acceptance gate. No backend,
Monaco fork, APK, runtime restart, version or release changes occurred.

### F3 draft-highlight opacity — implementation checkpoint

Authored `monaco_editor/inline_host.ts` owns the draft-only CSS: added line
blue alpha is now 0.12 (was 0.24); deleted line/zone/stock-line/character/margin
amber alphas are respectively 0.09/0.06/0.08/0.15/0.08, each half its previous
value. Foregrounds, ranges, deletion-zone geometry, controls and ordinary Git/history
diff colors are unchanged; no element opacity fades text. Eleven targeted
style/theme tests, TypeScript typecheck and frontend build pass. Tint-compositing
tests cover white and dark backgrounds, not proof of all-theme visual readability.
Native clients require OTA before light/dark live acceptance. No backend/mypyc,
Monaco fork, APK, version, runtime restart or release changes are included.

User reported this slice working on 2026-10-10. This closes its reported live
acceptance; exhaustive all-theme contrast coverage was not instrumented.

### F3 detached Sidebar minimize — implementation checkpoint

The detached chrome has an accessible Minimize button on its existing preload
action channel. The closed action allowlist admits `minimize`; registry dispatch
requires the matching chrome WebContents, a live window, and detached parentage.
It minimizes only that window, without emitting app/lifecycle events or changing
membership. Existing focus restores it. Main-window and unrelated senders remain
rejected. Ownership/restore/destroyed-window and chrome regressions pass alongside
the full 119-test Electron suite, typecheck and compile. No client relaunch,
packaging, Android changes, or release occurred; editor OTA cannot activate this
Electron-native change. User reported this slice tested working on 2026-10-10;
its live acceptance gate is closed.

### F3 Explorer collapse/menu — implementation checkpoint

The top Explorer menu now uses vertical ⋮ and includes Collapse all. This explicit
action dismisses filename search, cancels pending expansion debounce, and requests
the existing `explorer.openDirs.set` projection with an empty directory set. Its
authoritative response uses the existing reconciliation/active-file marker path;
the project root and selected editor document remain unchanged. Sticky scopes
retain their existing mutation-observer refresh. Duplicate activations are guarded;
disconnection/request errors produce existing toasts without mutation retry.

Validation: Explorer tree/chrome regressions (13 tests), filename-search/sticky
regressions, TypeScript typecheck and frontend build pass. No backend source,
APK, runtime restart or client asset activation is included. Installed native
clients require OTA before live acceptance; reload alone is not publication.

User reported this slice tested working on 2026-10-10. This closes its live
acceptance gate, not detached-window or other F3 acceptance.

Confirmed preliminary findings: marketplace already has configuration/list backend
RPCs but detail actions are install/update/uninstall; shared picker enters a
directory immediately on click; Desktop main-window minimize is not detached-window
minimize. File Explorer exposes terminal launch intents, not evidence of an embedded
drawer. ty cause, draft CSS owner, quick-access empty mode and usage aggregation
support still require focused investigation. No runtime mutation or implementation
was performed for these follow-ups.

### F2 shared picker — implemented, live acceptance pending

Lazy-icon follow-up after local checkpoint e3edf55a: standalone shared helper now
owns unchanged filename-rule lookup and loads definitions once. Individual SVGs
are requested only for rendered code families, one retained request per family;
5s abort/64KiB body admission retain Codicon fallback on failure. Generator/check
publishes 135 SVGs under the existing inventoried vendor root, including ALS
overrides. No runtime Seti-wrapper, icons.json or four-icon JS import remains.
All exact filenames, extension names and partial rules compare against the old
classifier in regression tests; concurrent JS-family calls share one fetch and
404/oversize failures remain generic without repeated requests. 60 targeted tests
pass, and all generated assets match source. No OTA/restart/push in this slice;
live acceptance pending. Python/JS/TS/Rust individual bodies are respectively
1519/975/1295/4245 bytes raw (734/556/682/1761 gzip); C/C++ are 489/611 raw.

Live picker mask regression: exact main-page inspection found loaded Python/JS
mask spans and their picker parent at 0px height; directories retained font-driven
16px height. Picker slot now explicitly owns 16px height, retaining its existing
width and row padding. The related History slot also lacked explicit geometry and
now owns 16x16px. Explorer, Changes, file tabs and breadcrumbs already declare
height. Added a container-height regression; no navigation changes or runtime
reload were performed. Client asset update/live recheck remains required.

Publication follow-up: native Cefrium console command
`android.assets.forceUpdateAndReload` returned updated=true/version=0.2.352.
Its main-page worker had not re-registered at the follow-up inspection, so native
geometry acceptance remains pending. The generic-browser client had loaded the
old History rule without dimensions; replacing only its host.css stylesheet with
the rebuilt resource preserved the open view and measured Python/TS language
icons at 15.994x15.994 CSS pixels (16px at current scaling), instead of 0x0.
No framework restart occurred.

The Cefrium main page subsequently re-registered; its loaded History rule now
contains width/height 16px, and all six sampled Codicon/language-mask slots measure
16x16. This closes the observed native zero-size geometry gate, not general visual
acceptance of every mapped file type.

Shared-provider experiment now covers Explorer, sticky directory scopes, host
file tabs, editor breadcrumbs, History, Changes and the picker through
`app/static/js/file_icons.js`. All classifier families have explicit valid
translations; JavaScript, Python and TypeScript suffix families are normalized.
After user correction of generic language glyphs, the approved hybrid reuses ALS's
four CC0 Simple Icons SVGs for Rust/JS/TS/Python and existing Seti SVGs for remaining
code families, including C/C++. Trusted SVGs render as currentColor masks like ALS,
not inline colored content. The additional language module/license reside under
the already inventoried Seti vendor root, so native publication includes them.
Directory headers/sticky copies use Codicon folder with unchanged geometry.
Seti's SVG inventory loads only when a remaining code family needs it. Provider selection is a
future seam, not an implemented preference. 57 targeted tests, typecheck and
frontend build pass. Client OTA/live acceptance remains pending; no restart,
APK build or backend compilation was performed.

Earlier Codicon-only checkpoint: live main-page inspection confirmed Python rows used generic
file-code, while build.mjs fell back to file. The vendored font does include
Python/Markdown/Ruby glyphs. Picker now reuses the Explorer's complete filename
classification via the shared wrapper's definitions-only lookup, then translates
semantic file types to monochrome Codicons. No Seti SVG/color rendering or SVG
inventory fetch. Ten picker regressions plus the existing Seti mapping regression
pass, including Python/MJS/HTML, exact README mapping and actual glyph existence.
Publish shared picker and mapping-wrapper assets before renewed live acceptance.

Shared static picker now selects before entering directories, supports mouse/touch
double entry and keyboard row controls, and uses vendored Codicons. Regex filters
only the current listing in a disposable worker: 256-character pattern, 20,000
names, 4,096 characters per name and 1,048,576 total name characters; 120ms debounce
and 500ms worker deadline. Invalid/oversized/unavailable/timed-out filters display
errors; clearing restores the listing. No main-thread regex fallback or extra
browse requests. Generation fences cover closed/newer browse and filter results.

Eight DOM/worker regressions pass, covering selection/navigation, touch, keyboard,
file/save/current modes, empty directories, regex errors/limits/deadline and stale
results; syntax checks and Code TE2 typecheck pass. Android asset manifest already
includes the entire shared JS and Codicon trees; detached modal publication clones
the source document's stylesheets. No APK build, runtime restart or client OTA was
performed. Live acceptance requires current `file_picker.js` plus its new
`file_picker_filter_worker.js` in the client asset tree, not just a page reload.

### F1 marketplace settings gear — implemented

Selected installed extensions now have a small accessible gear in marketplace
detail actions. It closes the marketplace overlay and hands the exact ID/label
through the existing host event convention to Settings. The manager's existing
schema/current-value loading is shared by both entrypoints: User values come from
the registry list, Workspace values from workspace settings. Newer requests and
scope changes fence obsolete results. Read failures do not open an empty-value
dialog; existing toast reporting handles them. Empty schemas use the existing
no-configurable-settings dialog rather than inventing settings.

- [x] Gear handoff/exact target, unchanged install behavior, User/Workspace values,
  obsolete request/scope fences and read failure regression tests: 6 pass.
- [x] Code TE2 typecheck and frontend build.
- [x] Native client asset update and user live gear/open/save acceptance.

User confirmed the gear works. This first gear slice is frontend-only; it remains
uncommitted with the larger overlay follow-up. Planning checkpoint `00937761` is
local only. The ty failure remains uninvestigated beyond source orientation.

### F1 Installed / README overlay follow-up

README table sizing follow-up: one shared CSS rule uses viewport height as the
wrapping boundary (`width/max-width: 100dvh`), equivalent to viewport width times
height/width. Portrait tables may overflow their horizontally scrollable wrapper;
landscape tables narrow. Cells wrap, while code fences retain independent scrolling.
Eleven frontend regressions, typecheck and frontend rebuild pass. User live
acceptance confirmed the corrected sizing works better on 2026-10-10.

Final activation and acceptance (2026-10-10): bootstrap published the rebuilt
native worker at `~/.cache/te2/code_te2/build/bin/1cf6c3c3464841e678e43189/release/code-te2-worker`
(four-job release build, 25.24s). The latest 136-module compiled group remains
selected through `mypyc-active`. The agent did not restart any runtime; the user
subsequently confirmed everything relating to the marketplace works and is live
validated. This closes the Installed/README, icon, settings, platform-artifact
selection and extension lifecycle gates below, superseding historical pending
activation/acceptance notes. No wheel, APK, tag or release publication is implied.

Live Electron follow-up (2026-10-10): exact main-page console inspection found
missing marketplace icons for valid platform-qualified paths and ordinary
`logo.jpg` filenames. `astral-sh.ty` latest returned Alpine ARM64 from the
unqualified API; old validation rejected its artifact path before download.
Source now centralizes exact-identity resource validation, selects backend-host
metadata/artifacts explicitly, and retains selected-target digest/redirect guards.
Termux selects universal then explicit same-architecture Linux compatibility,
with a detail warning; no blanket native-server compatibility promise.
21 Python and 10 frontend tests pass; real read-only metadata selects ty
2026.78.0/linux-x64 with its declared icon. Typecheck/frontend build pass.
Four-job mypyc build validates all 136 modules (35.42s) and selects
`~/.cache/te2/code_te2/build/mypyc-snapshots/check-20261010-223812-1791671892486435575`.
This was a cache-reusing build, not an apples-to-apples four-job performance
comparison against the preceding shared-header rebuild. Native route source is
unchanged from the passing prior native release build.

Installed icon live failure is separately traced to running PID 749670's
bootstrap-cached `9a751718a1bf6b68a4d943d7/release/code-te2-worker` from Oct 9.
Both its direct HTTP route and Electron-proxied icon route return 404. The Oct 10
target/release build is different; source registry lists valid installed icon
URLs. Do not fix this by weakening resource guards or claiming OTA updates Rust.
No shared runtime restart, OTA or extension install mutation was performed.

Installed icon follow-up: preserve package icon metadata and use the existing
image/fallback renderer in Installed rows and local detail. Native worker's
declared-icon HTTP route serves PNG/SVG/JPEG/GIF/WebP with exact installed-version,
managed-root/path/symlink and 1 MiB guards, correct MIME and sandbox/nosniff
headers. Legacy registry metadata resolves icons without a rebuild. 18 Python,
10 frontend regressions and the Rust icon-route regression pass; typecheck passes.
Frontend and native release rebuilds pass. All 136 compiled modules validate;
selected snapshot is
`~/.cache/te2/code_te2/build/mypyc-snapshots/check-20261010-221428-1791670468719770098`
(461.55s, one job). The existing wrapper supports `--jobs` / `MAX_JOBS`; two jobs
are a proposed next-build starting point, not a changed default. Native release
output is `framework/native_editor_worker/target/release/code-te2-worker`.
Bootstrap-selected worker activation and native-client OTA/live acceptance remain
pending. A worker restart under an old framework environment can reuse its old
binary selection; OTA alone does not update the Rust route. No restart/publication.

UI-only installation / overlay-close follow-up: removed metadata rejection based
only on `extensionKind: ["ui"]`, retained verified artifact/version install guards,
and changed the warning to limited support / mileage may vary. Generic detail
wording no longer promises workspace-only installation. Search-view and Extensions
overlay close controls now trail at the right edge; drawer close is unchanged.
17 Python and 10 frontend regressions, typecheck and frontend build pass.
Matching 136-module mypyc rebuild passed in 35.74s and selected
`~/.cache/te2/code_te2/build/mypyc-snapshots/check-20261010-220231-1791669751794265984`.
Native asset update/worker restart and live acceptance remain user-owned, with no
commit or publication performed.

- [x] Two exclusive collapsible headers; installed user rows from one registry call.
- [x] Shared detail view with Open VSX/local installed metadata fallback.
- [x] Lazy exact-version README, 1 MiB remote/local/frontend body limits, guarded
  redirects and local symlink containment; no XML parser or per-row fetch fan-out.
- [x] Vendor streaming-markdown 0.2.15 with MIT license/provenance; reuse existing
  hljs runtime (unknown/over-64KiB fences stay plain); HTTPS-only Markdown URLs.
- [x] Wrapped prose/images and independently scrollable code/table surfaces.
- [x] Matching compiled-domain rebuild/selection (no worker restart).
- [x] User asset update/worker lifecycle and Installed/README live acceptance.

Backend detail RPC parameters are additive (`readme`, `version`); ordinary detail
requests do not load README. Settings/install/uninstall paths remain shared.
TextMate-backed fence highlighting is deferred. No APK/OTA/runtime restart or
release was performed by the agent. Exact final test/build evidence follows.

Validation: 9 frontend regressions plus 17 Python marketplace/contract regressions
pass; typecheck and frontend build pass. Read-only live Open VSX Python README
fetch passed (2026.4.0, 10,745 bytes, validated CDN destination). Combined
gear/list/README host output is 7,897,287 bytes raw / 2,158,752 gzip level 6:
4,967 compressed bytes above checkpoint 79b8f495. This measures the entire slice,
not only the Markdown library. Compiled-domain build completed in 422.29s;
136/136 compiled imports validate. Selected snapshot:
`~/.cache/te2/code_te2/build/mypyc-snapshots/check-20261010-213715-1791668235682084704`.
Previous selector retained; the running worker is unchanged until restarted.

## User follow-ups:

### extensions

1. settings access from extension market page
2. astra.ty install issue
3. list of isntalled user extensions in market overlay

---

### file explorer

1. code te2 like terminal drawer/backend
2. identity based window/session/state identity like als/rs (one terminal per identity) associated sidebar identity like als/rs
3. regex search (depth 1)
4. `du -h --max-depth=1` style behavior/view

---

### shared file picker

1. regex search (1 depth)
2. select directory behavior is broken, this is because of a split-brain behavior where a single click/tap opens directories and they cant be selected. so the "pick what is selected" listener never has a chance to associate it. we need to make opening directories a double click/tap gesture

---

### TextMate-only snippet and README syntax (2026-10-10)

- Approved replacement, not lazy Highlight.js loading: search, Changes/review and
  README fences reuse the primary editor's actual TextMate grammar factory,
  installed catalog/body loader and selected theme palette. No new RPC, grammar
  cache, backend change, Monaco model or WBA document is created.
- Text appears immediately. A four-operation queue applies syntax to existing
  text nodes without removing match/diff wrappers. Weak tracking is capped at
  2048 surfaces/8 MiB UTF-8; individual inputs at 64 KiB/10,000 tokens. Multiline
  rule state is retained; tokenization yields between lines and rejects timed-out
  lines. Detached/recycled/theme-invalidated paints are fenced. Unknown/failed
  grammars remain plain text.
- Snippet-only preparation shares the existing grammar installation lane but
  does not replace Monaco language providers; a concurrent/later editor consumer
  still completes its own provider registration.
- Highlight.js imports and generated stylesheet dependency are removed from the
  active host graph. Vendored Highlight.js sources/old registry are not deleted
  in this slice; they are unused cleanup candidates.
- Initial validation: 55 targeted regressions pass, including real
  TextMate/Oniguruma multiline state, closure reuse, provider isolation, preserved
  match/diff nodes, late readiness, recycled rows and bounded theme refresh.
  Final typecheck, frontend build and authored-source diff checks pass. The test
  also verifies snippet themes do not replace the browser-worker color map.
  Existing minified-bundle embedded-string whitespace diagnostics are not edited
  manually; generated output remains the esbuild artifact.
- Final measured host before/replacement: 7,897,430 / 6,814,526 raw bytes;
  2,158,850 / 1,843,276 gzip bytes (1,082,904 raw and 315,574 gzip bytes saved).
- No OTA, runtime restart, APK, commit/push or release was performed. Native live
  acceptance requires the established client asset updater; reload alone is not
  publication.
- OTA manifest follow-up: removed the obsolete required
  `explorer-highlight-github.css` entry after deleting its output. The stale
  entry made server ZIP construction fail before Android activation; it was not
  a client deletion rejection. Remaining required manifest sources pass read-only
  validation. Android stages a fresh full ZIP and swaps the whole tree, so absent
  old files are removed and newly inventoried files are installed. Its fixed
  minimum-required list is separate from the server's build manifest; no per-file
  inventory is transmitted/verified by the current updater.

### code-te2

1. Desktop client - minimize action on detatched sidebar tabs/windows
2. All clients - more transparent alpha in draft highlighted text
3. all clients Command pallet default: the "lower state" that shows the different options (;,:,@ ) instead of the default ">"
4. desktop - key combo: new key combo "ctrl, :" and "ctrl, shift, P" 
5. Editor Explorer: add Collapse all to the ellipsis menu and make the ellipsis vertical.
