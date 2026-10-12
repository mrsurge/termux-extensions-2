# Editor loading maintenance tracker

## 0.2.353 artifact staging — approved 2026-10-12

- [x] Commit asset coverage/seed as 5a997f6f; fast-forward and push main.
  Maintenance branch and main are aligned; unrelated CTAG deletion/notes/ty kept.
- [x] User approved 0.2.353 staging, with Linux wheel validation/provenance first,
  then the physical Android/Termux wheel from the same source and packaging baseline.
- [x] Debian build/validation host reachable, 148 GiB free; rootless Podman works
  and has cached TE2 builder images. Docker authentication is unavailable; do not
  alter host security configuration. Local source machine has about 19 GiB free.
- [x] Synchronize release-facing versions/Android seed and commit the exact build source.
- [x] First Linux attempt at 2a4de2a8 failed before wheel creation: rootless
  container could not install into root-owned /opt build venv. Move pinned
  runtime/compiler dependencies into image construction; keep the writable
  /work dependency target. Preserve remote Cargo cache.
- [x] Correct actual te2-server crate/lock version to 0.2.353. Add native
  --version and bootstrap forwarding for --version/--build-info; identity queries
  never build, prepare runtime state, bind ports or launch workers. Missing
  selected binary fails explicitly. Python/bootstrap regression checks pass.
- [x] Build/audit Linux wheel/private CPython/mypyc/native runtime and source archive
  with the existing pinned container workflow on mrsurge@100.74.145.70.
  Candidate-02 pins 9b24b118; all 138 compiled modules import, native --version
  reports 0.2.353, manylinux_2_28 audit has no external native libraries.
  Wheel: 90,818,396 bytes, SHA-256
  8cfa00d8436c0d6f440c267f7d37505fbb44efd58a27cbf01d22f5d9c8ca79b0.
  All 292 source assets from OTA inventory checked inside wheel; none missing.
- [x] Install/validate Linux candidate on Debian host Python 3.13.5; private
  Python 3.14.6 loads 138 compiled modules, Node 24.16.0/WBA imports pass,
  corruption rejection/reinstall pass, isolated framework health reports
  0.2.353 and all eight built-in apps. Evidence in candidate-02/remote-acceptance.
- [x] Reconnect Pixel after SSH/Tailscale enabled; ordinary CPython 3.14.6,
  14 GiB free, ccache/Cargo/mypy 2.3.0 present. Isolated clean detached worktree
  ~/.cache/te2-release-build/0.2.353/source pins 9b24b118; existing editable
  packaging checkout and live runtime unchanged.
- [x] Build/audit Termux CPython 3.14 native wheel; retain existing compiler caches.
  Matched native worker/server builds pass, native server reports 0.2.353.
  Installed ccache cannot launch (missing C++ __hash_memory symbol); user explicitly
  approved NO_CACHE=1 retry, preserving system packages and completed Rust builds.
  Two-job nonactivated domain-candidate-02 passed all 138 compiled imports in
  736.63 seconds. Initial clean-source wheel SHA-256
  892d8107ef16499498183b211f615b965e1714621b26a974e8e66b86d222e86d.
  Isolated venv install/--version/--build-info passed, but installed domain
  validation found a release blocker: schema 1 rejected normal pip-generated
  adjacent caches. User approved source-associated-cache parity plus native
  cache-read prevention and revalidation; no system package changes.
  Preserve the compiled group; metadata helper is outside its startup graph.
- [x] Repackage and install-validate both wheels after bytecode-policy fix.
  Native unit suite (36) and Python release/bootstrap/reuse suite (71) pass.
  Linux reuse restores the prior validated wheel only after ABI/source/hash
  checks and import validation; no compiler-cache runtime or blanket cache trust.
  Actual x86 wheel restoration imports all 138 modules (130.55 ms); corrected
  portable-to-developer manifest labeling before packaging. Native poisoned-cache
  subprocess checks pass for private and system interpreter modes.
  Final candidate-03 wheels pin clean source de8720dd. Linux wheel is
  90,823,913 bytes, SHA-256
  d0913285053dbcd8364a12bd6568ee41265648f4ac80ff66b0a1404b7b7c2dc2;
  installed Debian acceptance passes with host Python 3.13.5/private 3.14.6,
  all 138 compiled modules, actual Node/WBA imports, corruption rejection,
  reinstall, framework health/version 0.2.353 and eight built-in apps.
  Evidence: .release/0.2.353/linux-wheel-candidate-03/remote-acceptance/.
  Termux wheel is 48,653,242 bytes, SHA-256
  4da50dd4b5a5480e168f88d4d87580e49a9e7a9dee564a8f5c0f312153036c5d;
  normal pip installation in an isolated Pixel venv passes runtime validation,
  version/build-info, all 138 compiled imports and actual Node 25.8.0/WBA import.
  No global installation or live framework was replaced. Termux candidate still
  has validation-only provenance; production reassembly needs the approved tag.
  Both wheels contain all 292 declared source assets. All 139 compiled domain
  libraries are byte-identical to candidate-02 on each platform; no repeat mypyc
  build was needed. Local free disk is 17 GiB after validation.
- [x] Build Gecko/Cefrium/TE2 Termux staging APKs with matching 0.2.353 seed;
  audit package/version, signing, ABI/alignment and hashes.
  Gecko/Cefrium staging builds and signature/alignment checks pass; each contains
  all 293 seed files byte-for-byte, version 0.2.353, versionCode 20353.
  Staged Gecko SHA-256:
  dfeb004bda122546cab1dc8c19b8f42077856dcd8ac19c8ba7122ee1fa8f11de;
  Cefrium: abe9e0b3a4933a2b44533fb16620036b46ce7917e0c820ff08f40704406e0733.
  TE2 Termux assembly uses the existing pinned Node SDK/NDK and matching public
  Termux test-key signer; first missing-SDK-env attempt retained in build log,
  configured retry passes. Termux APK SHA-256:
  f15057fac62af28ee52dbf974da5ffb38ea6c58a2ae699b49513d93078230d03.
  All three ARM64-only APKs pass signature/alignment checks and match all 293
  seed bytes. Termux retains independent 0.0.1-te2-termux-poc versionName,
  versionCode 20353. Free space remains roughly 17 GiB local / 13 GiB Pixel.
  These are not new device/live acceptance claims.
- [x] Candidate device/install/live acceptance, then separate tag/upload approval.
  Razr reconnected at motorola-razr-2024-xt2453v:5555; existing installer-managed
  0.2.352 tree has no live TE2 process. Preserve settings/project data during update.
  Pixel assembled a validation-only Termux archive using the prior audited locked
  dependency wheelhouse and candidate-03 TE2 wheel/server; SHA-256
  110902a131d9ff8ffb4e197b90524801fe41fc549901135f0962ad6be384a2a2.
  Slow TCP/IP transfer switched to user-connected USB serial ZY22K74WF4.
  All three staging APK installs pass and installed package metadata reports
  versionCode 20353. Standard archive installer passes and activates managed
  releases/0.2.353, preserving user data. Installed --version/--build-info report
  0.2.353; all 138 compiled domain imports and actual Node 24.18.0 Socket.IO/WBA
  entrypoint imports pass on the Razr. User UI/live acceptance
  explicitly confirmed for all three clients and shared-UID startup; user verified
  te2 --version reports te2-server 0.2.353. Debian installed acceptance also passed.
  Separate blocking approval authorizes normal GitHub release (alpha title, Latest)
  and PyPI publication. Tag 0.2.353 pushed at de8720dd; no existing tag moved.
- [x] Finalize production Termux provenance at clean tagged source without recompiling.
  Production wheel SHA-256:
  884d2620872913ff9f90b287c4f0fe44de37d37c1c6addb1cb9fdbe81a5bed9d.
  All 841 Code TE2 payload members other than runtime provenance are byte-identical
  to the accepted candidate. Audited production archive SHA-256:
  70f7e6738c8bb3e2ceb652224b1f52d76ee12580b9641c14c5aa976cc4eb26a5.
- [x] Complete GitHub/PyPI uploads and independently verify published inventory,
  checksums, normal-release/Latest status and PyPI version.
  GitHub release 0.2.353 is public, normal (not prerelease), and Latest, with
  all 14 files verified against local sizes and server-side SHA-256 digests.
  PyPI publishes the Linux wheel and source archive with matching SHA-256 hashes:
  wheel d0913285053dbcd8364a12bd6568ee41265648f4ac80ff66b0a1404b7b7c2dc2;
  source 1765e968f41f7ee0b838932cd3f86c02c59b87986d71e98cfcd0548f22df2a3c.
  Fresh version-API query confirms both files; a prior negative API cache briefly
  returned 404 after upload acceptance. GitHub draft was upload staging only.
  Local PyPI attempts returned HTTP 500 (wheel is 90,823,913 bytes, below the
  100,000,000-byte budget); local bulk GitHub upload returned HTTP 408/inactivity.
  User separately approved Debian publication for each service. Remote uploads
  use the exact accepted artifacts and ephemeral credentials through SSH stdin,
  with no saved tokens; all remote/uploaded hashes match. Root cause of the local
  transport failures is not proven. No new compile, version bump, or tag move.
  Release: https://github.com/mrsurge/termux-extensions-2/releases/tag/0.2.353
  PyPI: https://pypi.org/project/te2/0.2.353/

## Consolidated live acceptance — user confirmation

