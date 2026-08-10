# Framework Cleanup And UI VSIX Tracker

Last updated: 2026-08-09

## Program status

| Phase | Status | Approval boundary |
|---|---|---|
| Phase 0: documentation and inventory | Complete | Planning documents plus the required repo-memory pointer only |
| Phase 1: generic WBA hover fidelity | Complete; live language comparisons passed | Approved and validated, including generic fenced-language tokenizer preload |
| Phase 2: interface-scoped framework exposure | Complete; Linux and Termux acceptance passed | Implementation and live-runtime restart approved and validated |
| Phase 3A: shared paths and rebuildable caches | Complete; Linux restart and Termux no-XDG fallback passed | Implemented and live-validated |
| Phase 3B: framework durable stores | Complete; live framework-store acceptance passed | Implemented and live-validated |
| Phase 3C: Code TE2 durable state | Complete; live app/WBA restart acceptance passed | Implemented and live-validated |
| Phase 3D: app/client paths and opt-in legacy migration/cleanup | Implemented and fixture-validated; real apply pending separate approval | Tool implementation and every real apply are separate approval boundaries |
| Phase 4A: internal/package naming | Complete; package, build, isolated launch, and Electron validation passed | Hard-cutover implementation approved and validated; shared framework was not restarted |
| Phase 4B: public app identifiers | Implemented and full-suite/package validated; live cutover pending | Approved hard cutover; shared runtime restart and live client acceptance remain separate |
| Phase 5: first UI VSIX activity-bar webview | Live OpenAI UI reached; gray visual overlay and Electron detach/attach acceptance pending | Approved subset only; no Android changes, custom editors, panels, secondary Sidebar, commands, or per-client provider instances |

## Source findings tracker

| Finding | Evidence | Status |
|---|---|---|
| Narrow `--broadcast` selectors do nothing | Bootstrap retains selectors but `_resolve_listen_host()` handles only `all` | Confirmed |
| `--list-interfaces` was lost in the Rust launcher | Present in retired CLI/server; absent from current `te2 --help` | Confirmed |
| Old network mode was not safe to copy | Invalid selectors could coexist with wildcard bind; named interfaces skipped filtering | Confirmed |
| Internal origin is coupled to listener host | Bootstrap derives `TE_FRAMEWORK_URL` directly from resolved listen host | Confirmed |
| Hover language/value code path is unreachable | Generic `value` branch precedes the `language + value` branch | Confirmed |
| WBA hover dispatch itself is generic and multi-provider | WBA finds all selector-matched hover handles and merges ordered contents | Confirmed |
| Code TE2 drafts live in a cache-labeled root | `project_sidecar.py` uses `~/.cache/cm6_editor/projects` | Confirmed; high migration risk |
| `cm6_sessions` helpers appear dead | Path was created; private read/write/delete helpers had no callers | Resolved in 3C; helpers and eager directory creation removed |
| `rust-spike` names were active product names | Source root, package data, crate, CLI, cache id, env variables, and logs used them | Resolved in 4A; active framework source/package/runtime names are canonical |
| Electron used an experimental source-directory name | Active client lived at `desktop_client/electron_spike` | Resolved in 4A; active source is `desktop_client/electron` |
| UI extension support is intentionally absent | Explorer marketplace displays the unsupported notice | Confirmed |
| Sidebar presentation foundation is reusable | Run Profile presentation and exact-client routing phases are implemented | Confirmed |
| Installed WBA used a source-only matcher dependency | Generated provider registry imported `picomatch`, while package rules prune `node_modules` | Resolved; matcher is packaged under Code TE2's vendor tree and exercised from an isolated wheel layout |
| ALS-RS Sidebar routing assumed framework port `8089` | ALS-RS owns HTTP port `12459`, but its outbound Sidebar client ignored injected framework identity and fell back to `8089` | Resolved; app workers receive explicit URL/port identity and ALS-RS reconnects and re-registers against that origin, including framework port `8081` |
| XDG variables are not consistently present | Existing Python, Rust, and TypeScript code already falls back to `$HOME`; Termux also provides `$PREFIX`/`$TMPDIR` for runtime state | Confirmed; canonical resolver must be platform-aware |
| Rust final-binary fingerprints were never pruned | Pre-3A bootstrap copied to `bin/<fingerprint>/<profile>` without a lock or cleanup path | Resolved in 3A; 10 historical release binaries used 206.6 MiB on the inspection host |
| Debug was the implicit framework build default | Pre-3A `--release` was a lone `store_true` flag and every Cargo path omitted `--release` otherwise | Resolved in 3A; release is default and `--debug` is explicit |
| Python `/api/jobs` survived only as an unmounted router | `app.libs.jobs.jobs_bp` has no current mount; archive/file-explorer workers still import the module and therefore initialize its persistence | Confirmed in 3B; persistence is canonical, but the retired framework route was not restored |

