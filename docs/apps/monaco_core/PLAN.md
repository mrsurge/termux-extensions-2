# Monaco core reduction and extension-host quick fixes

## Scope and sequencing

User requested two slices: audit/reduce the Monaco browser graph, including an
experimental GPU-renderer trial, then connect extension-host quick fixes to
Monaco's existing diagnostic hover. Refactors are explicitly deferred.
This document records direction, not permission to rebuild/publish clients,
modify a source fork, or restart the shared framework. Approve concrete edits
after the remaining measurements and ownership checks.

## Source-backed baseline

- `worktrees/vscode-te2-diff/build/gulpfile.editor.js` defines `editor-distro`:
  extract standalone editor sources with `shakeLevel: 2` (class members), compile
  ESM and publish core resources. This excludes the full VS Code workbench but
  uses `editor.main.ts` as an extraction root: it is not a TE2 feature allowlist.
- `scripts/build_monaco_bootstrap_bundle.mjs` imports vendored `editor.main.js`,
  which imports `editor.all.js` and standalone contributions. Registration side
  effects retain features even when runtime options disable them. Final
  `app/apps/code_te2/build.mjs` minifies the host graph; bootstrap intermediate
  and host sizes are not additive transfer costs.
- Bootstrap dynamic imports defer language-contribution initialization, but the
  bootstrap build has no code splitting. They are not independently fetched
  chunks in that bundle. Quantify each contribution before claiming savings.
- `scripts/build_monaco_language_workers.mjs` separately builds actual TS/JSON/
  CSS/HTML workers and contribution modules. `editor_monaco_boot_runtime.ts`
  chooses worker URLs by label; language workers are guarded by the existing
  `webWorkersEnabled` mode. The core editor worker is a different dependency.
- WBA's provider registry lacks CodeLens and code-action handlers, although its
  request-argument parsing recognizes their registration messages.
  `extension_registry.py` sets `editor.codeLens: False`. Historical views also
  disable CodeLens. TE2 hunk/change controls in
  `vscode_chat_editing_vendor/chatEditingHunkRenderer.ts` use view zones, not
  CodeLens; preserve these controls independently.
- Monaco's `markerHoverParticipant.js` already invokes code actions filtered by
  `CodeActionKind.QuickFix`. CodeLens is a separate contribution and is not
  required to provide code actions.
- Pinned `editorOptions.js` supports `experimentalGpuAcceleration: 'on'` (default
  off). GPU device creation uses `navigator.gpu.requestAdapter()`; setting the
  option does not prove the GPU renderer is available or active in a client.

## Slice 1 — conservative feature graph and GPU experiment

Deferred by user after the GPU trial. Retain measurements and candidate list;
do not implement source-linking, feature removal or further GPU changes while
working on the quick-fix/hover-command slice below.

### Initial write-disabled measurements (2026-10-15)

Measured the current bootstrap recipe with esbuild `write:false`, `metafile:true`,
`minify:true`, `sourcemap:false`; no published asset was replaced. Source input
was the existing prebuilt `te2-lang` contribution fallback because the configured
mobile-playground source directory is absent. Temporary variants changed only
in-memory resolution/loading. Gzip uses Node zlib defaults. These are isolated
bootstrap comparisons, not promises of identical final-host savings.

| Variant | Minified JS bytes | Gzip bytes | Delta raw / gzip versus baseline |
| --- | ---: | ---: | ---: |
| Baseline | 4,238,738 | 1,104,265 | — |
| Exclude CodeLens contribution | 4,221,828 | 1,099,793 | 16,910 / 4,472 |
| Exclude rich TS/JSON/CSS/HTML adapters | 4,155,814 | 1,082,357 | 82,924 / 21,908 |
| Exclude basic-language contributions | 3,812,524 | 997,527 | 426,214 / 106,738 |
| Exclude all language contributions | 3,711,245 | 964,601 | 527,493 / 139,664 |