The user confirms all live validations for implemented work are complete,
including native/browser publication, reload/relaunch, poor connections,
multi-client/sidebar lifecycle, picker/input, terminal restoration and Electron
asset-pill OTA. Acceptance gates below are closed on that explicit confirmation,
not new agent measurements. Earlier checkpoint prose describing pending activation
or acceptance records its historical handoff and is superseded by this section.
Deferred implementation, quantitative probes and release approval remain separate.

## Current release cutoff — user decision

- [x] All implemented functionality is live accepted; no acceptance blockers remain.
- [x] OTA follow-ups are dev/editable-install ergonomics, not release blockers.
- [x] Existing asset audit/trim is sufficient for this release. Remaining small
  candidates move to the next maintenance branch; retain complete package manifests.
- [x] Defer remaining measurement probes, asset cleanup, OTA ergonomics,
  terminal post-child-exit/redraw issues, rare draft file-incarnation handling and
  lower-priority search work to the next maintenance branch.
- [x] Separately approve and perform release packaging/integration/publication.
  0.2.353 publication completed; see artifact staging receipts above.

Deferred entries below remain unfinished, but are not current-release gates.
Smaller host.js and generic-browser HTTP gzip delivery are already implemented.

## Final punchout — approved pre-release fixes

### Built-in entry-resource coverage — pre-release correction

- [x] User approved exact built-in entry mappings/inventory, cross-client
  regression checks and source/client validation; no APK install or release.
- [x] Bundle File Explorer template/adapter plus equivalent ALS-RS wrapper,
  Archive Manager, Aria Downloader, File Editor, Settings and Terminal resources.
  Map directory/by-ID URLs consistently in Electron, Gecko and Cefrium/TE2 Termux;
  ALS-RS canonical ID `als-rs` maps to source directory `als_rs`.
- [x] Additional active gap: standalone Terminal touch/Ctrl helper directory
  lacked bundle inventory/local routes. Include it and its directory/by-ID alias.
  Remove retired Highlight.js stylesheet routes and align Terminal's script
  version query with its 0.2.352 manifest. No dynamic/private/custom-app intercept.
- [x] Require new built-in entry resources before OTA activation; malformed or
  incomplete bundles do not fall through to remote frontend copies.
- [x] Seven Node coverage/icon checks, all 120 Electron tests, Electron
  typecheck/compile, Gecko JVM tests and Cefrium JVM tests pass.
- [x] Android seed regenerated from all 55 manifest entries: 293 files / 37 MiB.
  SHA-256 comparison verifies 50 explicit/dependency/helper outputs against
  source, including current File Explorer generated modules. Existing stale seed
  grammar/Highlight.js outputs disappear through the normal full-tree replacement.
- [ ] Rebuilt native client/package deployment and live local-resource acceptance.
  Routing edits need APK/Electron updates, not just OTA; no APK assembly/install,
  worker/framework restart, tags or release publication performed in this slice.

### Final File Explorer terminal zoom

- [x] Approved A−/A+ toolbar controls matching standalone Terminal ergonomics:
  1px steps, 10–28px bounds, default 13px. App-owned localStorage key
  `te2_file_explorer_terminal_font_size`; missing/invalid/blocked storage is safe.
- [x] Pointer activation preserves terminal focus; keyboard/assistive activation
  works without duplicate pointer-click increments. Refit/resize uses the existing
  control/output connection, with no reset, shell replacement or reconnect.
- [x] Restore the preference on terminal mount/tab switch; disable controls at
  bounds/without a mounted terminal and dispose button handlers with the drawer.
- [x] Typecheck, frontend rebuild and all 145 File Explorer frontend tests pass,
  including persistent bounds/storage failures and real drawer zoom/no-reconnect.
  Hidden desktop extra keys do not install mobile Shift gesture listeners.
- [ ] Current client asset publication and live zoom acceptance. No APK/mypyc/
  backend rebuild or framework restart is required; release follows acceptance.

### Resize/restore terminal interaction follow-up

- [x] Reproduced/inspected Electron sidebar nvim and drawer. Sidebar preserved
  DRAG/SGR mouse modes; restored drawer reported NONE/DEFAULT and normal buffer
  despite nvim contents. Cursor block inherited cell RGB background inline.
- [x] Shared DOM cursor binding removes only block-cursor inline foreground/
  background after render, retaining xterm's themed cursor rules. Applied to
  all terminal owners. Live drawer probe changes cursor from cell RGB to white
  themed block without sending input or resizing/replacing the terminal.
- [x] Pyte checkpoint restores the explicit supported mode set (mouse protocol/
  encoding, paste, application cursors, alternate buffer, origin/scroll region)
  from parsed screen state; no arbitrary raw control replay. Existing test
  expecting paste mode loss revised to the corrected restoration contract.
- [x] Drawer clipboard binding remains attached while its renderer survives a
  drawer close; shared openDrawer() can reopen without activateTerminal(), so
  disposing the binding on close left the restored drawer without a menu.
- [x] Frontend typechecks/builds pass; 144 File Explorer and 24 standalone tests,
  17 interpreted projection tests and two cursor/menu tests pass. Compiled snapshot
  check-20261012-001831-1791764311485212390 validates 138/138 modules (358.18s).
  Fourteen compiled projection/replay tests pass; three monkeypatch-based lazy
  tests bypass patched callbacks under mypyc early binding and remain interpreted
  tests, where they pass. Snapshot selected for next launch; no runtime restart.
- [x] Electron OTA installed matching host.js bytes; user restarted/reloaded
  and reports Code TE2 drawer working 100% flawlessly. Drawer live acceptance.
- [x] User reports File Explorer and standalone Terminal work after resize.
- [x] User confirms File Explorer is fixed after loading the current worker.
- [x] User live acceptance of standalone Terminal checkpoint encoding fix.
  Separate badly drawn non-redrawing state remains deferred as requested.

Reload investigation after checkpoint 50c834e5: live standalone nvim reports DRAG
protocol but DEFAULT encoding. Pinned SerializeAddon serializes tracking mode
but omits 1006/1016 encoding. Broker now appends actual headless encoding to
checkpoints (reset encodings, then selected enable); real-broker regression
verifies DRAG and SGR survive attach. All 24 Terminal tests pass. Existing broker
processes require explicit replacement to load the changed script; not done.
Strengthened real-broker test replays its actual checkpoint into a fresh xterm
renderer and asserts both DRAG protocol and SGR encoding, rather than only
checking escape-string presence. Test suite and broker syntax validation pass.
This is Node broker source only: no frontend OTA, mypyc or Rust rebuild required.

### Final mobile terminal ergonomics

- Approved: replace redundant extra-key minibar buttons in File Explorer and
  standalone Terminal with Shift; fix drawer Shift/selection ownership; hide
  File Explorer mobile footer while its terminal is visible. Investigate and
  reuse existing key/selection mechanisms, preserving each app's ownership.
- [x] Shift replaces the extra-row minibar in File Explorer and standalone
  Terminal. Single-tap arms one key; double-tap (350ms) or long-press (500ms)
  locks it until tapped again, with pressed/locked feedback. Shift reaches all
  synthetic navigation keys and printable IME text independently of Ctrl.
- [x] Drawer Shift/Sel navigation already transports shiftKey; the missing seam
  was IME text arriving without that flag. Its text-output path now applies the
  current modifier projection and consumes armed Shift. User chose Sel as sticky
  Shift forwarded to the terminal app, not local-buffer selection interception.
  Terminal-editor key bindings own the resulting selection behavior.
- [x] File Explorer expanded terminal hides the redundant footer at its existing
  820px breakpoint and owns the safe-area inset; minimize/close restores footer.
- [x] Each app retains its own state; shared helpers only transform printable
  text and bind gesture timing. Pending long-press timers cancel on lifecycle
  transitions/disposal. Protocol escape/control sequences are untouched.
- [x] All three frontend typechecks/builds; 24 standalone tests, 144 File Explorer
  frontend tests and 18 focused Code TE2/mobile/transport regressions pass.
- [x] User live acceptance: Shift behavior works in Fresh terminal editor.
  The apparent nvim failure was its configured Shift word/paragraph navigation
  in normal/insert modes, not missing modifier transport. Current changes accepted.

File Explorer worker PID 1038016 started 2026-10-11 18:56:14; shared projection
changed at 19:11:03. Its eagerly imported projection predates the fix. All three
current raw logs retain SGR/DRAG/alternate state under read-only Pyte inspection.
Refresh File Explorer's worker explicitly before judging new restoration behavior.
Page/asset reloads and retained-framework restarts do not replace that worker.

Follow-up live failures: selected-theme callback incorrectly supplied the full
cache map to the TextMate runtime; corrected to publish its selected theme.
Snippet backgrounds are now container CSS variables applied on cold/live theme
load. Diff rows own their tint, tokens own glyphs only; eliminate individual
opaque code backgrounds and hardcoded context/gutter backgrounds.
Terminal contextmenu always prevents browser default, including TUI mouse mode.
Electron native context menus check the originating renderer terminal ownership
marker before popup. Requires Electron rebuild/relaunch beyond frontend OTA.
Cursor issue remains under investigation: live Electron nvim cursor is present,
white outline visible in computed CSS, document.hasFocus=false at inspection.
This does not prove correct cursor behavior when the user is actively typing.
Follow-up validation: 13 theme/restore/TextMate tests, clipboard ownership test,
120 Electron tests, Code TE2/Electron typechecks and all frontend builds pass.
Cursor focus probe installed in the refreshed Electron main-page worker; captures
focus/cursor state only, never keystroke contents. Cursor reproduction remains
pending; theme/menu fixes also require matched client publication/live acceptance.
OTA activation follow-up: live console forceAssetUpdate returned updated/valid;
installed host.js SHA-256 matched the current source build. Its old API only
installed, leaving activation to a separate reload. Updated native command now
returns its result then reloads the calling view after 750ms; Electron typecheck
and compile pass, relaunch/live validation pending. Pill source already uses the
Settings update-and-reload command; reported live pill failure remains unresolved.

