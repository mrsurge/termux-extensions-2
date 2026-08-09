# Framework Cleanup And UI VSIX Tracker

Last updated: 2026-08-08

## Program status

| Phase | Status | Approval boundary |
|---|---|---|
| Phase 0: documentation and inventory | Complete | Planning documents plus the required repo-memory pointer only |
| Phase 1: generic WBA hover fidelity | Implemented; remaining live language checks pending | Approved, including generic fenced-language tokenizer preload |
| Phase 2: interface-scoped framework exposure | Implemented and active-framework validated on Linux; Termux check pending | Implementation and live-runtime restart approved |
| Phase 3A: shared paths and rebuildable caches | Implemented and automated-validated; live restart and Termux acceptance pending | Implementation approved; live shared-runtime restart still requires approval |
| Phase 3B: framework durable stores | Implemented and automated-validated; live framework acceptance pending | Implementation approved; live shared-runtime restart still requires approval |
| Phase 3C: Code TE2 durable state | Not started | Requires canonical-store implementation approval |
| Phase 3D: app/client paths and opt-in legacy migration/cleanup | Not started | Tool implementation and every real apply are separate approval boundaries |
| Phase 4A: internal/package naming | Not started | Requires packaging-aware rename approval |
| Phase 4B: public app identifiers | Deferred | Requires an explicit compatibility decision |
| Phase 5: UI VSIX rough-draft milestone | Deferred | Begins only after framework phases are stable |

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
| `cm6_sessions` helpers appear dead | Path is created; private read/write/delete helpers have no callers | Confirmed in current source; validate before removal |
| `rust-spike` names are active product names | Source root, package data, crate, CLI, cache id, env variables, and logs use them | Confirmed |
| Electron still uses an experimental source-directory name | Active client is `desktop_client/electron_spike` | Confirmed |
| UI extension support is intentionally absent | Explorer marketplace displays the unsupported notice | Confirmed |
| Sidebar presentation foundation is reusable | Run Profile presentation and exact-client routing phases are implemented | Confirmed |
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
| `$HOME/.cache/cm6_editor` | Code TE2 project/draft sidecars | Durable editor recovery data | Cut runtime to `$TE2_DATA_HOME/code_te2/projects`; move old data only through opt-in command | Active; highest risk |
| `$HOME/.cache/cm6_sessions` | Uncalled HistoryStore helpers | Intended session data | Remove dead helpers if no caller exists; otherwise define a canonical destination without runtime fallback | Apparently unused |
| `$XDG_DATA_HOME/termux-extensions-2` | Code TE2 history, preferences, icons, legacy runtime socket | Durable data/runtime | Cut runtime to canonical Code TE2 data/runtime roots; move old data only through opt-in command | Active |
| `$HOME/.cache/app_server` | No current console writer after Phase 3A | Bounded logs/generated console assets | Console runtime and CLI use `$TE2_CACHE_HOME/console`; no runtime fallback | Cut over; old disk tree remains untouched |
| `$XDG_CACHE_HOME/framework_shells` | No current bootstrap default after Phase 3A | Process/log/cache state | Bootstrap exports `$TE2_CACHE_HOME/framework_shells` to Framework-Shells | Cut over in source; live restart pending |
| `$HOME/.cache/aria_downloader` | Aria Downloader app | App state | Canonical `te2/apps/aria_downloader` data/cache subtree | Active app-specific root |
| `$XDG_CONFIG_HOME/te2` | Electron settings/presentation | Canonical configuration | Keep; normalize desktop subtree if needed | Active canonical root |
| `$TE2_CONFIG_HOME/framework` | Rust framework settings | Canonical configuration | Keep as the exclusive settings destination | Active canonical root |
| `$TE2_DATA_HOME/framework` | Rust state/bookmarks and Python job records | Canonical durable data | Keep as the exclusive framework-store destination | Active canonical root |
| `$HOME/.config/code-server` | Code TE2 extension registry, extensions, WBA settings, bridge | Durable managed/user data | Decide private TE2 managed code-server root in Phase 3C | Active; compatibility decision |
| `$XDG_DATA_HOME/te2` | Apps, managed code-server, Node runtime, desktop assets | Canonical durable root | Keep and organize | Active canonical root |
| `$XDG_CACHE_HOME/te2-android-install` | No current in-repo writer found | Build/install scratch | Report and delete only with explicit approval | Cleanup candidate |
| `$XDG_CACHE_HOME/dev.te2.desktop*` | No current Electron writer found | Old Electrobun/CEF cache | Report and delete only with explicit approval | Cleanup candidate |
| `$XDG_CACHE_HOME/te2_kotlin_lsp` | No current in-repo writer found | Unknown/external LSP state | Do not adopt or delete until producer is identified | Unowned/unknown |
| `$HOME/.cache/te_framework` | Legacy scripts | Old framework runtime state | Audit scripts, then retire path | Legacy candidate |
| `$HOME/.cache/te` and fallback `.local/run/te` | Legacy session scripts | Old session/runtime state | Audit scripts, then retire or move under runtime root | Legacy references |

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
- [ ] Live-validate HTML hover coloring.
- [ ] Live-validate CSS hover coloring.
- [ ] Live-validate one comparison language.
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
- [ ] Run `te2 --list-interfaces` in a live Termux environment.
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
- [ ] Live-validate a canonical-root framework restart on Linux.
- [ ] Live-validate the fallback contract in Termux without XDG variables.

