# Monaco core and quick-fix tracker

Historical implementation/test evidence. Current pre-release status is maintained
once in docs/apps/release_0_2_354/TRACKER.md (2026-10-17 consolidation). Deferred
GPU/graph work remains deferred; old unchecked tests are not new release tasks.

## Based Ayu reload / watcher follow-up

- [x] Approved read-only comparison without client reload/runtime restart.
- [x] Exact live Electron/Cefrium comparison: same selected theme and palette,
  different `.mtk6` CSS (Ayu #ff8f40 vs stock #ce9178); isolated live-object
  reproduction throws `Illegal value for token color: RGBA(1`.
- [x] Approved fixes/builds/tests/docs, with publication and restarts excluded.
- [x] Fork fix preserves alpha, duplicate palette indices and repeat application.
- [x] WBA recursive watch resolves defaults/User/workspace excludes on every
  subscription, honoring false overrides and retaining Git lock suppression.
- [x] `gulp editor-distro`: zero compilation errors; published only generated
  tokenization JS/map. Retained unrelated vendored semantic-theme changes.
- [x] App typecheck, Monaco bootstrap and host/WBA builds pass.
- [x] 62 focused theme/TextMate/configuration/document/command regressions pass.
  Updated an older theme-test DOM mock to include the existing style API.
- [x] Isolated Chrome cold/live palette regression passes against the actual
  published ESM, including alpha CSS, duplicate indices and repeated application.
- [x] User reports the resulting slice appears to be working and authorizes
  checkpoint commit/push. Live acceptance is user-reported; client publication
  and WBA lifecycle were user-managed, not performed by the agent.
- [ ] Separate issue: Electron console registration can disappear after page
  reload; no repair/reload performed as part of this slice.

## Investigation and plan

- [x] User approved read-only audit of build minimality and hover quick fixes.
- [x] User requested both slices in the plan/tracker, CodeLens-first audit and
  an experimental GPU-renderer trial alongside the reduced build.
- [x] Locate editor-distro extraction and the full editor.main import graph.
- [x] Distinguish optional main-thread language adapters from separate workers.
- [x] Confirm CodeLens is disabled in WBA settings and hunk controls use view zones.
- [x] Confirm independent Monaco Quick Fix hover support and missing WBA bridge.
- [x] Confirm pinned experimentalGpuAcceleration on/off option and adapter probe.

## Slice 1 — feature reduction / experimental renderer

Deferred by user: keep evidence, no further bundle/GPU implementation in the
quick-fix workstream.

- [x] Measure current bootstrap and in-memory CodeLens/language variants; record
  raw/gzip numbers and current whole-host size in PLAN.md. No asset writes.
- [ ] Complete final-host input attribution and auxiliary asset inventory;
  verify actual reduced-host savings after approved source edits/build.
  - [x] Write-disabled whole-host baseline matches published host bytes exactly.
  - [x] Source-linking experiment saves 800,181 JS / 221,618 gzip JS bytes with
    all existing Monaco contributions retained; CodeLens removal is incremental.
  - [ ] Reconcile emitted CSS/font URLs/inventory and runtime singleton identity.
- [ ] Complete contribution/command/import inventory, including CodeLens consumers.
  - [x] Identify active edit/find/marker commands and language providers; retain
    inline completions and supported worker-mode features despite their size.
- [ ] Propose concrete allowlist and optional language-adapter strategy.
- [ ] Choose explicit experimental GPU activation/rollback mechanism.
  - [x] Identify canvas/configuration-service/device initialization seams and
    GPU core import even while disabled; do not assume automatic safe fallback.
  - [x] User chose the minimal direct trial instead of guards/preferences/query
    switches: set experimentalGpuAcceleration to on in m_editor_app.ts's main
    options wrapper. Revert the source change if unsuitable. No historical-view
    change, GPU removal, source-linking or native publication in this trial.
  - [x] Main-editor trial typecheck and normal host build pass. Generated host.js
    is ready for user-managed client publication; no live activation claimed.
  - [ ] User publishes/reloads client and evaluates actual GPU rendering and
    visual/interaction behavior before deciding whether to retain or remove it.
    - Trial activated on live Electron/Cefrium: both report GPU on and a model
      with 949 lines/31,689 characters, but text rendering fails in the GPU
      decoration CSS scanner on a cross-origin Google Fonts stylesheet.
      Electron also logged an earlier unavailable-WebGPU-adapter rejection;
      this is separate from the stylesheet failure.
    - User approved isolated Cefrium-page test: removed only the Google Fonts
      stylesheet link and requested editor rendering. GPU context/device are
      present afterward; visible-text/performance acceptance awaits user.
      No permanent stylesheet/source change or client reload; reload restores
      the removed link. Inspect existing device state, not navigator.gpu alone.
    - User reported partial/missing rendering after that test and requested
      reverting the editor source. GPU-on override reverted; typecheck and host
      build passed. User-managed asset publication/reload remains separate.
  - [x] Put GPU on removal-candidate list: about 64 KB attributed minified code;
    size-only non-runtime stub experiment saves 64,644 raw / 16,948 gzip bytes.
    Full methodology/caveats in PLAN.md; no GPU stubs/code removal shipped.
- [ ] Obtain implementation/build/publication approval for the concrete scope.
- [ ] Implement and validate reduced build; preserve Code Server and worker modes.
- [ ] Compare baseline DOM → reduced DOM → reduced GPU; report actual renderer.
- [ ] Exact-client desktop/mobile/browser acceptance after approved publication.

## Slice 2 — extension-host quick fixes

- [x] User approved read-only investigation of quick fixes and dead hover links.
- [x] Preserve existing Markdown trust projection; identify missing Monaco→WBA
  command registration and manifest-only command-execution admission.
- [x] Trigger approved Cefrium hover at line 85, column 8; capture the actual
  rust-analyzer.hoverRefCommandProxy link without clicking/executing it.
- [x] Implement/validate hover command routing as the first command foundation.
- [x] Capture and support the actual navigation callback; no guessed generic
  workbench-command execution or success for unsupported methods.
  - Installed Rust extension source confirms hoverRefCommandProxy executes its
    cached command, and its showReferences helper calls editor.action.showReferences.
  - A private te2.extensionHoverCommand gateway wraps only trusted/allowlisted
    hover links and retains their decoded arguments and document/version/WBA
    generation. Old links expire on new projections, resets/disconnect and exit.
    Existing Monaco commands are not globally replaced.
  - Runtime-only commands are admitted for the hover surface only if currently
    registered by ext-host. Existing manifest-based menu handling remains.
    Extension command error replies now propagate instead of appearing successful.
  - showReferences validates source/locations and uses the existing exact-client
    editorOperation/ack lane. Code Inspector renders supplied locations without
    querying providers again; canonical result selection/open behavior is retained.
  - 71 targeted tests passed; app typecheck and host/WBA build passed. WBA-wide
    strict check has 106 existing diagnostics: TypeScript compiler-host comparison
    against HEAD reports 106 before/after and no newly added diagnostics.
  - Source diff whitespace check passes. Full generated-host diff check reports
    minified-line whitespace; no manual edits of generated host output were made.
- [x] User activated the update and confirmed hover navigation working live after
  the adapter-hook fix (2026-10-15). This accepts the hover-command foundation,
  not the unimplemented Quick Fix provider slice.
  - User live attempt reached the new gateway but failed Unknown extension
    command: rust-analyzer.hoverRefCommandProxy. Current WBA shell
    frs_1792081012630_1643656_2_2 started after rebuilt command-runtime output;
    stale-process assumptions did not explain this attempt.
  - Source cause: WorkbenchClient supplies handleCommandRequest, but
    createExtHostDispatchRuntime neither declared nor forwarded it. The dispatcher
    acknowledged command registrations without invoking the owner. The same lost
    hook also affected navigation callbacks. Prior direct-owner tests missed it.
  - Added the required typed callback and forwarding, plus regression through
    WorkbenchClient._extHostDispatchRuntime and handleExtHostRequest covering
    register → hover execute → showReferences callback → unregister. Focused
    follow-up suite: 24 passed; app typecheck and host/WBA build passed.
  - This follow-up only changes WBA runtime code: current new client assets can
    remain. A new WBA process is required; no automatic restart was performed.
  - Final pre-commit targeted regression run passes all 72 tests, including the
    real dispatch-adapter regression. User live acceptance is recorded above.
- [x] Quick Fix provider lifecycle/edit subset implemented in its separately
  approved follow-up below, not by the earlier hover-command foundation.

### Minimal diagnostic Quick Fix follow-up

- [x] Draft review live accepted and committed/pushed as 2a392d77 before return
  to this work. User approved editor/WBA TypeScript implementation/tests/build only.
- [x] Provider registration/selectors/snapshot/resync and RPC-ID-scoped retirement;
  bounded owner/document/version result receipts and provide/resolve/release.
- [x] Existing Monaco diagnostic-hover/action UI integration; only quickfix kinds,
  no refactors or normal-hover text blocking dependency.
- [x] Guarded single-use current-document text edits with undo stops, or existing
  admitted extension commands. Whole unsupported actions reject, never fragments.
- [x] Version/model-instance/disconnect/reset/disposal fences and late-result
  release; executing commands retain cache-backed arguments until completion.
- [x] Source-based WBA type-check comparison: 104 baseline/current diagnostics,
  zero new diagnostics (existing whole-WBA strict debt is not claimed fixed).
- [x] 56 focused regressions pass, including the actual Workbench factory/server
  dispatch lifecycle, hover/navigation/identity regressions and Quick Fix tests.
  App typecheck and normal host/WBA build pass; source whitespace check passes.
- [x] User-managed activation and live diagnostic Quick Fix acceptance confirmed
  explicitly before commit/push 2e77c843; not an exhaustive provider/device matrix.

Limits: plain current-file edits or command-only fixes; no mixed edit+command,
multi-file/resource/notebook/snippet/EOL operations, untyped actions or refactors.
No Python/mypyc/native build is needed for this slice. No runtime transitions or
client publication were performed by the agent.

### Context-command compatibility follow-up

- [x] User reported repeated Unsupported workbench command: _setContext plus
  unhandled promise rejections after enabling the real command dispatch hook.
- [x] Verify pinned VS Code source: extHostApiCommands translates public
  setContext to _setContext, registered by contextKeyService.ts. This was a
  command compatibility gap, not a TypeScript runtime/type failure.
- [x] User approved a narrow alias fix: both names reach the existing context
  store, without broad command passthrough or changed value policy.
- [x] Add real Workbench dispatch regression covering _setContext true/false/
  undefined, public alias compatibility and reset. All 24 focused command/hover/
  navigation tests, app typecheck and normal host/WBA build pass. Host output is
  unchanged; only the WBA command-runtime module needs runtime replacement.
- [ ] Restart WBA and verify the _setContext rejection spam stops live. No
  runtime restart or client publication was performed by the agent.

- [x] Audit, approve and implement the minimal safe Quick Fix subset above.
- [x] Focused tests cover cancellation/cache/version/client/disconnect and undo.
- [x] Normal hover has no Quick Fix response dependency; extra timing benchmarks
  are deferred, not an unimplemented feature.
- [x] Build and user live acceptance recorded above; committed/pushed 2e77c843.

Refactors, broad workspace edits, upstream fork changes and release-default GPU
activation are not implied. Initial planning was read-only; subsequent source,
build and user activation evidence is recorded above. Existing unrelated working
tree changes are preserved.