- [x] 1. Explicit COLORTERM=truecolor in both Node PTYs and native drawer PTYs.
  Existing raw streams and checkpoint RGB serialization preserve 24-bit colors;
  new RGB checkpoint regression passes. Existing shells need replacement to pick
  up the new environment; no automatic shell replacement.
- [x] 3. File Explorer Ctrl+backtick returns focus to the selected/first visible
  listing entry (empty listing falls back to filter), while retaining its shell.
- [x] 4. Explorer TextMate code surfaces receive the editor theme background;
  README code fences apply it to their pre/code surface. Existing repaint and
  epoch fences retain theme-change handling.
- [x] 6. App-neutral terminal clipboard menu used by all three terminal surfaces.
  Mouse-reporting applications retain right-click; Shift+right-click explicitly
  opens Copy/Paste. Paste uses xterm's paste API; late reads are fenced by dispose.
- [x] Typechecks/builds for all three frontends; 13 context-menu/keyboard/drawer,
  six TextMate, 24 standalone Terminal and four shared projection tests pass.
  Native PTY environment test and cached native release build pass.
- [x] Native worker activation, frontend OTA and user live acceptance of these
  four fixes. No runtime/shell restart, client publication or APK build performed.
- Deferred: notes.md items 2, 5 and 8, plus lower-priority search work.
- Deferred 7: delete/recreate while an editor model is open can reapply an old
  draft at the same path. Investigate file incarnation/draft identity before
  changing invalidation; preserve legitimate drafts. Confusing, currently rare,
  and not reported as destructive. Do not include in this pre-release slice.

- [x] Approve separate maintenance scope and branch.
- [x] Create initial plan and source entrypoint inventory.
- [x] Complete end-to-end file/theme/TextMate loading and cache audit (later loading/theme slices and consolidated user acceptance).
- [ ] Deferred to next maintenance: remaining request/byte counts and sequential dependency-wave measurements.
- [ ] Deferred to next maintenance: remaining cold/warm Markdown and comparison-language baselines.
- [x] Audit rapid file switches, reconnect and primary/secondary readiness races (later loading audit and consolidated user acceptance).
- [x] Approve a concrete implementation slice supported by evidence.
- [x] Implement and pass delayed-response regression tests/build validation.
- [x] Publish matching assets/compiled domain to explicitly approved test clients.
- [x] Record user acceptance of the observed Markdown/cache and browser HTTP paths.
- [ ] Prepare maintenance release only after separate release approval.

Acceptance is not implied by implementation or static checks. Record measurements
and concrete findings here as they become available.

## Offline dependency probe (2026-10-09)

- [x] Repeatable real-parser/production-batch-loader probe, no runtime mutation.
- [x] Synthetic transitive dependency/injection batching, warm cache and revision
  reset regressions: 2 tests pass.
- [x] Installed bundled Code Server 4.130.0 comparison with 200ms simulated RPC cost.
- [ ] Deferred to next maintenance: complete native registry/request tracing; offline inventory
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
- [x] Authorized app lifecycle transition to load the selected group.
- [x] Native client asset publication and live poor-connection acceptance.

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
- [x] User client OTA and live high-latency Markdown/markup acceptance.

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
- [x] Rebuilt runtime activation and actual browser response/header acceptance.

No APK/client-asset changes or shared-runtime restart. UUID correction and stable
loopback ports are not implemented in this gzip slice.

## Plain-HTTP browser UUID correction

- [x] Reuse pinned Monaco `generateUuid`, including its secure-byte fallback.
- [x] Host client/window, native bridge, console/terminal and Sidebar ID callers updated.
- [x] Plain-HTTP regression with `randomUUID` absent verifies UUID bits, persistence,
  separate primary/secondary identities and explicit reset.
- [x] Frontend typecheck and host bundle rebuild pass.
- [x] Generic-browser live acceptance after loading the rebuilt assets.

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
- [x] 2b. Native deployment and cross-relaunch live origin/storage acceptance.
  Razr TE2 Termux staging is installed and user live-accepted; explicit origin/
  storage survival across relaunch and other client deployment are now covered
  by the consolidated user live-validation confirmation above.
- [x] 3. Investigate polling/WebSocket compression independently; benchmark before enabling.
- [x] 4. Design/validate persistent revision/ID/hash-scoped grammar caching across reloads.
- [x] 5. Investigate OTA archive/transfer compression and compatibility; retain Deflate ZIP.
- [x] 6. Finish poor-connection cold/warm, switch/reconnect and secondary-editor audit.
- [ ] 7. Deferred to next maintenance: remaining unused vendored/stale asset inventory; report evidence and sizes,
  accounting for dynamic loaders and package manifests. No deletion approval.
- [ ] 8. Separately approved maintenance release: matched binaries/domain/assets,
  staging APKs, target acceptance, merge/tag/publication.

Older publication/lifecycle notes describe their specific checkpoints. The latest
user confirmation closes implemented native/browser/compiled-mode live gates.
It does not authorize a new packaged release or establish new instrumented
measurements. See PLAN's Deferred follow-up sequence for release boundaries.

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
- [x] Native rebuild/deployment and cross-relaunch live origin/storage acceptance.

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
- [x] Matching compiled-domain rebuild/activation and approved worker lifecycle.
- [x] Client OTA and installed native/browser high-latency live acceptance.

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
- [x] Explicit client OTA and physical cross-reload/cross-relaunch acceptance.

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
- [x] Explicit native client OTA and poor-connection live acceptance.

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
- [ ] Deferred to next maintenance: remaining per-candidate dynamic-consumer and compatibility checks.
- [ ] Deferred to next maintenance: separately approve remaining cleanup and validate matching packaged clients.

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
- [x] F2: shared consumer mouse/touch/keyboard and picker-mode acceptance.
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
- [x] F3: desktop/mobile input and detached-window live acceptance.
- [x] F4: define and implement disk-backed tab-session identity/lifetime.
- [x] F4: complete drawer transport and terminal ownership contract (later app-owned broker/raw-stream slices).
- [x] F4 prerequisite: migrate File Explorer to explicit raw ASGI without transitive FastAPI/Pydantic imports; preserve HTTP/download/job/pipe contracts and measure import closure.
- [x] F4 prerequisite: strict mypy/no explicit Any, ty and basedpyright checks for the complete File Explorer backend and ASGI boundary.
- [x] F4 prerequisite: standalone mypyc build plus compiled-route/job smoke validation.
- [x] F4 prerequisite: raw-ASGI worker user live acceptance (reported passing).
- [x] F4: backend-owned Socket.IO session rooms, revisioned author acknowledgements/peer updates, reconnect snapshots and no mutation echo/replay (source/regressions; user live acceptance).
- [x] F4: persist tab path/options and Sidebar tab references (source/regressions; user live acceptance).
- [x] F4: reconcile live shell association and terminal teardown (implemented in later terminal slices).
- [x] F4: fresh versus existing-tab query mounts and retained creation correlation (source/regressions; user live acceptance).
- [x] F4: context-sensitive splash/list, New/Close and close-consent UI (source/regressions; user live acceptance, including splash refresh and live dropdown).
- [x] F4: shared picker icon helper/rules in File Explorer list/grid rows.
- [x] F4: implement checkbox-free file selection (icon toggles, body long press/menu, desktop range/additive toggles), Clear selection and Esc.
- [x] F4: native asset publication and live acceptance of icons/selection.
- [x] F4: explicit terminal close; exited-shell disassociation; hide/reload retains live shell.
- [x] F4: drawer minimize/maximize and Lock directory with pipe-backed command injection.
- [x] F4: app-owned shellspec/broker with neutral Pyte projection and matching xterm/mobile/extra-key behavior. Supersedes the rejected cross-app shellspec/source reuse proposal.
- [x] F4: extra keys absent for desktop user agents, including narrow windows.
- [x] F4: depth-one regex listing and asynchronous directory usage view.
- [x] F4: multi-client, standalone/sidebar, lifecycle and large-tree acceptance.
- [ ] Separately approve maintenance packaging/release scope after chosen slices.

### F4 revised tab-session direction — investigation gate

#### Shared terminal projection extraction prerequisite

Sidebar tab-reference regression follow-up (2026-10-11): user reported restored
File Explorer windows returning to splash. Exact live console evidence showed
`sidebar state publish failed` / `TypeError: Invalid URL` at main.js publication:
the splash-refresh follow-up passed a relative `buildStatefulUrl` result to
`tabUrl`, whose `new URL(url)` required an absolute input. Publication threw before
the backend request and left the prior splash reference unchanged. `tabUrl` now
accepts an explicit base; publication passes the current client location. Seven
frontend regressions pass, including relative publication and restored attach versus
identity-free splash on both direct and relay origins. Syntax/diff checks pass.
Frontend-only: update native assets, select the intended tab once to publish its
reference, then test refresh/restore. No backend/mypyc build or restart is needed.
No automatic guessing/recovery from a previously lost Sidebar tab association.
User live acceptance passed for restored tab references after asset publication.
Terminal extraction resumes at the shell-control boundary; its compiled proof is
validation only, not an activated full Code TE2 domain.