### 3B: framework durable stores

- [x] Inventory settings/state/bookmarks/jobs schemas and writers.
- [x] Cut settings directly to the canonical framework config root.
- [x] Cut generic state, bookmarks, and jobs directly to canonical data roots.
- [x] Add canonical-store schema and persistence tests without legacy fixtures.
- [x] Serialize state read/modify/write transactions and publish JSON through unique same-directory temporary files.
- [x] Confirm ordinary source no longer reads or writes `termux_extensions`.
- [ ] Live-verify framework settings/state/bookmark APIs against canonical data after an approved framework restart.

### 3C: Code TE2 durable state

- [ ] Freeze a fixture containing real draft/project sidecar shapes.
- [ ] Cut project sidecars and draft indexes directly to canonical data paths.
- [ ] Cut history, preferences, icons, and runtime socket directly to canonical roots.
- [ ] Prove or disprove live use of `cm6_sessions` helpers.
- [ ] Decide private managed code-server user-data/extensions ownership.
- [ ] Validate drafts, recent projects/files, settings, extensions, WBA launch, and restart recovery.

### 3D: apps, clients, and cleanup

- [ ] Move TE2-owned app-specific roots under canonical app subtrees.
- [ ] Implement `te2 migrate-legacy-roots` as a standalone dry-run-first command.
- [ ] Require `--apply`, an inactive framework, a migration lock, schema validation, and a one-time receipt.
- [ ] Test old-only/new-only/identical/conflicting/interrupted/already-receipted migration cases.
- [ ] Inventory old desktop/Electrobun/CEF cache roots.
- [ ] Inventory Android install scratch roots.
- [ ] Identify the producer of `te2_kotlin_lsp` or classify it as external.
- [ ] Produce a dry-run legacy-root cleanup report.
- [ ] Obtain explicit approval before deleting workstation files.
- [ ] Remove only verified-empty or explicitly approved stale roots.

## Phase 4 checklist — naming cleanup

### 4A: supported internal names

- [ ] Finalize target `framework/` source layout.
- [ ] Rename `rust-spike` package-data and bootstrap discovery paths.
- [ ] Rename crate/package to `te2-server`.
- [ ] Rename bootstrap app/prog/log/cache identifiers.
- [ ] Introduce canonical `TE2_*` env names.
- [ ] Bound and document any legacy env read aliases.
- [ ] Rename `desktop_client/electron_spike` to `desktop_client/electron`.
- [ ] Update build/package scripts and active docs.
- [ ] Validate editable install, wheel/sdist install, cached build, and launch.
- [ ] Decide retirement timing for the `te2-rust` command alias.

### 4B: public identifiers

- [ ] Inventory every `file_editor_cm6` manifest, route, asset, client, and persisted-state dependency.
- [ ] Separate real CodeMirror 6 component names from obsolete product names.
- [ ] Decide whether the canonical app id becomes `code_te2`.
- [ ] If approved, define route/app-id aliases and persisted-state migration.
- [ ] Do not run a mechanical global replacement.

## Phase 5 placeholder — UI VSIX

- [ ] Re-investigate contribution points after framework cleanup lands.
- [ ] Select the smallest first UI contribution subset.
- [ ] Define WBA-to-backend registration/disposal facts.
- [ ] Define CSP, resource-origin, and message-routing boundaries.
- [ ] Map UI surfaces onto browser/Gecko inline and Electron detachable presentations.
- [ ] Define disable/uninstall/restart/reconnect teardown.
- [ ] Select one real extension as an acceptance fixture.
- [ ] Create a separate detailed UI VSIX plan and tracker.
- [ ] Keep the marketplace unsupported notice until live acceptance passes.

## Deferred decisions

| Decision | Why deferred |
|---|---|
| Rename `file_editor_cm6` to `code_te2` | Public ID touches URLs, native clients, assets, IPC, and persisted state |
| Retire `te2-rust` CLI alias | Installed-user compatibility must be measured after package rename |
| Move all code-server state out of `~/.config/code-server` | WBA compatibility and user extension migration need an isolated acceptance pass |
| Delete `te2_kotlin_lsp` | Current repository does not prove ownership |
| Detailed UI VSIX architecture | Must be based on the cleaned framework and a selected real extension |

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