Existing published local `host.js` independently measures 6,819,213 bytes and
1,845,052 gzip bytes. The baseline above is not that whole host. Variant deltas
are non-additive because shared dependencies/minification/compression change.

CodeLens removal eliminates five graph inputs and is the smallest concrete first
edit candidate; no active app CodeLens provider/controller use was found. Core
code-action contributions remain in that graph. Do not treat all language bytes
as unused: basic languages serve historical syntax and adapters serve the optional
worker mode. Plan any isolation with native route/inventory checks, not a blind
deletion of their dynamic imports.

GPU source inspection: `view.js` imports GPU rendering even with the option off;
removing `gpuActions` alone would not remove that implementation. `ViewGpuContext`
obtains a webgpu canvas and reads `configurationService.getValue('editor')`
during setup, then requests the device asynchronously. Its failure prompt offers
a configuration-service-based DOM switch. Verify standalone configuration values,
canvas/device availability, rejected-device behavior and actual fallback before
enabling this option. The option alone is not a safe universal toggle.

### Whole-host source-linking experiment and used-feature pass

The next write-disabled pass rebuilt the actual host graph in memory, preserving
the existing verified SCM tree builder and its integrity checks. Run from the
Code TE2 app directory: esbuild service working directory affects nested tree
metafile paths. No generated browser assets were written or activated; the tree
builder used and removed its normal temporary patch workspace.

| Whole-host variant | JS bytes | Gzip JS bytes |
| --- | ---: | ---: |
| Current recipe (matches existing host exactly) | 6,819,213 | 1,845,052 |
| Resolve bootstrap entry to source in final host build | 6,019,032 | 1,623,434 |
| Same, without CodeLens contribution | 6,001,953 | 1,618,413 |

Source-linking replaces only the prebuilt bootstrap input with its authored
entry contents and the existing bootstrap resolver aliases in memory, keeping
editor.main and all language contributions. It removes 800,181 JS bytes and
221,618 gzip JS bytes without intentionally removing features. The current host
contains 4,319,152 output bytes attributed to the opaque bootstrap plus 735,717
bytes attributed to directly imported Monaco ESM. Source linking allows shared
code elimination/deduplication and whole-graph optimization; do not attribute
every saved byte to exact duplication alone.

Source-linked outputs also include host.css (172,077 bytes, or 170,622 without
CodeLens) and codicon-LN6W7LCM.ttf (121,972 bytes). These are not total transfer
savings: reconcile current CSS/font assets, emitted URLs, native interception,
OTA inventory and stylesheet publication before claiming deployment readiness.
Verify changed service/registry identity after unifying the graph, especially
themes, marker services, URI handling and shared context keys. Build success is
not behavior equivalence. Preserve historical Monaco entry imports as well.

Used-feature evidence: editor_command_utils.ts directly needs undo/redo,
clipboard/select-all, marker navigation and find/replace. The language bridge
actively registers completions, inline completions, colors, inlay hints, semantic
tokens, hover, symbols, folding, highlights and definition/reference/
implementation providers. Historical rendering, touch selection and TE2's hunk
view zones are additional retained consumers. Large inline-completion machinery
is therefore not simply unused. Keyboard/context-menu/Quick Access commands and
web-worker mode count as consumers even without direct toolbar calls.

Revised implementation priority: first source-link the common graph while
preserving behavior and fixing CSS/font publication, then establish the explicit
contribution entry and remove CodeLens; consider additional unsupported provider
features only after accounting for the optional worker mode. Keep the separate
GPU experiment and quick-fix slice gates. No implementation/publication has been
performed by these experiments.

### Implementation steps

### GPU trial outcome and removal candidate

User observed partial/missing text even after the isolated stylesheet removal;
the trial did not establish usable rendering or a performance benefit. At user
request, reverted the main-editor GPU-on override and rebuilt the normal host;
strict typecheck/build passed. Native clients still need the user's normal asset
update/reload to consume the reverted bundle. No runtime reload was performed.