User approved extracting only the app-neutral Pyte/checkpoint core with injected
per-registry log readers, preserving Code TE2's native adapter and existing behavior.
`app/libs/terminal_runtime/` now owns the same parser/checkpoint/delta implementation;
Code TE2 exports the existing public DTOs, registry and singleton from thin adapters.
Native configuration/descriptor ownership remain in Code TE2. The shared registry
does not import Code TE2 or initialize Pyte on import, and has no implicit I/O default.
Independent readers/state, failure propagation, cancellation, raw offsets, split
UTF-8, file replacement/truncation and resizing are tested. Code TE2 native failures
still never fall back to the interpreted test reader.

20 interpreted regressions and strict mypy/ty/basedpyright checks pass. An independent
five-module mypyc probe passes 11 compiled tests; retained artifact:
`.codex-scratch/shared-terminal-projection-mypyc-final-20261011/lib`.
Final combined interpreted rerun passes 32 tests including durable tabs. No full
domain selection, worker activation/restart, shell launch or UI change.
The existing production domain inventory discovers app.libs imports; the packaged
source closure already includes app/libs. A matching full-domain rebuild remains
required before activating Code TE2 source changes, not implied by this small probe.

Next prerequisite: define File Explorer's shell service ownership/transport adapter.
Code TE2's `native_shells.get_manager()` requires its embedded Rust bridge; the
ordinary File Explorer `app.libs.app_worker` process does not configure one. Do not
import Code TE2's project-bound terminal_backend or silently use a legacy I/O path
as a substitute. Shell launch/input/resize/observation/teardown and per-tab live-ID
reconciliation need a separately approved concrete slice before drawer UI wiring.

Correction and backend foundation (2026-10-11): user clarified the intended
pre-native Code TE2 model. Git parent of 0aed2445 confirms lazy framework_shells
get_manager/Orchestrator PTY shellspec launch, manager input/resize/removal and
Pyte raw-log checkpoints. The Python package remains a runtime dependency. The
additional uncommitted Rust extraction and associated notes/tests were reversed,
leaving the committed shared Pyte core intact. Code TE2's native boundary is not
a File Explorer prerequisite; the older no-Python-I/O assumption above is
superseded for this app.

Approved backend slice now uses File Explorer-owned shellspec/terminal.yaml,
lazy typed Framework-Shells adapter and injected Python raw-log reader. Durable
shellId association changes persist before memory commit and advance revisions.
The existing tabs lane exposes explicit Start/Status/Close/Input/Resize/Checkpoint
with attached-tab/current-revision checks, exact tab labels and live capabilities.
Attach/status reconcile confirmed missing/exited associations without restarting;
running-but-uncontrolled/foreign records fail closed. Disconnect retains shells;
tab close retains its explicit-terminal-close prerequisite. Newly spawned shells
are removed if association persistence fails. No runtime restart/activation or
frontend/Android/publication work. Drawer rendering and event-driven live output
and exit notifications remain subsequent slices, not implemented acceptance.

70 interpreted tab/terminal/raw-ASGI/shared-projection regressions pass. Strict
mypy, ty and basedpyright pass with no diagnostics. The standalone six-module
mypyc proof passes 55 compiled regressions; final artifact is
`.codex-scratch/file-explorer-fws-terminal-final-20261011/lib` (not activated).
This is isolated regression evidence, not live Framework-Shells/device acceptance.
Two additional compiled tests pass for cancellation cleanup and recovering an
existing exact-label association without duplicate launch; actual terminal/log
module `.so` imports were verified. Total compiled coverage is 57 tests.
See File Explorer TERMINAL.md for wire details.

#### File Explorer terminal drawer implementation checkpoint

Directory tracking production slice (2026-10-11, separately approved):
- Clarified user contract supersedes the earlier default-off proposal: default
  locked/on, durable tab-owned boolean, event-linked checkbox for every attached
  presentation. Manual terminal cd remains until another browsing navigation;
  tab switching/reconnect never requests cd. Unlock cancels unconsumed requests;
  an already-consumed shell action cannot be reversed. Re-lock arms future browsing.
- New-shell-only app-owned Bash --init-file integration sources normal login
  profiles and preserves scalar/array prompt hooks and command exit status.
  Existing terminals are untouched and show tracking unavailable until explicit
  close/new start. The known login_shell=off compatibility tradeoff remains.
- Private generation-scoped request/ack files contain revision+unique token,
  enabled flag and literal NUL-delimited path. Prompt-time consumption is once
  per token, with no eval/input injection or failed-cd retry. Output wakeups read
  pending acknowledgments only; checkpoint piggybacks status. No new watcher,
  polling, cross-tab terminal reassignment or reconnect mutation is introduced.
- Durable schema-1 records migrate missing lock to on and missing integration
  to unavailable; options-only writes do not overwrite the lock. Peer snapshots
  synchronize the checkbox, and exact-tab/shell events fence pending/error UI.
- Strict mypy/no explicit Any, ty, basedpyright, TypeScript checking/build and
  targeted frontend regressions pass. The expanded backend/PTY suite includes
  the actual production hook, manual cd, cancellation, shell error, literal
  paths, migration, private files, peer lock events and navigation-only requests.
  Final validation: 99 backend/PTY regressions and 13 frontend tab/drawer tests
  pass; all seven backend boundary modules pass strict mypy. Bash syntax and
  authored-source whitespace checks pass. No compiled-domain build was required
  for this ordinary Python worker.
- No worker/shared-framework restart, client OTA, Android source/build, APK or
  commit/push is performed. Live test needs a File Explorer worker refresh,
  explicit client asset publication, and a newly started tab terminal. Code TE2
  mypyc rebuild is not required. Termux/multi-client live acceptance remains open.

User live acceptance on 2026-10-11 confirms the hot-path performance follow-up
and mobile footer/exact key-layout correction in 29ae7bae work. This supersedes
their pending live-acceptance notes below, not exhaustive multi-client or release
acceptance. Lock directory was unimplemented at that historical checkpoint;
the later broker/control slices implemented it and are now live accepted.

Lock directory preliminary source investigation (read-only application code):
- `terminal_service.py` launches interactive Bash at the tab path; subsequent
  `tabs.update` in `tab_service.py` persists browsing path/options without changing
  the shell CWD. The durable record currently has no lock setting.
- Code TE2's existing run-command path quotes tokens with `shlex.quote` then
  writes a command/newline through `write_to_pty`. FWS's `write_to_shell` provides
  transport/metadata handling, not semantic shell command execution.
- FWS `get_shell_capabilities` verifies live transport ownership, not prompt
  readiness. The examined APIs do not expose an empty-readline/foreground-safe
  command injection contract. Pyte screen state is not proof of shell readiness.
- Do not automatically inject `cd` on navigation/reconnect: it could reach a
  foreground program or append to partially typed input. Foreground process
  checks alone would still not establish an empty shell input line.
- Clarify whether Lock directory means terminal follows browsing, browsing is
  locked/follows terminal, or terminal stays at a pinned directory. Only then
  select a concrete implementation. Preserve exact-tab/revision/live-shell
  guards, safe quoting, bounded writes and no uncertain mutation replay.
User clarified: terminal follows browser navigation. Investigate a shell-owned
prompt hook plus private backend-owned latest-directory mailbox, rather than
automatic PTY text injection. Bash would consume the latest desired directory
at its next prompt using quoted builtin `cd`; foreground programs and unfinished
Readline input are left untouched. Busy shells therefore defer synchronization
until returning to a prompt. This is a candidate, not an approved implementation:
preserve existing `bash -l -i` login/profile initialization, user prompt hooks,
exact shell generation/lifecycle and safe private mailbox ownership. Lock-off,
enable-time behavior, failure feedback and restoration policy still need a
concrete design/approval; never infer them from transport reconnect.
No application source edits, worker refresh, framework restart or build followed
this investigation.

Isolated Bash probe checkpoint: `tests/test_file_explorer_directory_lock_probe.py`
passes five tests on local Bash 5.3.9. Disposable login PTYs prove profile loading,
scalar/array prompt-hook chaining with retained command status, no input injection
into a foreground child or unfinished Readline input, latest-path coalescing,
and literal handling of quotes/newlines/metacharacters. The positive fixtures
explicitly install the hook after profile loading; they do not prove transparent
production installation. Environment-only PROMPT_COMMAND injection was displaced
by this machine's system profile. No real startup files are changed.
Code Server's authored `shellIntegration-bash.sh` uses --init-file and manually
sources /etc/profile plus the first readable .bash_profile/.bash_login/.profile,
then installs its hooks. Its own comment explicitly calls this imitation of -l:
the actual login_shell flag is not preserved. Adopting that startup approach for
new File Explorer terminals requires approval of the compatibility tradeoff;
existing terminals must not receive automatic initialization commands. Production
mailbox bounds, permissions, acknowledgment, lock-off and lifecycle tests remain
unimplemented. No application or live-runtime modification follows from the probe.

User approved extending only the prototype to Code Server-style --init-file
startup. All ten isolated tests now pass on local Bash 5.3.9: the first readable
login profile is selected once, later profiles are skipped, and scalar/array
PROMPT_COMMAND replacements from profiles survive with the integration installed
afterward. Tests explicitly confirm login_shell=off, not true login equivalence.
These tests use disposable files/PTYS and do not modify real shell startup files.
Termux execution is not yet validated. Production approval is still separate.
Proposed next slice: new-shell-only app-owned startup hook (no user profile edits),
persisted per-tab Lock directory default off, backend-selected latest navigation
revision delivered through a private shell-generation mailbox, one consumption
per request at a prompt, and observable applied/error acknowledgment. Disabling
clears pending intent; reconnect/attach never injects/replays a command. Existing
uninstrumented shells require explicit close/new start, not live initialization.
Safe paths must remain data (no eval), and locking cannot claim applied CWD until
the shell confirms it. Bound/secure mailbox data and preserve original prompt
hooks/status, exact-tab ownership, concurrent navigation and shell teardown.

