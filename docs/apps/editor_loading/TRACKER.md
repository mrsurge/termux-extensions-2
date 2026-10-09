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
- [ ] 2. Implement and validate preferred native loopback ports with free-port fallback.
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