## Storage ownership inventory

Paths use XDG-default notation. A root being present on one workstation does not
prove current ownership; current source is the authority.

| Legacy/current root | Current source owner | Data class | Proposed destination/action | Risk/status |
|---|---|---|---|---|
| `$XDG_CACHE_HOME/te2` | Several current TE2 components | Canonical cache root | Keep; normalize named subtrees | Active |
| `$XDG_CACHE_HOME/te2-rust-spike` | No current writer after Phase 3A | Rebuildable cache | New builds use `te2/framework/build`; report old tree to the later opt-in cleanup tool | Cut over; old disk tree remains untouched |
| `$XDG_CACHE_HOME/termux_extensions` | No current reader after Phase 3B | Legacy settings/state/bookmarks/jobs data | Move recognized data only through the later opt-in command | Cut over; old disk tree remains untouched |
| `$HOME/.cache/cm6_editor` | No current reader after Phase 3C | Legacy editor recovery data | Move recognized sidecars only through the later opt-in command | Cut over; old disk tree remains untouched |
| `$HOME/.cache/cm6_sessions` | No current owner after Phase 3C | Empty obsolete session path | Report through the later cleanup tool; no runtime fallback | Dead helpers removed |
| `$XDG_DATA_HOME/termux-extensions-2` | No current Code TE2 reader after Phase 3C | Legacy history/preferences/icons/runtime | Move recognized data only through the later opt-in command | Cut over; old disk tree remains untouched |
| `$HOME/.cache/app_server` | No current console writer after Phase 3A | Bounded logs/generated console assets | Console runtime and CLI use `$TE2_CACHE_HOME/console`; no runtime fallback | Cut over; old disk tree remains untouched |
| `$XDG_CACHE_HOME/framework_shells` | No current bootstrap default after Phase 3A | Process/log/cache state | Bootstrap exports `$TE2_CACHE_HOME/framework_shells` to Framework-Shells | Cut over in source; live restart pending |
| `$HOME/.cache/aria_downloader` | No current writer after Phase 3D | App state | `$TE2_DATA_HOME/app_state/aria_downloader` through explicit migration | Cut over; old disk tree remains untouched |
| `$XDG_CONFIG_HOME/te2` | Electron settings/presentation | Canonical configuration | Keep; normalize desktop subtree if needed | Active canonical root |
| `$TE2_CONFIG_HOME/framework` | Rust framework settings | Canonical configuration | Keep as the exclusive settings destination | Active canonical root |
| `$TE2_DATA_HOME/framework` | Rust state/bookmarks and Python job records | Canonical durable data | Keep as the exclusive framework-store destination | Active canonical root |
| `$HOME/.config/code-server` | No current Code TE2 reader after Phase 3C | External/global code-server data | Leave untouched; any recognized import is explicit opt-in migration work | Code TE2 cut over to a private data root |
| `$XDG_DATA_HOME/te2` | Apps, managed code-server, Node runtime, desktop assets | Canonical durable root | Keep and organize | Active canonical root |
| `$XDG_CACHE_HOME/te2-android-install` | No current in-repo writer found | Build/install scratch | Report and delete only with explicit approval | Cleanup candidate |
| `$XDG_CACHE_HOME/dev.te2.desktop*` | No current Electron writer found | Old Electrobun/CEF cache | Report and delete only with explicit approval | Cleanup candidate |
| `$XDG_CACHE_HOME/te2_kotlin_lsp` | No current in-repo writer found | Unknown/external LSP state | Do not adopt or delete until producer is identified | Unowned/unknown |
| `$HOME/.cache/te_framework` | No current owner after Phase 3D | Old framework runtime state | Delete only through explicit migration apply | Retired helper scripts removed; old disk tree remains untouched |
| `$HOME/.cache/te` and fallback `.local/run/te` | No current owner after Phase 3D | Old session/runtime state | Delete only through explicit migration apply | Retired helper scripts removed; old disk trees remain untouched |