Mobile key/footer correction (2026-10-11): the fixed mobile footer overlapped
the drawer because only the file list reserved bottom space. Footer now occupies
the final in-flow flex row below the terminal/key dock and owns the safe-area
inset; obsolete list-only compensation is removed. Keys match Terminal's exact
7-column/two-row ordering and geometry, default-visible mobile-only toggle,
pointer-down dispatch, Ctrl armed/locked styling, one-shot modifiers, shared
arrow hold-repeat and guarded minibar (opens the existing Tabs menu). Held keys
are fenced across tab/renderer changes. Frontend typecheck/build and targeted
regressions pass; native OTA and user live acceptance remain pending. No Android
source/build or shared framework restart is performed.

Approved UI source now adds Terminal/Show, minimize/maximize and confirmed Close,
with active-terminal confirmation before tab closure. It uses existing custom
xterm/Fit/WebFonts/touch assets and shared mobile-UA key helpers; desktop keys are
hidden regardless of window width. TypeScript builds to the existing static/js
OTA root through the Terminal frontend builder. No Android source or APK changed.

Framework-Shells output/exit events lazily wake raw-log Pyte projection, with
binary deltas on the exact tab room and persisted exited-shell disassociation.
Frontend checkpoint handoff uses bounded admission, raw offsets and asynchronous
tab/shell/connection fences. Reconnect restores a checkpoint; input is never
replayed. Association ACKs share the path-update mutation lane and association
changes alone do not refetch directory contents. Shutdown unsubscribes observers
without ending retained shells. Directory-lock injection remains deferred.

Validation: 85 interpreted Python regressions; strict mypy/no explicit Any, ty,
basedpyright (zero errors/warnings); Terminal and drawer TypeScript checks/build;
22 existing Terminal tests plus 10 tab/drawer tests, including checkpoint/delta
ordering, stale mount rejection, desktop-key hiding, retained minimized/disposed
shells and terminal-association revision ordering. The updated standalone six-module
mypyc proof passes 57 smoke tests at
`.codex-scratch/file-explorer-drawer-20261011/lib` (not activated), plus two compiled
output/exit and close-consent regressions. No live acceptance is claimed; no
runtime restart, client OTA, commit/push or release performed. Live test needs
File Explorer worker refresh and explicit native asset OTA, not Code TE2 rebuild.

User live acceptance confirms the terminal drawer works and looks good. The user
also reports severe slowness; performance acceptance remains open and is the next
read-only investigation. This does not authorize a shared runtime restart or an
unreviewed performance rewrite.

Performance follow-up was separately approved after read-only live inspection:
the FWS runtime had 195 metadata records; reading them all took 291.18 ms,
describing a terminal took 18.72 ms, and reading one record took 2.00 ms.
`get_shell` invokes full adoption/metadata traversal; our previous implementation
called it for each input and output wakeup while holding the tab service lock.
Live desktop xterm/helper asset fetches were approximately 4–28 ms each, not an
explanation for ongoing input/output lag. These are diagnostic API measurements,
not an instrumented full keystroke round trip or an Android timing claim.

Source now uses FWS's existing signature-checked exact-record load and live
capability query, avoiding adoption scans/process stats on the hot path. Frontend
input batches pending keystrokes behind one ordered ACK, capped at 4 KiB per
request/64 KiB admitted bytes, and drops unsent input on uncertainty/disconnect
or tab changes. Ownership/label, capability, revision and connection fences remain.
85 Python regressions and strict mypy/ty/basedpyright pass; 12 frontend tab/drawer
tests plus TypeScript checking/build pass. The accepted UI checkpoint was pushed
as cd89fff8; this performance follow-up is included in the next requested
checkpoint with the mobile footer/key correction and is not live-accepted.
The inspected worker subsequently disappeared from runtime-debug discovery;
no stale-target replay or runtime restart was performed. Refresh File Explorer
and publish the rebuilt native assets via OTA before performance validation.

#### Durable tabs and synchronization implementation checkpoint

User approved the end-to-end tab lifecycle slice, including the refined launcher
rules. File Explorer now owns `tabs.json` under its existing
`te2_app_data_home('file_explorer')` root. Schema 1 records ID/path/revision/options
and a reserved nullable shell ID; atomic replacements precede in-memory commits.
The JSON store loads once lazily, fails closed on malformed state, retains bounded
creation receipts and never treats presentation destruction as tab deletion.
Live terminal association/exit reconciliation remain the subsequent slice.

The manifest declares `/api/app/file_explorer/socket.io`; Python Socket.IO composes
with the raw HTTP export, namespace `/tabs`, WebSocket-only with 64 KiB incoming
admission. A typed service owns the serialization lock and selects tab/catalog
rooms. Presentation IDs identify attachments, not an independent authentication
credential; the existing framework exposure/worker access boundary is retained.
Create/attach/list/update/close/default-project requests return ACKs, including
directory validation failures. Updates check expected revision and notify peer
sockets without echoing to the author; deletion notifies mounted clients. Splash
catalogs refresh on creation/closure. Disconnect drops pending/buffered writes;
reconnect reads authoritative state. Failed updates resync read-only and invalidate
older queued writes, without retrying the mutation.

Frontend UI calls these sessions **tabs**. Bare Sidebar launch shows the list;
New uses the backend-resolved project path. Fresh path queries create directly;
explicit tab IDs restore and missing/closed IDs show the splash. Bare Framework
launch reads only the last ID from `te2:file-explorer:last-tab:v1`; New defaults
to Home when no tab is restored. The last-active hint survives visiting the list.
URL replacement removes fresh path/correlation after mount. Backend Sidebar state
publication records only the tab reference (or bare splash), once per reference
transition rather than every directory navigation. Async listings/splash rendering
are generation-fenced; peers apply options/path without emitting another mutation.

Validation: strict mypy/no explicit Any, ty and basedpyright pass across all four
File Explorer Python modules. 101 interpreted backend regressions pass, including
an isolated real two-client Socket.IO/ASGI round trip and backend Sidebar-reference
publication. Five frontend protocol tests pass, covering launch modes, reconnect,
disconnect, failed-mutation resync and peer-before-ACK ordering. Code TE2 typecheck
and frontend build pass; File Explorer JS syntax checks pass. The expanded standalone
mypyc probe compiles all four modules and passes 47 compiled tests (9 interpreted
fixtures deselected), including the real Socket.IO round trip. Current experimental
output: `.codex-scratch/file-explorer-tabs-mypyc-accepted-20261010/lib`.

The user subsequently restarted the worker, published/flushed client assets and
confirmed live acceptance after framework route activation. Inspection established
that new `sio_service` WebSocket mounts require a full framework restart: registry
reload replaces manifest data but not the immutable Socket.IO index/Axum router.
Do not promise that app-registry reload alone activates new mounts.
For live testing, framework startup must ingest the new `sio_service` declaration,
the File Explorer worker must use this backend, and native clients need the updated
template/main.js/shared `file_explorer_tabs.mjs` via their normal asset updater.

The approved menu follow-up moves Tabs to the end of the File/Edit/View menubar,
removes its twisties and uses the existing JS popup convention. The dropdown lists
live tabs with SVG close controls and New tab, without entering splash or detaching
the mounted tab. Read-only `tabs.catalog` preserves attachment; create/update/close
notify catalog subscribers. Splash remains the initial/missing/closed-tab fallback.
Validation: 56 backend tests, six frontend protocol tests, JS syntax, strict mypy,
ty and basedpyright pass. The four-module mypyc probe also passes 47 compiled tests
(9 deselected), retained at `.codex-scratch/file-explorer-tabs-menu-mypyc-20261010/lib`;
it is not activated. Catalog events during mounting cannot trigger splash detachment.
Dropdown live acceptance is pending; update client assets
and restart only the File Explorer worker for this backend addition. No additional
framework restart is required once its socket mount is active. No commit/release.

Splash-refresh follow-up: user reproduced a durable Home tab only after refreshing
a newly opened Sidebar window. File Explorer published an empty query state but
still declared `state_kind=path` and supplied Home; Sidebar's reconstruction fallback
converted that into a fresh `path` query. Splash now declares `state_kind=splash`
with no path or tab ID, and needs no directory resolution. Frontend publication
also strips creation paths from splash/tab-reference URLs. Project CWD and Home
remain transient New-tab defaults, resolved only when New is clicked, not durable
tab identities. A regression exercises publication, actual Sidebar URL rebuilding
and slot normalization and verifies the store stays unchanged. 63 backend tests,
six frontend tests, strict mypy/ty/basedpyright and syntax checks pass. Matching
worker restart/client OTA and live splash-refresh acceptance remain pending; no
runtime restart or commit. Earlier experimental mypyc output predates this fix.

User live acceptance passed for the tab dropdown and splash-refresh correction.
Final CSS polish makes the dropdown-only close SVG red and 24px (was 16px), with
nonshrinking geometry inside the unchanged 36px control; splash controls retain
their size. This polish requires the normal client asset update; no backend change.
The user also live-accepted this final close-icon polish. Final checkpoint rerun:
101 backend tests and six frontend protocol tests pass. Exhaustive all-client and
terminal lifecycle acceptance remain separate gates.
The existing full-tree asset manifest already includes these files.