GPU-specific minified output attribution in the isolated bootstrap:
48,153 bytes under editor/browser/gpu, 13,881 in GPU view parts, and 2,152 in GPU
actions (64,186 total). An in-memory size-only experiment replacing the four GPU
entry classes with empty exports and suppressing gpuActions reduced bootstrap
JS from 4,238,738 to 4,174,094 bytes and gzip from 1,104,265 to 1,087,317 bytes:
64,644 raw / 16,948 gzip bytes. This is not an executable GPU-free build, and
does not prove the same final-host saving after source linking or account for
separate CSS/assets. No stubs were written or shipped.

GPU rendering is now a removal candidate: audit view.js's ViewGpuContext,
ViewLinesGpu, RulersGpu and GpuMarkOverlay branches and the GPU actions, preserving
DOM rendering, ordinary editor acceleration/compositing, diff layout and core
worker behavior. Removing only the option or gpuActions import is insufficient.
Source-fork/extraction versus a TE2 build adaptation remains an implementation
decision requiring approval; no GPU implementation code has been removed yet.

1. Obtain a reproducible input/output contribution report for current bootstrap
   and final host (raw and gzip). Inventory direct editor imports outside the
   bootstrap and CSS/fonts/workers too. Use in-memory/write-disabled analysis
   for initial sizing where possible; normal builds/publication require approval.
2. Inventory active editor commands, contributions and settings against TE2 UI,
   tests and supported modes. CodeLens is the first removal candidate. Audit
   rename, format, GPU actions, inspection, drop/paste and language adapters;
   do not remove features solely because no visible toolbar exposes them.
3. Prefer a TE2-owned explicit `editor.api` plus contribution allowlist rather
   than editing generated output or immediately changing upstream extraction.
   Verify transitive dependencies: switching entrypoints alone does not make
   core services or GPU rendering code disappear.
4. Keep hover/code actions, diff/editor worker, suggestions, snippets, TextMate,
   diagnostics, selection/touch/IME, quick access, accessibility and existing
   review/hunk controls. Preserve the exclusive Code Server/web-worker modes.
   Evaluate isolating optional language adapters rather than silently deleting
   the user-selectable worker feature. Historical basic-language tokenization
   and native asset interception are explicit gates for any split.
5. Add an experimental opt-in path using `experimentalGpuAcceleration: 'on'`.
   Decide the existing preference/debug entrypoint before edits; no automatic
   release-wide default change. Record requested versus actual renderer,
   adapter/device failure and fallback behavior. No forced insecure GPU flags.
   Trial decision: user explicitly chose a simple unconditional on value in the
   main m_editor_app.ts options wrapper, with source revert if it fails, rather
   than an opt-in UI, capability guard or query-string switch. Typecheck/build
   passed; user owns client bundle update. This supersedes the opt-in proposal
   for this temporary test, not a permanent cross-client default decision.
6. Compare current DOM, reduced DOM and reduced GPU configurations so regressions
   can be attributed. Check startup/scrolling, memory, word wrap, inline diff
   gutters/decorations, themes/TextMate, ligatures, selection/IME and resize.
   Electron, Cefrium/TE2 Termux, Gecko and plain-HTTP generic browsers differ:
   unavailable WebGPU must not break the normal editor.

Gates: approved edit scope; strict TypeScript/tests; required bootstrap→host
build order; before/after size evidence; matched native asset publication when
approved; exact-client live acceptance. Do not promise a byte saving before
measurement or interpret a successful GPU-option assignment as GPU activation.

## Slice 2 — extension-host quick fixes, not refactors

### Companion gap: dead navigation command links in hovers

Live Cefrium inspection at line 85, column 8 of framework_services/search_ops.rs
captured `6 implementations` with target
`command:rust-analyzer.hoverRefCommandProxy?0`. The user authorized triggering
the hover, not executing its link. No navigation command was executed.