## Phase 1 checklist — WBA hover fidelity

- [x] Define typed input/output shapes for hover Markdown content.
- [x] Match language/value records before generic value records.
- [x] Preserve supported Markdown trust/HTML/theme/base-URI metadata safely.
- [x] Extract every fenced language from normalized Markdown.
- [x] Resolve language tags through Monaco's contributed IDs and aliases.
- [x] Await existing WBA TextMate tokenizers before returning the hover.
- [x] Reject canceled or document-version-stale results after grammar loading.
- [x] Keep provider aggregation order unchanged.
- [x] Add string-content test.
- [x] Add Markdown-value test.
- [x] Add language/value fenced-code test.
- [x] Add mixed multi-provider test.
- [x] Add malformed-content test.
- [x] Add contributed-language-alias test.
- [x] Add hover/tokenizer ordering test.
- [x] Run Code TE2 typecheck.
- [x] Build `static/dist/host.js`.
- [x] Run focused and complete frontend tests.
- [x] Live-validate JavaScript hover coloring.
- [x] Live-validate HTML hover coloring.
- [x] Live-validate CSS hover coloring.
- [x] Live-validate one comparison language.
- [x] Update current Code TE2 docs and repo memory with the verified contract.

## Phase 2 checklist — network interface exposure

- [x] Define typed listener/internal-origin/exposure-policy configuration.
- [x] Restore `--list-interfaces`.
- [x] Resolve `all`.
- [x] Resolve exact IPv4 and IPv6 selectors.
- [x] Resolve IPv4 and IPv6 CIDR selectors.
- [x] Resolve interface-name selectors through Linux/Android `getifaddrs`.
- [x] Reject invalid or empty selectors before binding.
- [x] Preserve loopback-only default.
- [x] Keep internal framework URL on a usable loopback origin.
- [x] Enforce policy on ordinary HTTP.
- [x] Enforce policy on SSE.
- [x] Enforce policy on raw WebSocket upgrades.
- [x] Enforce policy on Socket.IO upgrades.
- [x] Add parser, resolver, and allowlist unit tests.
- [x] Add allowed/blocked real-socket integration tests.
- [x] Update CLI help and README examples.
- [x] Obtain explicit approval before restarting the shared framework for live validation.
- [x] Run `te2 --list-interfaces` in a live Termux environment.
- [x] Restart the active framework with the rebuilt binary and validate its normal runtime surfaces.

## Phase 3 checklist — canonical roots and explicit migration

Target architecture decisions:

- ordinary framework/app/client startup uses canonical paths exclusively and
  never probes, reads, aliases, or automatically migrates a legacy root;
- `TE2_CACHE_HOME`, `TE2_DATA_HOME`, `TE2_CONFIG_HOME`, and
  `TE2_RUNTIME_HOME` are explicit final-root overrides;
- absent explicit overrides, XDG bases are used when present; `$HOME` supplies
  cache/data/config fallbacks and a protected `$TMPDIR`/Termux `$PREFIX/tmp`
  subtree supplies runtime state;
- native Android clients continue using application-private Android storage;
- legacy movement exists only in a standalone `te2 migrate-legacy-roots`
  command that is dry-run by default and mutates only with `--apply`;
- allowlisted legacy source files are authoritative during apply and
  destructively replace matching canonical files; destination-only directory
  entries remain in place;
- release is the default framework build profile; `--debug` is opt-in; and
- the Cargo incremental target is retained, but only the selected validated
  final launch binary survives fingerprint-cache pruning.

### 3A: helpers and rebuildable caches

- [x] Implement one canonical root resolver and propagate resolved paths to the Rust server and app workers.
- [x] Implement matching standalone Electron resolution.
- [x] Add TE2 override, XDG, no-XDG `$HOME`, Termux `$PREFIX`/`$TMPDIR`, and invalid-relative-path tests.
- [x] Prove Phase 3A cache consumers never probe a legacy cache root.
- [x] Move framework build cache writes.
- [x] Move TE2 console cache/log writes.
- [x] Coordinate the Framework-Shells canonical-root cutover.
- [x] Normalize code-server download/probe cache.
- [x] Normalize desktop build cache.
- [x] Make release the default for cached, uncached, and build-only commands.
- [x] Add explicit `--debug` and mutually exclusive profile parsing.
- [x] Add a cross-process build/publication lock.
- [x] Publish the selected final binary atomically and validate it before pruning.
- [x] Prune every non-selected fingerprinted final binary without deleting the Cargo incremental target.
- [x] Prove no new rebuildable cache uses a TE2-adjacent top-level root.
- [x] Live-validate a canonical-root framework restart on Linux.
- [x] Live-validate the fallback contract in Termux without XDG variables.