Live checklist: Sidebar bare launch/New uses project; repeated explicit path opens
create distinct tabs; reload/Sidebar restore retains the same ID; two attached
windows synchronize path/options without author remount; closed-tab restores show
the splash; Framework launcher remembers the last tab or falls back to Home/New;
worker restart retains records; background/presentation closure retains tabs.

#### Raw-ASGI and strict-typing implementation checkpoint

After the investigation, the user approved the raw-ASGI migration and expanded
strict typing to the complete File Explorer Python backend. The worker now
exports `TE2_ASGI_APP` through the existing app-worker seam; explicit HTTP
dispatch replaces FastAPI routing while preserving download responses, jobs,
Sidebar/intent delegates and existing readiness behavior. Socket.IO rooms and
durable session records are still the next implementation slice.

Validation: 82 interpreted regression tests pass; strict mypy with
`--disallow-any-explicit`, ty and basedpyright pass for both backend modules.
The standalone two-module mypyc group builds and passes 35 compiled HTTP/job
smoke tests (9 interpreted-only fixtures deselected). Its retained experimental
output is `.codex-scratch/file-explorer-mypyc-validated-20261010/lib`; it is not
an activated worker or release payload. `scripts/probe_file_explorer_mypyc.py`
now performs the strict gate, build and compiled smoke automatically.

The compiled smoke exposed a mypyc-specific `frozenset | dict_keys` result-type
mismatch. Routes are now constructed once as an explicit frozenset; the final
compiled smoke validates that correction. Compiled sibling calls are early-bound,
so module monkeypatch fixtures are not used as proof of those call paths.

Isolated fresh desktop import samples decreased from 435 modules/0.4143s
(38 FastAPI and 66 Pydantic modules) to 266 modules/0.1114s with neither imported.
These single-run timings are not device-startup benchmarks; fresh-process tests
also verify the generic worker export avoids both dependency families.
No runtime restart, activation, Android publication, dependency removal or
release change occurred during implementation. The user subsequently confirmed
live acceptance of this slice. This does not establish deployed mypyc execution
or release packaging acceptance; session-store/room work remains pending.

2026-10-10 refinement: Terminal app is the lifecycle reference, but durable JSON
records—not active shells—own File Explorer sessions. Multiple Sidebar states may
reference the same session; background sessions remain available. Records retain
path/options and an optional shell association invalidated on confirmed exit or
explicit close. Socket.IO rooms distribute backend-authoritative updates to
attached presentations; author acknowledgements do not redirect their own view.
Operation IDs, expected/committed revisions and presentation identity fence
concurrent updates, reconnect and asynchronous directory rendering.

Preliminary source inspection: File Explorer currently exports a FastAPI
APIRouter, uses Body/Query defaults and FastAPI responses/exceptions, and launches
through `app.libs.app_worker`. The existing explicit `TE2_ASGI_APP` seam bypasses
the legacy FastAPI assembly; Terminal already composes a Python Socket.IO ASGI
lifecycle lane, but its state is shell-backed and cannot be copied as durable
Explorer identity. Code TE2's old HTTP adapter uses Starlette; a truly raw ASGI
dispatcher needs explicit validation/streaming/error tests, not a blind copy.
FastAPI removal is the next proposed prerequisite slice; session room/store
implementation follows it. No backend, transport, runtime or dependency edits
are authorized by this documentation checkpoint alone.

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

### F2 shared picker — implemented and live accepted

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
3. regex search (depth 1), paired with arrow/Enter/Space keyboard navigation
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
# Directory-control broker feasibility checkpoint (2026-10-11)

## File Explorer broker wiring checkpoint

Resize-handle follow-up (2026-10-11): matching 5px top-edge handle with an extended
hit area, touch/mouse pointer capture, keyboard separator controls, page-local
custom height and available-region bounds. Minimize hides the handle; dragging
Maximize restores custom sizing. Reuses the existing viewport resize observer
and cancels drag ownership on tab/disconnect/disposal. Fourteen frontend tab/drawer
regressions, TS typechecks and frontend rebuild pass. Native OTA/live resize
acceptance remains pending; no backend, Android source/build or runtime changes.

Font parity follow-up selects the Code TE2 drawer's `JetBrains Mono Nerd` family
and fallback stack, preloads that family, and declares all four regular/italic/
bold/bold-italic faces. These are the existing WOFF2 files also used by standalone
Terminal, not additional font assets. Native OTA/live font acceptance remains
pending; no backend or APK rebuild is required.

Prompt correction follow-up: the first broker implementation changed CWD without
regenerating Readline's cached prompt. Idle success/error now triggers one empty
accepted line with later input held until fresh idle; ordinary Bash prompt hooks
perform the redraw. Deferred cd runs before custom hooks and bash-preexec precmd
callbacks. Real Starship 1.22.1 and custom PROMPT_COMMAND tests reproduce the old
staleness and pass the corrected idle/deferred flow. Terminal suite is now 31/31;
20 Python terminal/broker/directory regressions pass. No runtime restart or shell
replacement was performed; physical user acceptance remains pending.

User live acceptance passed for the broker/directory-lock and prompt-refresh
slice on 2026-10-11. This closes the observed integration acceptance gate,
including the previously stale prompt; exhaustive device/trap compatibility and
the separately deferred raw WebSocket output lane remain distinct follow-ups.

- [x] Reuse Terminal Node runtime/shellspec and MessagePack pipe framing.
- [x] Live byte subscription/stdin adapter, independent control reader/event
  publisher, 64-event/1 MiB output admission and sequence-gap checkpoint reset.
- [x] Input, resize, attach checkpoint, directory request/cancel and typed state
  use the broker; Socket.IO remains the existing frontend/control lane.
- [x] Exact tab ownership, no restart/reconnect creation or mutation replay;
  explicit Close supports pre-broker PTYs without an I/O fallback.
- [x] Python-to-real-Node/Bash test: immediate idle literal-path cd, input/output,
  serialized checkpoint, ordered cancel/ping and correlated invalid-path error.
- [x] Targeted Python lifecycle/control suite: 32 pass; broader Bash feasibility
  run: 45 pass before adding the explicit old-PTY Close regression.
- [x] Final File Explorer HTTP/intent/tab/terminal/control regressions: 88 pass.
- [x] Terminal suite: 28 pass; frontend tab/drawer regressions: 13 pass;
  Terminal/File Explorer TypeScript typechecks and frontend build pass.
- [x] Strict mypy and ty pass for adapter/service/tab service; basedpyright
  reported no errors (its initially reported adapter warnings were cleaned up).
- [x] Approved worker refresh + native OTA and physical mobile/multi-client
  acceptance. No runtime activation occurred during this wiring.
- [x] Separate raw WebSocket terminal-output migration, after broker acceptance;
  retain Socket.IO for tab/CRUD synchronization and user commands (source/tests;
  matched backend/assets and user live acceptance remain pending).

### Raw terminal output and MessagePack control (2026-10-11)

User live acceptance passed after the resize/reconnect correction: the reported
raw-terminal reconnect loop is fixed. This closes the observed transport/fix
acceptance gate; exhaustive multi-device/slow-consumer testing and release
packaging remain separate. Source and rebuilt shared frontend assets are included
in the requested checkpoint.

Reconnect-loop follow-up: user reported a severe raw-output reconnect loop during
live validation. Read-only inspection found a concrete frontend lifecycle defect:
every viewport ResizeObserver notification called full checkpoint recovery and
replaced the raw socket, irrespective of rows/columns. Current worker inspection
found no corresponding backend exception; the live trigger was not instrumented.
Approved frontend correction separates fit/changed-dimension control requests
from stream recovery, including Show/Maximize/Minimize restoration. Repeated
identical resize notifications do no network work and do not reset xterm. Sixteen
frontend regressions now include repeated notifications, actual resize, maximized
and minimized restoration without socket replacement, plus explicit stream reset
and stale checkpoint cleanup. Typecheck/rebuild pass. Client OTA and user live
acceptance of this correction remain pending; no runtime restart was performed.

Approved follow-up models both socket boundaries after standalone Terminal:
Python reuses its msgspec codec; Node/browser use the matching MessagePack codec.
`/tabs` now negotiates msgpack-v1 and carries binary correlated request/ACK and
notification envelopes. Its domain remains ordinary typed DTOs; encoding belongs
at the wire seam. Raw `/ws/app/file_explorer/terminal` has no output rooms or
mutation ingress. A one-use presentation/tab/shell grant gates attach; checkpoint
is queued before output under the same tab-service lock. Existing offset fencing
handles older queued deltas. Per-presentation queues/send deadlines isolate slow
consumers, and reconnect obtains a new checkpoint without replaying input.
Socket.IO retains input/resize/directory/tabs and shared configuration rooms.

Validation: all 104 File Explorer Python tests and 16 frontend regressions pass;
strict mypy/no explicit Any, ty and basedpyright (zero errors/warnings), Terminal/
File Explorer TypeScript typechecks, frontend rebuild and diff whitespace check
pass. The shared codec is emitted once (21.1 KiB uncompressed), reused by tabs
and drawer; the existing asset-tree inventory includes it without an APK manifest
change.

Synthetic backend/frontend and actual isolated ASGI Socket.IO/raw socket checks
cover binary-only admission, malformed payloads, correlation, checkpoint/output
handoff, token reuse, disconnect cleanup, queue overflow and retained shell
ownership. Existing
native clients need both the new codec shared asset and rebuilt drawer/tabs/main
sources via OTA plus a File Explorer worker refresh; neither has been performed.
No shared framework restart, Android build, Code TE2 compilation, commit or release
is implied. Live performance/lifecycle acceptance remains pending.