editor_bridge_utils.ts already retains Markdown isTrusted/enabledCommands and
URI metadata. Monaco's existing command opener checks that trust policy, decodes
arguments and invokes its command service. TE2 has no equivalent registration
forwarding extension hover commands into WBA. ExtensionCommandRuntime.execute
also requires manifest command metadata even though its registeredCommands set
tracks runtime-only extension commands; hover proxies can use that latter class.
Do not equate visible link text with an executed command or assume that the
eventual built-in navigation callback is already implemented.

Implement in two substeps:

- First bridge trusted hover command links through the existing exact-client
  WBA/editor context and command owner. Admit live runtime-registered commands
  without requiring a menu contribution; retain lifecycle/session fences and
  existing manifest-based menu behavior. Respect per-Markdown trust, validate
  arguments, revive supported URI/range DTOs, and never blanket-enable commands
  in untrusted Markdown. Projects are intentionally trusted/experimental; do not
  introduce a new unrelated project-trust UX.
- Capture the proxy's actual workbench navigation callback with an isolated
  fixture or approved live execution. Route supported definition/reference/
  implementation location intents through existing navigation/open owners,
  preserving exact client, project handling and active-document context.
  Unknown callbacks must fail visibly, not silently succeed or run arbitrary
  browser commands. Do not replay links after WBA restart; proxy cache arguments
  can become stale.
- Then implement Quick Fix provider lifecycle and the supported edit subset
  below, sharing command execution where applicable. Hover command links and
  code actions are separate discovery paths, not a single provider type.

Concrete proposed edit scope: editor/WBA TypeScript command/provider/protocol
modules and focused tests, with app typecheck and normal host/WBA build. No
Python/mypyc/native binary, Android/Electron source, framework restart, client
publication, Monaco fork change or refactor support is implied. Obtain final
implementation approval before code changes.

Hover foundation is now source-implemented after approval. The bridge uses one
private Monaco command and ephemeral per-hover tokens rather than registering
extension IDs over existing Monaco commands. It rewrites trusted/allowlisted
command links only; arguments remain on the bounded frontend record, associated
with document version and WBA generation. Clicks use the existing WBA command
executor and editor selection facade. The extension's actual showReferences
callback becomes an acknowledged exact-client editor operation and a Code
Inspector location projection, with no second provider lookup. Known handling
is intentionally limited to that callback; unsupported workbench commands fail
explicitly. App/source tests do not establish live Rust acceptance. Client asset
update/reload and WBA restart are required, not Python/mypyc or Rust compilation.

1. Follow existing direct WBA intelligence lanes and exact-client logical
   document ownership. Add typed provider registration/resync/unregistration,
   provide/resolve/release operations and Monaco CodeActionProvider projection.
   Do not revive the commented vendor bridge as an independent implementation.
2. Request/filter `quickfix` and child kinds, excluding refactor/source actions.
   Reuse Monaco's marker-hover Quick Fix affordance and action UI, not a second
   custom menu. Handle providers without kind metadata conservatively and
   validate returned actions; no command execution during discovery/hover.
3. Track provider handles, result/cache lifetimes, cancellation, document version,
   client identity and WBA generation. Dispose/release on supersession, model
   change, disconnect and provider retirement; never apply a stale result.
4. Audit the existing edit/command owners before defining the first supported
   action subset. Text edits must preserve draft/undo and authoritative open
   state. Command-backed fixes require the existing validated extension command
   route and editor context. Never write files directly from hover code.
5. Explicitly reject unsupported multi-file/resource/create/delete/rename edits
   until an appropriate atomic/version-guarded owner exists. Advertise only
   safely executable actions; do not silently apply a supported fragment or
   retry uncertain mutations. Refactoring UX/preview and general workspace-edit
   support remain later work even when a quick fix carries such an edit.

Gates: provider protocol fixtures; diagnostic-range and kind filtering;
provide/resolve/release lifecycle tests; stale/disconnect/version guards;
single-file edit undo and command tests; strict checks/build; approved live
acceptance with representative extensions. Preserve ordinary hover latency:
quick-fix discovery must not block the existing hover text.