### 3B: framework durable stores

- [x] Inventory settings/state/bookmarks/jobs schemas and writers.
- [x] Cut settings directly to the canonical framework config root.
- [x] Cut generic state, bookmarks, and jobs directly to canonical data roots.
- [x] Add canonical-store schema and persistence tests without legacy fixtures.
- [x] Serialize state read/modify/write transactions and publish JSON through unique same-directory temporary files.
- [x] Confirm ordinary source no longer reads or writes `termux_extensions`.
- [x] Live-verify framework settings/state/bookmark APIs against canonical data after an approved framework restart.

### 3C: Code TE2 durable state

- [x] Freeze a fixture containing real draft/project sidecar shapes.
- [x] Cut project sidecars and draft indexes directly to canonical data paths.
- [x] Cut history, preferences, icons, and runtime socket directly to canonical roots.
- [x] Prove `cm6_sessions` helpers have no callers and remove them.
- [x] Give managed code-server a private TE2-owned user-data/extensions root.
- [x] Validate path resolution, draft/index reload recovery, history/preferences persistence, extension commands, and WBA path handoff with automated tests.
- [x] Live-validate recent projects/files, settings, installed extensions, WBA launch, and restart recovery after an approved app/framework restart.

### 3D: apps, clients, and cleanup

- [x] Move TE2-owned app state under `$TE2_DATA_HOME/app_state/<app_id>`, separate from installable app source.
- [x] Implement `te2 migrate-legacy-roots` as a standalone dry-run-first command.
- [x] Require `--apply`, an inactive framework, a migration lock, schema validation, free-space preflight, and a one-time receipt.
- [x] Make allowlisted legacy files source-authoritative over matching canonical files while preserving destination-only tree entries.
- [x] Test old-only/new-only/identical/source-overwrite/interrupted/already-receipted/active-writer cases plus permissions and symlink refusal.
- [x] Inventory old desktop/Electrobun/CEF cache roots.
- [x] Inventory Android install scratch roots.
- [x] Classify `te2_kotlin_lsp` as unowned/unknown and report-only until its producer is proven.
- [x] Produce a write-free dry-run legacy-root cleanup report.
- [ ] Obtain explicit approval before deleting workstation files.
- [ ] Remove only verified-empty or explicitly approved stale roots.

## Phase 4 checklist — naming cleanup

### 4A: supported internal names

- [x] Finalize target `framework/` source layout.
- [x] Rename the former experimental package-data and bootstrap discovery paths.
- [x] Rename crate/package to `te2-server`.
- [x] Rename bootstrap app/prog/log/cache identifiers.
- [x] Introduce canonical `TE2_*` env names.
- [x] Apply and document a hard environment cutover with no legacy read aliases.
- [x] Rename the active desktop source directory to `desktop_client/electron`.
- [x] Update build/package scripts and active docs.
- [x] Validate editable install, wheel/sdist install, cached build, isolated launch, and Electron package.
- [x] Retain `te2-rust` unchanged and defer its retirement to a separate compatibility decision.

### 4B: public identifiers