This supersedes earlier notes saying File Explorer still launches the prompt-only
PTY/Pyte path. Standalone Terminal keeps directory control disabled. Private
control files, Bash 4.4+ and unsupported user WINCH traps remain documented in
File Explorer TERMINAL.md; physical Termux behavior is not established by desktop
subprocess tests. No Android edits, shared restart, commit/push or release.

## Opt-in broker/shell coordination result

- Added experimental DirectoryControl to the existing Node broker, selected
  only by an explicit environment flag/private root. Existing launchers do not
  enable it. No File Explorer shell or frontend runtime was replaced.
- Typed directory requests/results and shell state are separate from terminal
  output frames. Busy/idle comes from the injected Bash init hook, not broker
  spawn readiness or a child-process heuristic.
- SIGWINCH wakes idle Bash without PTY input bytes; SIGUSR1 did not. Existing
  WINCH traps are explicitly unsupported by the proof. Bash 4.4+ is required.
- Initial DEBUG-hook design failed the real system-profile test: WezTerm's
  bash-preexec wrapper classified signal processing as the prior user command.
  Replaced that design with PS0 shell-state publication, retaining existing
  DEBUG/preexec and prompt callbacks. No user profile files are modified.
- Real broker/PTY tests pass idle cd without Enter, twelve repeated changes,
  quote/newline literal paths, partial input preservation, Bash builtin read,
  foreground child input, missing-directory errors, manual cd and held-input
  ordering. Unit tests cover delayed idle/partial fences, busy downgrade,
  malformed requests, unsupported state, 64 KiB input bound and resource removal.
- Full Terminal npm suite: 28 pass. Terminal and File Explorer TS typechecks,
  Bash syntax check and authored diff check pass. Original three disposable
  Readline tests also remain separate evidence, not deployment acceptance.
- Next: reuse the pipe broker/session adapter for File Explorer without importing
  Terminal's FastAPI backend; preserve durable tab/lock/event authority. Current
  File Explorer terminal frontend uses the `/tabs` Socket.IO WebSocket, not the
  standalone Terminal raw MessagePack WebSocket. No frontend transport change
  was necessary for this coordination proof.
- Physical Termux, user-trap compatibility and live File Explorer integration
  remain unverified. No shared framework restart, OTA, Android build, commit,
  push or release in this slice.

- User reported `Directory change pending until the next prompt` at an idle
  prompt. Existing prompt-only mailbox is incomplete, not live accepted.
- Inspected Nautilus Terminal: quoted cd/newline injection, child-process busy
  check, optional Ctrl-E/Ctrl-U input removal. This is approximate busy detection,
  not a safe control channel or an unfinished-input preservation guarantee.
- Inspected actual Terminal Node broker: pipe shell owns node-pty and headless
  xterm; typed output/checkpoint/ready/exit already exist. `ready` is spawn-only;
  there are no directory-control or Bash prompt-state methods yet.
- Approved isolated prototype and plan updates only; no live shell replacement.
- Three disposable Bash PTY tests pass in
  `tests/test_terminal_directory_control_probe.py`: immediate empty-prompt cd
  without Enter, literal quote/newline paths, preserved unfinished input, and
  explicit demonstration that a wake escape sequence reaches a busy child.
- Four Node protocol tests pass including the new
  `terminal_directory_control_probe.test.mjs`: fragmented frames retain distinct
  directory request/result, shell-state and output types. These are candidate
  envelope names, NOT methods implemented in the production broker.
- Manual disposable-PTY signal experiment: SIGUSR1 trap produced no immediate
  idle Readline callback output. Not selected as a wake-up mechanism.
- Remaining prerequisite: prove shell/broker busy/readiness coordination and
  dispatch fencing before extending production control methods or migrating
  File Explorer. No FWS/shared-framework restart, frontend publication, Android
  change/build, commit or push occurred in this probe slice.

## File Explorer app boundary correction — 2026-10-11

- [x] Restore standalone Terminal broker, package scripts and build script exactly
  to their contents before File Explorer integration (`516b6c0a^`). Remove the
  File Explorer directory-control hooks/tests from the Terminal app.
- [x] File Explorer owns its pipe shellspec, raw Node-PTY worker, control hooks,
  codecs, package lock/runtime installer and frontend build/input helpers.
  Regression rejects imports/references to Terminal app source.
- [x] Remove headless xterm from File Explorer's dependency/runtime path. Forward
  raw output immediately with canonical byte offsets; reconstruct Pyte screen
  checkpoints only as needed, bounded at the Node attach acknowledgement.
- [x] Preserve split sentinel, idle/busy/partial-input protection and Starship
  prompt refresh; Node command state applies in ingress order without waiting
  for output drain. Checkpoint tests preserve partial escape bytes and reconstruct
  the same screen after replacing the Python projection owner.
- [x] Standalone: 22 Node tests, typecheck and build pass. File Explorer: 107
  backend/probe tests plus two isolation/checkpoint tests, 16 frontend tests,
  nine real-PTY/control tests, strict mypy, frontend typecheck/build pass.
- [x] Installed live acceptance with refreshed File Explorer worker and fresh
  terminal sessions. Existing processes are deliberately not killed by the
  source correction. Native frontend publication requires OTA.
- [x] File Explorer's production dependency bootstrap installs/verifies its own
  locked node-pty/MessagePack runtime under `node_runtime/file_explorer`.
  Rebuilt frontend bundles are byte-identical to the preceding accepted assets;
  this correction therefore needs no new OTA when those assets are installed.

The standalone parser/output queue and frontend batching predate this work;
restoration proves removal of the coupling, not the cause or resolution of the
user's latency observation. No commit/push/release or shared runtime restart is
implied by these validations.

## Immediate standalone Terminal input — 2026-10-11

User live acceptance: standalone Terminal is reported MUCH faster. The next
approved slice applies immediate input to File Explorer and adds Electron OTA
access through its title-bar asset pill.

- [x] Passive live timing found standalone input waits of about 16 ms for normal
  keys and up to 176 ms for held keys. Browser xterm parse callbacks were around
  0.1–0.2 ms in this sample. File Explorer sent initial input immediately but
  serialized later input behind acknowledgements; its transport remains separate.
- [x] Approved isolated change removes standalone normal/fast/repeat input timers
  and their retained state. Every nonempty xterm input event sends synchronously
  through the existing binary MessagePack WebSocket. Disconnected input drops;
  no ACK gate, reconnect replay, protocol or backend change is introduced.
- [x] Regression exercises actual authored input/send functions: synchronous
  typing/repeated arrows/control input, UTF-8 paste, empty input, disconnected
  states and replacement sockets. All 24 Terminal Node tests, typecheck and build
  pass. Frontend bundle regenerated.
- [x] Repeat isolated timer probe: zero-RTT standalone p95 echo decreased from
  18.58/73.46/177.45 ms (single/rapid/arrows) to 1.87/2.38/2.31 ms. These are Node
  timer simulations, not live browser/render or network acceptance. Reproduction:
  `node scripts/probe_terminal_latency.mjs <report-path>`; retained local reports
  are `.codex-scratch/terminal-latency-20261011.json` and
  `.codex-scratch/terminal-latency-immediate-20261011.json`.
- [x] User live acceptance: standalone Terminal is MUCH faster after activation.
  Reload alone does not update installed native assets.

The proxy/Nagle hypothesis remains unproven in the live framework and is not part
of this experiment. File Explorer ACK scheduling and standalone headless output
remain unchanged. Passive probes were removed after capture. User repo-memory
edits are preserved and requested for inclusion in the next commit; no commit or
push is implied by this implementation.

## File Explorer immediate input and Electron asset pill — 2026-10-11

- [x] File Explorer input now uses its existing token-attached raw MessagePack
  terminal socket. Remove the one-ACK-at-a-time frontend input queue; send UTF-8
  chunks immediately with 4096-byte frames, 64 KiB event admission and bounded
  browser buffered bytes. No disconnected/pre-checkpoint input or replay.
- [x] Sequential backend input reader validates binary frames and bounds. The
  existing service lock validates SID, tab attachment, stream membership and
  exact shell before dispatching through File Explorer's own broker. Session,
  directory and resize controls stay on Socket.IO; proxy/headless policy is untouched.
- [x] Electron title-bar asset pill is an accessible non-draggable button using
  the existing forced `update_assets` request. Busy state prevents repeat clicks;
  existing update events report success, while failures restore the button and
  display a toast. Active views reload through the existing OTA implementation.
- [x] 34 targeted Python tests, strict mypy, 16 File Explorer frontend tests,
  File Explorer typecheck/build, 120 Electron tests, typecheck/compile pass.
- [x] File Explorer user live acceptance after reloading the updated client:
  terminal lag is fixed. The initial retest still executed the old imported
  ACK-gated module even though a fresh asset read returned the updated bundle.
  Live inspection of the imported class and paired Socket.IO sends established
  this distinction. Backend input-to-output publication was about 2 ms; shell
  record validation was about 0.5–0.8 ms. Both timing probes were removed.
- [x] Electron asset-pill live acceptance. Relaunch the rebuilt Electron client
  to activate its title-bar change; editor OTA cannot update Electron chrome.

The user requested commit/push of this accepted snapshot, including their repo
memory/documentation consolidation. No shared framework restart was performed.

### File Explorer current-directory regex and keyboard navigation

- [x] Approved frontend-only slice: regex filters fetched names using the shared
  picker worker, 120 ms debounce, 500 ms deadline and identical size bounds.
  Obsolete results are fenced; errors are visible and clearing restores entries.
