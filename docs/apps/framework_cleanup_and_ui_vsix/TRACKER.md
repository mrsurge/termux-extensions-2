# Framework Cleanup And UI VSIX Tracker

Last updated: 2026-08-08

## Program status

| Phase | Status | Approval boundary |
|---|---|---|
| Phase 0: documentation and inventory | Complete | Planning documents plus the required repo-memory pointer only |
| Phase 1: generic WBA hover fidelity | Implemented; remaining live language checks pending | Approved, including generic fenced-language tokenizer preload |
| Phase 2: interface-scoped framework exposure | Not started | Requires implementation approval and separate live-runtime approval |
| Phase 3A: shared paths and rebuildable caches | Not started | Requires implementation approval |
| Phase 3B: framework durable stores | Not started | Requires implementation and migration approval |
| Phase 3C: Code TE2 durable state | Not started | Requires implementation and migration approval |
| Phase 3D: app/client paths and legacy cleanup | Not started | Deletion outside the repo requires explicit approval |
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

## Storage ownership inventory

Paths use XDG-default notation. A root being present on one workstation does not
prove current ownership; current source is the authority.

| Legacy/current root | Current source owner | Data class | Proposed destination/action | Risk/status |
|---|---|---|---|---|
| `$XDG_CACHE_HOME/te2` | Several current TE2 components | Canonical cache root | Keep; normalize named subtrees | Active |
| `$XDG_CACHE_HOME/te2-rust-spike` | Rust bootstrap build cache | Rebuildable cache | `te2/framework/build` | Active; safe only after build-cache cutover |
| `$XDG_CACHE_HOME/termux_extensions` | Rust settings/state/bookmarks and Python jobs | Mixed durable data | Split into canonical framework data/config; migrate | Active; high risk |
| `$HOME/.cache/cm6_editor` | Code TE2 project/draft sidecars | Durable editor recovery data | `$XDG_DATA_HOME/te2/code_te2/projects` | Active; highest risk |
| `$HOME/.cache/cm6_sessions` | Uncalled HistoryStore helpers | Intended session data | Remove dead helpers or migrate if a live caller is found | Apparently unused |
| `$XDG_DATA_HOME/termux-extensions-2` | Code TE2 history, preferences, icons, legacy runtime socket | Durable data/runtime | Split into `te2/code_te2` plus runtime root | Active |
| `$HOME/.cache/app_server` | TE2 console runtime/CLI | Bounded logs/generated console assets | `te2/console` | Active |
| `$XDG_CACHE_HOME/framework_shells` | Rust bootstrap and Framework-Shells | Process/log/cache state | `te2/framework_shells` after subsystem coordination | Active contract |
| `$HOME/.cache/aria_downloader` | Aria Downloader app | App state | Canonical `te2/apps/aria_downloader` data/cache subtree | Active app-specific root |
| `$XDG_CONFIG_HOME/te2` | Electron settings/presentation | Canonical configuration | Keep; normalize desktop subtree if needed | Active canonical root |
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

- [ ] Define typed listener/internal-origin/exposure-policy configuration.
- [ ] Restore `--list-interfaces`.
- [ ] Resolve `all`.
- [ ] Resolve exact IPv4 and IPv6 selectors.
- [ ] Resolve IPv4 and IPv6 CIDR selectors.
- [ ] Resolve interface-name selectors on Linux and Termux/Android.
- [ ] Reject invalid or empty selectors before binding.
- [ ] Preserve loopback-only default.
- [ ] Keep internal framework URL on a usable loopback origin.
- [ ] Enforce policy on ordinary HTTP.
- [ ] Enforce policy on SSE.
- [ ] Enforce policy on raw WebSocket upgrades.
- [ ] Enforce policy on Socket.IO upgrades.
- [ ] Add parser, resolver, and allowlist unit tests.
- [ ] Add allowed/blocked integration tests.
- [ ] Update CLI help and README examples.
- [ ] Request explicit approval before restarting the shared framework for live validation.

## Phase 3 checklist — XDG consolidation and migration

### 3A: helpers and rebuildable caches

- [ ] Implement the canonical root contract in the bootstrap/runtime languages.
- [ ] Add XDG override tests.
- [ ] Move framework build cache writes.
- [ ] Move TE2 console cache/log writes.
- [ ] Coordinate Framework-Shells root migration.
- [ ] Normalize code-server download/probe cache.
- [ ] Normalize desktop build cache.
- [ ] Prove no new rebuildable cache uses a TE2-adjacent top-level root.

### 3B: framework durable stores

- [ ] Inventory settings/state/bookmarks/jobs schemas and writers.
- [ ] Implement versioned migration lock and receipt.
- [ ] Test old-only/new-only/identical/conflicting/interrupted cases.
- [ ] Migrate settings.
- [ ] Migrate generic state.
- [ ] Migrate bookmarks.
- [ ] Migrate jobs.
- [ ] Verify framework APIs against migrated data.

### 3C: Code TE2 durable state

- [ ] Freeze a fixture containing real draft/project sidecar shapes.
- [ ] Migrate project sidecars and draft indexes without data loss.
- [ ] Migrate history and preferences.
- [ ] Migrate icons and runtime socket location.
- [ ] Prove or disprove live use of `cm6_sessions` helpers.
- [ ] Decide private managed code-server user-data/extensions ownership.
- [ ] Validate drafts, recent projects/files, settings, extensions, WBA launch, and restart recovery.

### 3D: apps, clients, and cleanup

- [ ] Move TE2-owned app-specific roots under canonical app subtrees.
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