- [x] Inventory every `file_editor_cm6` manifest, route, asset, client, and persisted-state dependency.
- [x] Separate real CodeMirror 6 component names from obsolete product names.
- [x] Approve `code_te2` as the canonical source, package, app, and runtime identity.
- [x] Define the cutover as staged canonicalization rather than a global rename.
- [x] Decouple built-in backend package loading from public app id.
- [x] Export and consume Code TE2's explicit `TE2_APP_ROUTER` contract.
- [x] Move the source package to `app/apps/code_te2` while retaining the old public id temporarily.
- [x] Update Python imports, package metadata, build scripts, source consumers, tests, and current docs.
- [x] Add the exact `file_editor_cm6 -> code_te2` canonical public-id alias without a second catalog/worker/FWS identity.
- [x] Cut Rust lifecycle/proxy/state, Socket.IO, frontend, Run Profile, Android, Electron, Terminal, Service Worker, and asset-inventory contracts to `code_te2`.
- [ ] Stop old Code TE2 workers and Run Profile shells at the public-id cutover boundary.
- [x] Migrate the exact framework state key, Android saved URL/session state, layout key, and any exact Sidebar slot/restore URL.
- [x] Rename product-level `cm6:*`, `window.__cm6*`, `FILE_EDITOR_CM6_*`, layout, project-path, and current documentation names.
- [x] Remove the unused `explorer.cm6.mirror` contract.
- [x] Preserve legitimate `cm6-json-*` and CodeMirror vendor/component names.
- [x] Rebuild generated Code TE2/WBA output from renamed source.
- [x] Keep Android inventory/APK and Electron package changes inside the explicitly approved Phase 4B publication boundary.
- [x] Keep replacements scoped; preserve the explicitly categorized public-id migrations and real CodeMirror 6 names.

## Phase 5 checklist — first UI VSIX activity-bar webview

- [x] Package WBA production dependencies independently of source `node_modules`.
- [x] Validate the generated WBA provider registry from an isolated installed-wheel layout.
- [x] Preserve explicit framework URL/port identity through the app-worker launch boundary.
- [x] Re-establish the exact ALS-RS Sidebar peer after non-default-port startup and transport reconnect.
- [x] Re-investigate contribution points against Code Server 4.130 and the installed OpenAI extension.
- [x] Select activity-bar `type: webview` views as the smallest first contribution subset.
- [x] Preserve the existing extension registry and `.vscode/settings.json` as project/configuration authority.
- [x] Implement the four current Code OSS webview RPC actors and exact mixed-argument framing.
- [x] Define and implement complete WBA-to-backend registration/disposal snapshots.
- [x] Define and implement sandbox, CSP, bounded realpath resource access, and strict MessagePack messaging.
- [x] Map logical webview surfaces onto browser/Gecko inline and Electron's existing detachable presentation.
- [x] Define workspace switch, provider unregister, resolve failure, WBA reset, and stale-snapshot teardown.
- [x] Select `openai.chatgpt_26.5803.41515.vsix` and `chatgpt.sidebarView` as the first acceptance fixture.
- [x] Live-prove resource loading, origin-validating bidirectional messaging, opaque-sandbox storage, and OpenAI application readiness.
- [x] Refine the implementation plan and tracker with the source-backed architecture.
- [ ] Live-accept the primary OpenAI view in the inline Sidebar.
- [ ] Live-accept Electron detach, attach, message continuity, and close behavior.
- [ ] Keep the marketplace unsupported notice until live acceptance passes.

Deferred from the first slice:

- custom editors and ordinary webview panels;
- secondary-Sidebar contribution projection;
- commands, menus, view welcome content, and chat-session APIs; and
- independent extension-host webview provider instances for simultaneous clients.

## Deferred decisions

| Decision | Why deferred |
|---|---|
| Retire `te2-rust` CLI alias | Installed-user compatibility must be measured after package rename |
| Delete `te2_kotlin_lsp` | Current repository does not prove ownership |
| Per-client UI VSIX provider instances | The current extension host is workspace-scoped and shared; independent simultaneous instances need a separate lifecycle design |

## Validation record

Record commands, results, live acceptance, and any approved deviations here as
each phase executes. Do not mark a phase complete from implementation alone.