- [x] List/grid arrows move focus without selecting, Home/End reach boundaries,
  Space toggles selection and Enter opens the focused entry through existing
  actions. Selection icons retain toggle semantics; inputs/terminal are untouched.
  Focus is preserved across listing rerenders. Select-all uses displayed order.
- [x] Validation: 17 filter/tab/terminal tests and 26 selection/picker regressions
  pass; File Explorer typecheck/build, main.js syntax and diff checks pass.
- [x] User live acceptance for the completed filter/keyboard/modularization
  slice. Reload alone does not publish native-client assets; no backend rebuild
  or shared framework restart is required for these frontend changes.
- [x] Directory usage discovery completed; implementation recorded below.
  User selected the existing framework filesystem pipe service as the preferred
  boundary. Read-only discovery confirms File Explorer already uses
  `fs.listDirectory` via `service.fs`; exact usage/job contract and semantics are
  the implementation boundary. Runtime activation remains pending below.
  Investigation: FS currently has request/reply scheduling, while Search/Git own
  separate job registries. Python pipe timeout does not cancel Rust work. Plan a
  separate bounded scan lane and explicit cancellation/progress for long scans;
  do not occupy all four ordinary FS read permits. Search walker ignore/hidden
  filtering cannot be reused for disk accounting. Report depth limits rows, not
  recursion. Source: `framework_services/pipe/fs_pipe_ops.rs`, `scheduler.rs`,
  `fs_ops.rs` and `app/libs/pipe_runtime.py`.

#### Directory usage — framework pipe implementation

- [x] User approved implementation through the framework FS pipe. Documentation
  and delegated-role instructions checkpointed as `b326d88e`.
- [x] Electromux inspection found the worktree at older `e263289` versus recorded
  `2976c4f9`, plus uncommitted nested files. User selected keeping the recorded pin;
  no nested files or gitlink were committed/changed by this task.
- [x] Implement Rust scan jobs on a separate bounded lane, with owner-scoped
  start/cancel, progress/results, recursive allocation totals and explicit limits.
- [x] File Explorer derives the requested path from the attached tab, forwards
  scoped binary notifications to its requesting SID, and cancels on lifecycle
  changes. Pipe notifications wake the observer directly, without polling.
- [x] User correction: usage overlays the existing size column/icon tiles as
  purple pills, preserving the listing. Header Cancel, progressive child totals,
  retained results across presentation rerenders and navigation cancellation.
  Removed the initially implemented dialog; Rust progress now includes child rows.
- [x] Follow-up: usage is a retained View toggle saved locally. Every newly
  loaded directory starts its own scan; navigation/manual cancellation only
  stops the previous/current scan. Sort by Size dynamically uses measured
  totals, with unknown sizes last. Navigation persistence and progressive sort
  regressions pass alongside the existing frontend suite.
- [x] Validation: 142 frontend tests, 92 backend tests, seven Rust usage tests;
  frontend typecheck/bundle, strict backend mypy, Cargo check and whitespace checks
  pass. `python -B -m app.cli.run_rust_framework --build-only` completed the
  framework release build in 48.97 seconds after the inline/progressive correction
  and resolved the cached native editor
  worker. This did not restart or activate the shared runtime.
- [x] User live acceptance confirmed for the complete directory-usage slice,
  including dynamic size ordering and persistent browsing mode. No shared
  framework restart was performed by the agent.

#### Keyboard/filter polish follow-up

- [x] Filter now uses themed field styling rather than an unstyled browser input.
- [x] Backspace navigates to parent; Delete invokes existing warned deletion for
  the selection, or selects the focused entry first when selection is empty.
  Held keys do not repeatedly launch navigation/deletion dialogs.
- [x] Printable typing from listing entries focuses/appends to the regex field;
  Space remains selection. Text fields, composition and modifier shortcuts retain
  their own handling. Directory navigation returns focus to the visible listing.
- [x] Context-menu arrows/Home/End navigate enabled commands. Escape is consumed
  before page handlers and restores the invoking entry, preserving selection.
- [x] Follow-up validation: 45 selection/filter/picker/tab/terminal regressions
  pass; File Explorer typecheck/build, JavaScript syntax and diff checks pass.
- [x] User live acceptance: interface and keyboard/filter behavior working.

#### File Explorer modularization — approved first slice

- [x] Successful resolved directory changes and tab identity switches clear the
  transient regex field/error. Same-directory refreshes/options, failed requests
  and stale listing completions retain current filter state.
- [x] Typed viewport, listing keyboard and menu controllers extracted under
  `src/`; existing terminal controller stays independent. Tests use behavioral
  controller APIs rather than slicing rendering/selection from a monolithic file.
- [x] Source stylesheet/markup separated from generated `template.html`; CSS is
  minified inline at build time, with no extra stylesheet fetch/layout gate.
- [x] Stable `main.js` manifest adapter loads one minified app bundle under the
  already-published static JS tree. Terminal/codec/context compatibility outputs
  remain generated from their owning sources.
- [x] Later slices complete validated API/DTOs, tabs/splash, file workflows/dialogs,
  bookmarks, jobs and strict typing of the reduced `src/main.ts` composition root.
- [x] User live acceptance: the new source tree is clean and the app works live.
  User requested commit/push of this completed slice. No shared runtime restart.
- [x] Approved addition: Ctrl+backtick reuses the drawer's existing create/show/
  focus action. Listing/terminal capture, repeat/composition/dialog/inactive-tab
  guards and cleanup are covered by keyboard-controller regressions.
- [x] Final first-slice validation: strict TS check, minified build, 58 frontend
  regressions and 9 terminal-directory-control regressions pass. Source syntax
  and diff checks pass. The generated app bundle is 99,218 bytes (~97 KiB).
- [x] Final slice resolves pre-existing lifecycle seams: main-document Escape
  cleanup on same-root remount and old-listing filtering during pending requests.

#### File Explorer modularization — API and tabs slice

- [x] First slice committed/pushed as `ec41f30c`, with user live acceptance.
- [x] Approved frontend-only scope: strict app HTTP DTO validation, typed tab
  protocol/client and splash/tab-menu controllers, including stale mount ACK
  fencing. Preserve backend authority, existing codecs/transports and one-shot
  mutations; no Python, Android or shared framework lifecycle changes.
- [x] Implement typed boundaries and wire the remaining composition root.
- [x] Validate malformed DTOs, nullable metadata/missing tabs, concurrent mounts,
  disconnect/resync and existing terminal/selection/navigation regressions.
- [x] Strict TypeScript check, minified build and source syntax/diff checks pass.
  Existing terminal directory-control suite passes (9 tests). Frontend regression
  suite passes (78 tests), including DTO, tab protocol/client, splash/menu and
  navigation coverage.
- [x] User live acceptance: API/tabs slice works. User requested commit/push.
  No shared framework restart or Python/mypyc rebuild is required.
- [x] Later slices complete file workflows/properties, bookmarks, jobs and the
  strictly typed composition root. Global jobs/bookmarks/archive routes remain
  separate from the app HTTP facade.

#### File Explorer modularization — file actions and properties

- [x] API/tabs slice user live accepted and pushed as `e1632710`.
- [x] Approved frontend-only extraction of typed file actions/open/archive
  workflows and properties dialogs. Preserve existing backend endpoints, intent
  routing, confirmations, picker cancellation and partial-success summaries.
- [x] Approved safety fixes found during investigation: capture action targets
  and originating tab/directory before awaits; reject stale dialog/picker work;
  suppress stale properties fetch/focus/Apply UI updates. Already-issued mutations
  cannot be cancelled or undone by closing a dialog; no retries or rollback.
- [x] Approved removal of direct copy/move fallback after an attempted job POST,
  whose result may be uncertain. Direct operations remain when jobs are absent.
- [x] Extract controllers and integrate callbacks; root keeps navigation, jobs
  observation and durable sidebar/tab authority.
- [x] Validate captured targets, stale/closed dialogs, permission bits/order,
  job/direct success and uncertain failure, symlinks/size/archive guards.
- [x] Strict TypeScript check and minified build pass; 103 frontend regressions
  and 9 terminal-directory-control tests pass. Source syntax/diff checks pass.
  Remaining composition root is about 1,700 lines, not yet strictly typechecked.
- [x] User live acceptance: file actions/properties work. No backend rebuild,
  Android changes or shared framework restart.

#### File Explorer modularization — final strict frontend slice

- [x] User approved one coordinated delegated slice: bookmarks/jobs extraction,
  strict composition root and lifecycle cleanup; preserve backend authority and
  existing transports. Parent owns approval, integration and publication.
- [x] Complete strict bookmark/job DTO boundaries and composition root; fence
  same-document remounts, stale asynchronous work and pending listing rendering.
- [x] Strict typecheck and minified build pass; 135 frontend regressions and 9
  terminal-directory-control regressions pass. Includes six integrated startup,
  restore/remount/disposal/bfcache tests and validated boundary regressions.
  No explicit `any`, suppression directives or runtime route changes.
- [x] Publish matching assets through existing Electron OTA, then inspect the
  exact live client non-destructively. No framework restart or Android edits.
- [x] Electron forced OTA reports updated/valid; served bundle SHA-256 matches
  local output (`e2cade6d686454908456ac5ac45e10ac162295e6860ca1c2ebdbefb65d3a2ff0`,
  110,995 bytes). Both restored tab identities retained; filtering/clear,
  Properties open/close and bookmarks dialog pass non-destructive live checks.
  No file mutations, shell termination or shared framework restart.
- [x] User confirmed final live acceptance via blocking choice prompt (Pass).
  User approved checkpoint commit/push of the completed snapshot.
