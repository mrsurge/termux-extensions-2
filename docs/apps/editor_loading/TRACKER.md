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
- [ ] 3. Investigate polling/WebSocket compression independently; benchmark before enabling.
- [ ] 4. Design/validate persistent revision/ID/hash-scoped grammar caching across reloads.
- [ ] 5. Investigate OTA archive/transfer compression and compatibility; no format change yet.
- [ ] 6. Finish poor-connection cold/warm, switch/reconnect and secondary-editor audit.
- [ ] 7. Separately approved maintenance release: matched binaries/domain/assets,
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