| Date | Phase | Validation | Result |
|---|---|---|---|
| 2026-08-07 | 0 | Read-only CLI/source/path/hover/UI-foundation investigation | Passed; plan and tracker created |
| 2026-08-08 | 1 | Focused hover/alias/provider-order tests; TypeScript; full frontend suite; host build | Passed; 169 tests, 0 failures |
| 2026-08-08 | 1 | Server-served JavaScript hover before/after tokenizer and rendered-DOM probe | Passed; TypeScript fence advanced from empty tokens to TextMate scopes and multiple themed `mtk` classes |
| 2026-08-08 | 2 | Bootstrap parser/resolver/native interface tests; full Rust suite; Rust formatting/check; Python static analysis | Passed; 14 bootstrap tests, 59 Rust tests, 4 ignored benchmarks, 0 failures; basedpyright 0 errors |
| 2026-08-08 | 2 | Isolated dual-stack server with Tailscale interface destination policy | Passed; loopback and selected interface accepted HTTP/SSE/WebSocket/Socket.IO, unselected interface rejected all four with 403 |
| 2026-08-08 | 2 | Release/Ferrous active-framework restart using `--broadcast tailscale0` | Passed; native IPv4/IPv6 listeners replaced `socat`, Electron/console reconnected, Terminal and File Explorer reached ready, and worker `TE_FRAMEWORK_URL`/FWS URL remained loopback |
| 2026-08-08 | 3A planning | Read-only active-writer, platform-fallback, profile-selection, and build-cache retention investigation | Confirmed canonical/fallback gaps, debug-by-default behavior, no build lock/pruning, and 10 stale final release binaries totaling 206.6 MiB |
| 2026-08-08 | 3A | Python path/bootstrap/cache/console/runtime suites; Electron full suite/typecheck/compile; Rust full feature suite/format/check; isolated CLI profile smoke | Passed; 72 Python tests, 61 Electron tests, 63 Rust tests plus 4 ignored benchmarks, release/debug paths resolved correctly, 0 failures |
| 2026-08-08 | 3D | Migration/path/bootstrap fixture suite; current legacy sidecar schema probe; real-root JSON dry-run; static checks | Passed; destructive source-overwrite, destination-only retention, one-time receipt, active-writer guard, interrupted recovery, permissions, and report-only boundaries validated; no real apply performed |
| 2026-08-09 | 4B.1 | App-worker module/router unit tests, renamed-package subprocess smoke, existing pipe-worker integration, compileall, focused basedpyright | Passed; 7 tests, 0 failures; focused static analysis reported 0 errors |
| 2026-08-09 | 4B.2 | Source-package stale scan; Code TE2 import smoke; Python, frontend, Rust, Electron, and clean wheel/sdist validation | Passed; 203 Python, 171 frontend, 66 Rust plus 4 ignored, and 61 Electron tests; TypeScript/build/compile passed; clean archives contain only `app/apps/code_te2` |
| 2026-08-09 | 5 implementation | Webview RPC framing/runtime tests; Sidebar DTO/projection tests; 177-test frontend suite; canonical Code TE2 typecheck/build; focused Python static analysis; WBA server compile path; diff hygiene | Passed locally with 177 frontend and 7 Python tests; live OpenAI view and Electron detach/attach acceptance remain pending |
| 2026-08-09 | 1–3C acceptance | Downstream-checkout live validation of remaining hover comparisons, Termux interface/no-XDG behavior, Linux canonical-root restart, framework stores, and Code TE2 state/WBA restart recovery | Passed; user-confirmed downstream acceptance complete |
| 2026-08-09 | 4A | Python discovery/path/migration suites; wheel/sdist archive and isolated install checks; Rust format/check/full tests and optimized cache build; isolated server health/shutdown smoke; Electron typecheck/tests/compile/package | Passed; 48 Python tests, 69 Rust tests plus 4 ignored benchmarks, 61 Electron tests, canonical package contents and health identity, 0 failures |
| 2026-08-09 | 4B implementation | Canonical-id/alias and state-move Rust tests; full Python, Code TE2, Rust, Electron, Gecko, and Cefrium suites; WBA/host rebuild; Gecko/Cefrium APK assembly; Electron package; wheel/sdist path audit; stale-name classification | Passed; 204 Python, 172 frontend, 70 Rust plus 4 ignored, and 62 Electron tests; both Android unit suites and APK builds passed; package archives contain only `app/apps/code_te2`; live shared-runtime cutover remains pending |
| 2026-08-09 | Phase 5 prerequisites | Code TE2 typecheck/build and five focused WBA tests; isolated wheel extraction/import; full TE2 and ALS-RS Rust suites; non-default framework-port regression | Passed; TE2 74 tests plus 4 ignored, ALS-RS 139 tests in both library and binary targets, installed WBA matcher resolved without `node_modules`; TE2 `main` and `feature/ui-vsix-extensions` synchronized at `7cd923fc`, ALS-RS fix published at `15fb9af` |
| 2026-08-09 | Phase 5 live checkpoint | Electron inline OpenAI view through the public Rust WBA mount; encoded webview authority resources; Cap'n Proto handshake and MCP/fetch traffic; opaque-sandbox Web Storage adapter; wrapper loading-mask computed style | OpenAI logged `app routes mounted` and `ready provider mounted`; UI is functional, while a gray visual overlay and detach/attach acceptance remain open |
