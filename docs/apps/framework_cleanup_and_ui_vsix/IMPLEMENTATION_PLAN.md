# Framework Cleanup And UI VSIX Implementation Plan

Status: Phases 1 through 4 are implemented and validated. Phase 5's first
activity-bar webview slice and its first command/panel follow-ons are implemented
and live-accepted. Per-client state continuity and Electron readiness ordering
are implemented and locally validated; live continuity acceptance remains open.
Real legacy-root migration applies, filesystem deletion, and later UI VSIX
contribution points remain separate approval boundaries. Post-4B WBA packaging
and Sidebar peer transport prerequisites are complete on TE2 commit `7cd923fc`.

This plan coordinates four framework-readiness fixes and leaves UI VSIX
extensions as a deliberately rough later milestone:

1. preserve WBA hover content faithfully so fenced code is tokenized;
2. restore the network-interface/IP/subnet behavior advertised by `te2 --help`;
3. consolidate TE2-owned cache, data, configuration, and runtime paths under
   canonical TE2 roots with XDG and Termux-safe resolution;
4. remove current-product `spike`, `cm6`, and other historical names where they
   are no longer truthful; and
5. investigate UI VSIX surfaces only after the framework work is stable.

The phases are intentionally independent. A phase is not authorization to
start the next phase, delete a legacy directory, restart the shared framework,
publish Android assets, bump versions, or rename a public app identifier.

## 1. Initial source-backed findings

This section records the source state that justified the phased work. Later
implementation-result blocks and the tracker are authoritative for the current
state.

### 1.1 The narrow `--broadcast` forms are advertised but ignored

The installed `te2 --help` currently advertises:

```text
--broadcast IP_SUBNET_OR_IFACE [IP_SUBNET_OR_IFACE ...]
```

and describes `all`, IP addresses, subnets, and interface names as valid
targets. The original framework bootstrap parsed and retained every target, but
`_resolve_listen_host()` implements only one case:

- `--broadcast all` becomes `0.0.0.0`;
- every IP, subnet, and interface selector falls through to the ordinary
  `--host` value, normally `127.0.0.1`.

The retired Python server did more than choose a listening address. It bound a
wildcard listener for network mode, resolved interface metadata, and built a
client-IP allowlist. Its implementation had important flaws that must not be
copied:

- an invalid selector could still leave the server listening on every
  interface;
- interface mode skipped filtering and therefore exposed more than the named
  interface;
- the HTTP-only middleware contract was not stated for WebSocket and SSE
  upgrades; and
- listener identity, internal framework origin, and advertised client origin
  were conflated.

The Rust cutover should restore the intended behavior as a new explicit
network-exposure contract, not restore the retired Python framework.

### 1.2 TE2 storage is fragmented and some durable state is mislabeled as cache

At inventory time, source actively owned several incompatible roots:

- the Rust build bootstrap defaults to `$XDG_CACHE_HOME/te2-rust-spike`;
- Rust settings, state, bookmarks, and Python jobs use
  `$XDG_CACHE_HOME/termux_extensions`;
- Code TE2 project sidecars and drafts use `$HOME/.cache/cm6_editor`;
- Code TE2 history/preferences/icons and a legacy UDS location use
  `$XDG_DATA_HOME/termux-extensions-2` or an equivalent hard-coded path;
- TE2 console data uses `$HOME/.cache/app_server`;
- Framework-Shells defaults to `$XDG_CACHE_HOME/framework_shells`;
- individual apps can still create feature-specific roots such as
  `$HOME/.cache/aria_downloader`; and
- old scripts still mention `.cache/te`, `.cache/te_framework`, and a
  `.local/run/te` fallback.

The build bootstrap has a separate retention problem. It currently defaults to
debug unless `--release` is supplied, copies every successful server build to
`bin/<source-fingerprint>/<profile>/`, and never locks or prunes that final
binary cache. On the 2026-08-08 Linux inspection host, ten obsolete release
binaries occupied 206.6 MiB even though the reusable Cargo target accounted for
the actual incremental build state. Final launch binaries and incremental
compiler artifacts need separate retention policies.

The repository already has the beginning of the correct shape:

- `$XDG_CACHE_HOME/te2` for rebuildable TE2 artifacts;
- `$XDG_DATA_HOME/te2` for durable TE2-managed data;
- `$XDG_CONFIG_HOME/te2` for user configuration; and
- a TE2-owned runtime subtree for sockets and process-lifetime files.

`$HOME/.cache/cm6_editor/projects` is especially sensitive: it contains
recoverable editor drafts and project session state. It must be treated as
durable user data during migration even though the old path calls it a cache.

Some observed roots have no current in-repository writer, including the old
Electrobun CEF cache names and the Android-install scratch root. They are
cleanup candidates, not migration sources. `te2_kotlin_lsp` also has no current
in-repository owner and may be third-party or historical state; TE2 must not
claim or delete it until its producer is proven.

### 1.3 Supported-product source names still said `spike`

At inventory time, the supported framework was rooted at `rust-spike/`, packaged under
`te2/rust-spike`, compiled as `te2-rust-spike-server`, launched with
`prog="te2-rust-spike"`, cached under `te2-rust-spike`, and configured through
`TE2_RUST_SPIKE_*` variables. The active desktop client similarly lived under
`desktop_client/electron_spike/`.

These are no longer experiments. The names now obscure the supported product
boundary and directly create legacy filesystem paths.

Not every occurrence of `cm6` is automatically stale. The reusable JSON fields
still embed a real CodeMirror 6 editor, while `file_editor_cm6` is a public app
identifier embedded in manifests, routes, asset inventories, Android/Electron
integration, Socket.IO paths, and persisted state. Internal truthfulness and a
public identifier migration must therefore be separate tasks.

### 1.4 Hover syntax loss is a generic DTO projection bug

WBA returns VS Code hover contents as a mixture of Markdown strings and legacy
language/value records. The frontend helper
`monaco_editor/editor_bridge_utils.ts::toMonacoHoverContents()` currently tests
for `value` before it tests for `language + value`.

Consequently this input:

```json
{ "language": "javascript", "value": "const value: string" }
```

is projected as plain Markdown instead of a fenced JavaScript code block. The
later language-aware branch is unreachable. The helper also discards supported
Markdown metadata instead of projecting it intentionally.

This explains why JavaScript, HTML, CSS, and any other provider using the
language/value shape can render an uncolored signature even though the WBA
provider itself is working. The fix belongs in the generic hover content
adapter. No per-language special case is permitted.

### 1.5 UI VSIX has a usable presentation foundation but needs a later contract

The existing Run Profile work established the reusable pieces UI extensions
will need:

- server-owned surface membership and lifecycle facts;
- client-owned order, foreground, and presentation state;
- GeckoView inline presentation compatibility;
- Electron embedded/detached presentation support; and
- exact-client routing without a global active-window fallback.

The Open VSX Explorer overlay intentionally says UI extensions are unsupported.
Removing that statement before a real UI contribution contract exists would be
misleading. This plan reserves the later work without pretending the webview,
CSP, resource-origin, contribution-point, and lifecycle decisions are already
made.

Two implementation prerequisites were hardened without changing the deferred
UI VSIX architecture:

- WBA's production selector matcher is packaged beneath Code TE2's vendor tree,
  and an isolated installed-wheel test proves the generated adapter does not
  resolve it from source `node_modules`.
- TE2 app workers explicitly receive matching `TE_FRAMEWORK_URL` and `TE_PORT`
  values. ALS-RS keeps its own HTTP listener on `12459`, directs its outbound
  Sidebar IPC client to the injected framework origin, and re-registers its
  exact app peer after event-driven reconnects. The non-default framework-port
  regression was reproduced with `8081` and covered in ALS-RS commit
  `15fb9af`.

These close infrastructure prerequisites only. They do not select UI
contribution points, define an extension DOM contract, or begin Phase 5.

## 2. Canonical naming and storage contract

### 2.1 Canonical roots and platform resolution

New TE2-owned paths must be descendants of one of these roots:

| Purpose | Canonical root | Contents |
|---|---|---|
| Rebuildable/cache | `$TE2_CACHE_HOME`, otherwise `${XDG_CACHE_HOME:-$HOME/.cache}/te2` | build outputs, downloads, generated probes, logs with bounded retention |
| Durable data | `$TE2_DATA_HOME`, otherwise `${XDG_DATA_HOME:-$HOME/.local/share}/te2` | apps, managed runtimes, editor drafts/history, installed assets |
| User config | `$TE2_CONFIG_HOME`, otherwise `${XDG_CONFIG_HOME:-$HOME/.config}/te2` | framework, desktop, and Code TE2 user configuration |
| Process runtime | `$TE2_RUNTIME_HOME`, otherwise `$XDG_RUNTIME_DIR/te2` or a protected platform temporary root | sockets, pid-scoped files, ephemeral coordination |

The `TE2_*_HOME` values name the final TE2 root; `/te2` is not appended to an
explicit override. Resolution order is strict and shared across languages:

1. use a non-empty absolute `TE2_*_HOME` override;
2. otherwise use the corresponding non-empty absolute XDG base plus `/te2`;
3. otherwise use the documented `$HOME` fallback for cache, data, and config;
4. for runtime state, use an absolute writable `$TMPDIR`, then Termux
   `$PREFIX/tmp`, then the platform temporary directory, with a `te2-$UID`
   directory created as mode `0700` and checked for correct ownership.

Termux does not need to opt into XDG. Its normal `$HOME`, `$PREFIX`, and
`$TMPDIR` values produce the same TE2 subtree contract without depending on
desktop session variables. Native Android clients remain outside this resolver
and continue to use Android application-private `filesDir`, `cacheDir`, and
`noBackupFilesDir` storage.

The framework bootstrap resolves the four roots once and exports them to the
Rust server and every app worker. Standalone TE2 processes such as the Electron
client use the same algorithm. Relative override paths are configuration errors,
not paths to reinterpret against the current working directory.

Feature code must request a named subtree through a shared path helper or an
explicit runtime context. It must not construct a new top-level TE2-adjacent
directory.

Proposed subtrees use lowercase `snake_case`, matching current app identifiers
and Python modules:

```text
cache/te2/
  framework/build/
  framework_shells/
  console/
  code_server/downloads/
  desktop/build/
  apps/<app_id>/

share/te2/
  apps/
  app_state/<app_id>/
  templates/
  code_server/
  node_runtime/
  desktop_assets/
  code_te2/

config/te2/
  framework/
  desktop/
  code_te2/

runtime/te2/
  framework/
  code_te2/
```

Rust package/crate names remain idiomatic kebab-case. Environment variables use
uppercase `TE2_*`. Display names use `TE2` or the feature's current product
name and never include `spike`.

### 2.2 No runtime compatibility and explicit legacy migration

Ordinary TE2 startup reads and writes only canonical roots. It must not probe,
import, merge, alias, or fall back to a legacy framework root, and it must not
invoke migration code automatically. Missing canonical state means fresh state.
This is an intentional pre-release cutover rather than a compatibility period.

Legacy recovery is provided only by a separate `te2 migrate-legacy-roots`
command. The command is dry-run by default and requires an explicit `--apply`
to mutate the filesystem. It is never imported or called by the normal
bootstrap. Its state-bearing moves follow these rules:

1. Refuse to apply while a TE2 framework or writer process is active.
2. Acquire a migration lock in the canonical runtime root.
3. Inspect only a versioned allowlist of source-owned legacy paths; never infer
   ownership from a directory name.
4. Detect source and destination independently and print the complete action
   plan before changing either.
5. Stage replacements on the destination filesystem and publish them with an
   atomic rename.
6. Treat the allowlisted legacy source as authoritative: overwrite a matching
   canonical file, including divergent content and its mode. Directory overlays
   retain canonical-only files while the legacy tree wins every matching path.
7. `fsync` durable files and their parent directories before declaring success.
8. Validate every known schema and cross-file reference at the destination.
9. Remove a migrated source only after the canonical copy validates.
10. Write a versioned one-time receipt recording the destructive collision
    policy and refuse a second apply for that
    migration version.

Recognized durable/configuration data is moved. Rebuildable caches may be
relocated when useful, but obsolete fingerprinted launch binaries are discarded
instead of imported; incremental Cargo artifacts remain eligible for reuse.
Unknown or externally owned roots are always reported and left untouched.

Editor drafts, preferences, history, bookmarks, installed extensions, managed
runtimes, and desktop assets are data. Build trees, downloaded archives,
bounded logs, and generated probes are cache. Sockets are runtime state.

## 3. Phase plan

### Phase 0 — Documentation and inventory

Deliverables:

- this implementation plan;
- the paired tracker with source owner, risk, target, and status for each root;
- an explicit list of public identifiers that cannot be renamed mechanically;
- phase-specific validation and rollback requirements.

Exit criteria:

- every active legacy root has an owner and proposed destination;
- unowned roots are labeled cleanup candidates rather than silently adopted;
- later phases can be approved independently.

### Phase 1 — Generic WBA hover fidelity

Scope:

- replace the lossy hover-content conversion with a typed generic normalizer;
- recognize language/value records before generic Markdown records;
- emit a fenced code block using the supplied language identifier;
- preserve supported Monaco Markdown fields deliberately and reject malformed
  fields deterministically;
- extract fenced-code language tags from the normalized hover Markdown;
- resolve tags through Monaco's contributed language IDs and aliases, then
  await the existing WBA TextMate tokenizer before returning the hover;
- discard the hover if cancellation or document-version drift occurs during
  grammar loading;
- keep multi-provider order and aggregation unchanged;
- add no JavaScript, HTML, CSS, or other language branch.

Validation:

- unit cases for string, Markdown value, language/value, mixed multi-provider,
  malformed, metadata-bearing contents, contributed language aliases, and the
  tokenizer-await barrier;
- `npm run typecheck` and `node build.mjs` in `app/apps/code_te2`;
- complete Code TE2 frontend test suite;
- live hover acceptance in at least JavaScript, HTML, CSS, and one already
  working comparison language.

Exit criteria:

- provider signatures render with grammar-aware fenced-code tokenization;
- ordinary Markdown hover prose remains unchanged.

### Phase 2 — Interface-scoped framework exposure

Scope:

- retain `--host` as an exact advanced bind override;
- restore `--list-interfaces` with structured interface/address output;
- implement every advertised `--broadcast` selector: `all`, exact IP, CIDR,
  and interface name;
- resolve selectors once at startup into a typed network policy;
- use a wildcard listener only when external exposure is requested;
- enforce the resolved client allowlist for HTTP, SSE, WebSocket upgrades, and
  Socket.IO entry requests;
- fail closed before binding when any selector is invalid or resolves to no
  usable address;
- keep loopback admitted unless an explicitly approved later policy removes it;
- separate listener address from the internal framework origin so app workers,
  Framework-Shells, console, and MCP do not receive `http://0.0.0.0:<port>` as
  their service URL.

The implementation may retain `--broadcast` as a compatibility spelling while
introducing clearer internal names such as `NetworkExposurePolicy`. It must not
restore Python FastAPI middleware or the retired Python framework.

Validation:

- parser/resolver tests for all selector kinds and mixed selectors;
- invalid/empty interface fail-closed tests;
- Rust policy tests for IPv4/IPv6 address and subnet decisions;
- loopback-only default smoke test;
- HTTP, SSE, raw WebSocket, and Socket.IO acceptance/rejection tests;
- Linux and Termux/Android interface discovery checks;
- no shared-framework restart without explicit approval.

Exit criteria:

- help text and behavior agree;
- a named interface does not expose unrelated interfaces;
- internal services still connect through a stable loopback origin.

Implementation result:

- the Python bootstrap enumerates Linux/Android interfaces through libc
  `getifaddrs`, prints a stable JSON inventory, and resolves CLI selectors once
  into bind hosts plus a serialized immutable policy;
- exact IP and CIDR selectors match the accepted connection's peer address;
- interface-name selectors match the accepted socket's local destination
  address, which restricts exposure to that interface without breaking `/32`
  VPN interfaces such as Tailscale;
- Rust opens distinct IPv4 and IPv6 sockets with the IPv6 listener explicitly
  v6-only, captures peer and local addresses through Axum connect metadata, and
  applies one outer middleware before Socket.IO and every routed protocol;
- wildcard/public listeners are independent from the internal framework
  origin, which remains a usable loopback URL for app workers, Framework-Shells,
  console, and MCP.

### Phase 3 — Canonical TE2 roots and explicit migration

This phase is split so the highest-risk durable state does not move in the same
change as rebuildable caches.

#### Phase 3A — Shared path contract and rebuildable caches

- add language-appropriate path helpers backed by the same documented
  TE2/XDG/Termux resolution contract;
- resolve the canonical roots once in the bootstrap and propagate them to the
  Rust server and app workers;
- move the Rust build cache beneath `te2/framework/build`;
- move TE2 console and TE2-owned Framework-Shells cache paths beneath `te2`;
- normalize code-server download/probe and desktop build caches;
- make release the default build profile and make `--debug` the explicit
  opt-in selector across cached, uncached, and build-only paths;
- lock final-binary publication, atomically install the selected binary, and
  prune every other fingerprinted final binary only after validation while
  retaining the Cargo incremental target;
- stop new writes to feature-specific cache roots;
- add path-resolution, Termux fallback, environment-override, profile-default,
  concurrent-build, and stale-final-binary pruning tests.

Implementation result:

- Python, Rust, and Electron now resolve the same explicit-final-root,
  XDG-base, `$HOME`, and Termux runtime fallback contract; the bootstrap exports
  all four resolved roots to the Rust server and app workers;
- framework builds, Framework-Shells state, console logs, code-server
  downloads/probes, desktop build artifacts, managed code-server, terminal
  Node runtime, desktop assets, and Electron configuration use canonical named
  subtrees without probing their former rebuildable-cache locations;
- framework builds default to release across cached and direct Cargo modes,
  with `--debug` as the mutually exclusive opt-in;
- one cross-process cache lock protects build, validation, atomic publication,
  and final-binary pruning; Cargo's incremental target is retained while every
  non-selected final fingerprint/profile is removed; and
- this slice intentionally leaves the durable `termux_extensions`,
  `cm6_editor`, `termux-extensions-2`, and shared code-server user-state roots
  for Phases 3B and 3C.

#### Phase 3B — Framework settings, state, jobs, and bookmarks

- cut durable framework stores directly over to canonical config/data roots;
- preserve schema and API behavior;
- do not read or import `termux_extensions` during framework startup;
- reconcile Python jobs with the Rust-owned framework path contract.

Implementation result:

- framework settings resolve only to
  `$TE2_CONFIG_HOME/framework/settings.json`;
- generic state, bookmarks, and Python job records resolve only beneath
  `$TE2_DATA_HOME/framework/` as `state_store.json`, `bookmarks.json`, and
  `jobs.json`;
- state mutations are serialized across their complete read/modify/write
  transaction, while every Rust JSON store publishes through a unique
  same-directory temporary file;
- store tests preserve the existing object, bookmark-array, template-expansion,
  shallow-merge, deletion, interrupted-job, and malformed-file behavior;
- `app.libs.jobs.jobs_bp` is not mounted by the Rust framework. Phase 3B does
  not resurrect that retired global route; it only removes the module's legacy
  persistence probe while the remaining app-worker imports await a separate
  functional disposition; and
- the old `termux_extensions` tree is not read, moved, or deleted. Its explicit
  recovery remains Phase 3D migration-tool work.

#### Phase 3C — Code TE2 drafts, history, preferences, and runtime files

- cut project sidecars, drafts, history, preferences, and icons directly over
  to `te2/code_te2` and verify every new draft index/sidecar pair;
- do not probe `cm6_editor` or `termux-extensions-2` during app startup;
- remove the unused `cm6_sessions` helper path only after proving
  its helper methods have no live callers;
- move the Sidebar backchannel socket to the runtime root;
- decide whether TE2's managed code-server should receive a private
  TE2-owned user-data/extensions root instead of sharing `~/.config/code-server`.

Implementation result:

- `code_te2_paths.py` derives one Code TE2 partition from the canonical TE2
  roots: sidecars, history, icons, and private code-server state use data;
  preferences use config; the Sidebar and code-server sockets use runtime; and
  the remaining browser-console/probe records use cache;
- project sidecars and draft indexes now live only beneath
  `$TE2_DATA_HOME/code_te2/projects`; the real-shape version-2 sidecar fixture
  verifies draft content, recent-file state, index rebuild, and reload recovery;
- the dead `cm6_sessions` directory creation and all of its uncalled helper
  methods are removed;
- TE2's managed code-server executable remains separately versioned beneath
  `$TE2_DATA_HOME/code_server`, while its User data, extensions, registry, and
  settings are private to `$TE2_DATA_HOME/code_te2/code_server` and its Unix
  socket is runtime state;
- WBA receives exact private extension/settings/RPC paths and has no
  `~/.config/code-server` path fallback; extension CLI operations receive both
  private code-server directories; and
- ordinary startup does not inspect, import, move, or delete legacy Code TE2
  roots. Their recovery remains an explicit Phase 3D operation.

#### Phase 3D — App-local and client-local paths

- move TE2-owned per-app state beneath `te2/app_state/<app_id>`, separate from
  installable app source beneath `te2/apps/<app_id>`;
- retain Electron configuration under the canonical TE2 config root;
- implement the standalone, dry-run-first `te2 migrate-legacy-roots` command
  after every canonical destination and schema validator exists;
- classify and clean old Electrobun/CEF and Android-install scratch roots only
  through an explicit migration/cleanup invocation;
- leave external/unknown caches untouched and report them.

Validation:

- proof that ordinary startup never stats or opens a legacy root;
- opt-in migration-command tests with old-only, new-only, identical-both,
  source-overwrites-divergent-both, already-receipted, active-writer, and
  interrupted fixtures;
- permission and atomicity tests;
- Code TE2 draft recovery test using real sidecar content;
- framework settings/state/bookmark/job persistence tests;
- desktop settings/assets and Framework-Shells restart-reuse tests;
- post-cutover scan proving current source no longer reads or writes legacy
  roots.

Exit criteria:

- active TE2 writes occur only under canonical roots;
- durable state is present and validated at the canonical destination;
- ordinary runtime behavior is independent of every legacy root; and
- the separate migration command either moves a recognized legacy root after
  explicit invocation or reports exactly why it remains.

Implementation result:

- app state now resolves through `te2_app_data_home()` beneath
  `$TE2_DATA_HOME/app_state/<app_id>`; Aria Downloader uses that partition and
  the app registry resolves its source catalog only beneath
  `$TE2_DATA_HOME/apps`;
- `te2 migrate-legacy-roots` is a bootstrap-independent, dry-run-first command;
  `--apply` takes an exclusive framework-lifetime guard plus a migration lock,
  validates every allowlisted source and destination before mutation, checks
  free space, publishes staged replacements atomically, and writes a versioned
  one-time receipt;
- collisions are intentionally destructive and source-authoritative: a legacy
  file replaces a matching canonical file and mode, while directory entries
  found only at the canonical destination survive the overlay;
- recognized framework, Code TE2, code-server, Aria, Framework-Shells, Cargo,
  and console paths are migrated; explicitly rebuildable legacy outputs are
  deleted; unknown Kotlin LSP state and unrecognized app-server/code-server
  content are report-only; and
- the obsolete Python-framework/dtach helper scripts were removed. Real
  workstation state has only been inventoried and dry-run; no apply or cleanup
  was performed as part of implementation.

### Phase 4 — Current-product naming cleanup

#### Phase 4A — Safe internal and package names

Proposed target shape:

```text
framework/
  bootstrap/
  tests/
  rust/
    crates/te2-server/

desktop_client/electron/
```

Rename and update as one packaging-aware slice:

- `rust-spike/` source/package-data paths;
- `te2-rust-spike-server` crate/package name;
- bootstrap `APP_ID`, CLI program/description, cache fingerprint namespace, and
  log/temp prefixes;
- canonical `TE2_*` framework environment variables;
- `desktop_client/electron_spike/` and corresponding docs/build paths.

The environment-variable rename is a hard cutover: bootstrap, server, runtime
bridge, console, tests, and Electron read and write only the canonical names.
`TE_PORT`, `TE_FRAMEWORK_URL`, and `FRAMEWORK_SHELLS_*` remain established
cross-component contracts rather than legacy aliases. The `te2` command is
canonical; the retained `te2-rust` command alias is unchanged and its eventual
retirement remains a separate compatibility decision.

Implementation result:

- supported framework source now lives under `framework/`, its crate/package/
  binary is `te2-server`, and source plus installed-package bootstrap discovery
  resolves `framework/bootstrap/bootstrap.py`;
- bootstrap/server identity is `te2`, while logs, errors, build-fingerprint
  namespace, and test temporary paths use framework/server terminology;
- launcher inputs and bootstrap-to-server values use `TE2_SERVER_*`, the Python
  sidecar uses `TE2_RUNTIME_BRIDGE_*`, and Electron smoke controls use
  `TE2_DESKTOP_*`; no experimental-name read aliases remain;
- the active desktop source is `desktop_client/electron/`; moving the parent
  tree retained the ignored Rust target, Electron dependency, and package-build
  caches in place; and
- active docs and package metadata use canonical paths. Old names remain only
  where the opt-in legacy-root migrator must recognize old disk state or where
  historical planning records describe the original migration.

Validation result:

- 48 focused Python bootstrap/path/migration/discovery tests passed;
- wheel and sdist archives contained `te2/framework/...`, contained no old
  package path, and both isolated-wheel and editable installs resolved
  `te2 --print-command` to a release `te2-server` binary;
- Rust format/check passed and the full suite passed with 69 tests plus four
  intentionally ignored benchmarks;
- the optimized fingerprinted build completed, and an isolated port-18089
  launch returned canonical `/api/health` identity before clean SIGINT/Ferrous
  shutdown; and
- Electron passed typecheck, 61 tests, compilation, and Linux packaging from
  `desktop_client/electron/` after the required disk-space preflight.

#### Phase 4B — Public identifiers and truthful `cm6` names

The read-only audit confirmed that `file_editor_cm6` is not an isolated
manifest value. The generic Python app worker currently derives the backend
module package and required router symbol from the public app id. The same id
also owns Rust lifecycle/proxy/state routes, Socket.IO mounts, Framework-Shell
labels, Android and Electron native contracts, standalone Terminal UI IPC,
asset inventories, and saved Android navigation. A manifest-only rename would
therefore fail during backend import before any frontend could load.

Apply the cutover in reviewable, independently validated slices:

1. Decouple built-in backend source identity from public app identity. Derive
   the importable Python module name from the backend file's package path and
   allow the module to export its authoritative `TE2_APP_ROUTER`. Retain the
   existing named-router contract for third-party apps that do not yet export
   the explicit router; Code TE2 must use the explicit contract before its
   source directory moves.
2. Move `app/apps/file_editor_cm6` to `app/apps/code_te2` and update Python
   imports, package metadata, build scripts, source consumers, tests, and
   current documentation while temporarily retaining the public
   `file_editor_cm6` manifest id and URLs. Keep the physical move separate from
   the public network cutover so Git can preserve directory-rename history and
   downstream branches can resolve against a clear boundary.
3. Add one exact public-id canonicalization rule,
   `file_editor_cm6 -> code_te2`. The alias must never appear as a second
   catalog entry, launch a second worker, create a second Framework-Shell
   identity, or retain a second state authority. Old `/app`, `/api/app`,
   `/apps/by-id`, lifecycle/readiness, WebSocket, and Socket.IO requests must
   resolve to the canonical `code_te2` definition during the bounded native
   rollout window; newly generated URLs expose only `code_te2`.
4. Cut the manifest id and every active client contract to `code_te2` together:
   Rust routes and the Code TE2 proxy policy, Socket.IO service paths, frontend
   constants, Framework-Shell/run-profile labels, Android Gecko/Cefrium
   interception and UI IPC, Electron UI IPC/runtime injection, standalone
   Terminal integration, Service Worker paths, and Android/desktop asset
   inventories. Stop old Code TE2 workers and run profiles at this boundary;
   live `file_editor_cm6` shells are not migrated into a second identity.
5. Perform bounded one-time state migration. Move the exact framework state key
   `app_state:file_editor_cm6` to `app_state:code_te2` only when needed; rewrite
   saved Android `/app/file_editor_cm6` navigation; invalidate serialized Gecko
   session history whose security principals cannot survive the path change;
   migrate the Code TE2 layout-storage key; and canonicalize any exact Sidebar
   slot or restore URL containing the former id. Ordinary startup must not
   continually probe old keys.
6. Rename product-level internal contracts in a separate slice: `cm6:*`
   browser events, `window.__cm6*` globals, `FILE_EDITOR_CM6_*` operational
   names, the `code_cm6_layout_prefs` key, and `.code_cm6/diagnostics`. Remove
   the uncalled `explorer.cm6.mirror` RPC rather than renaming it. Keep names
   that truthfully identify the embedded CodeMirror 6 JSON component, including
   `cm6-json-*` source/CSS identifiers and CodeMirror vendor paths.
7. Rebuild generated Code TE2 and WBA outputs only from their renamed source.
   Android OTA assets and packaged Electron assets remain explicit publication
   boundaries rather than hand-edited source.

Before the physical directory move, merge or rebase active Code TE2 feature
work onto the Phase 4B branch. Keep worker decoupling, the filesystem move,
mechanical import/path updates, public-id canonicalization, client/asset
cutover, state migration, internal namespace cleanup, and generated output as
separate commits wherever the runnable boundaries allow it. Do not mechanically
replace every `cm6` occurrence.

Validation:

- focused app-worker tests proving that the public id may differ from the
  backend package and explicit router name;
- editable and installed-package Code TE2 launch tests after the source move;
- wheel/sdist contents and import-path checks for `app.apps.code_te2`;
- Rust route/lifecycle/state tests proving that the old id canonicalizes to one
  running `code_te2` identity;
- Code TE2 frontend typecheck, focused/full tests, and host build;
- Electron typecheck/tests/build/package after source and public-id changes;
- Android disk preflight, Gecko tests/build, Cefrium comparison tests, saved-URL
  migration tests, and asset-inventory audit when Android scope is approved;
- cold and warm native-client acceptance with no old Code TE2 worker or Run
  Profile shell alive at the cutover boundary; and
- stale-name scan categorized into the exact bounded public alias, legitimate
  CodeMirror 6 names, and historical documentation only.

Exit criteria:

- the canonical app/source/package/runtime identity is `code_te2`;
- `file_editor_cm6` remains only in the explicitly bounded public-id migration
  contract or historical documentation;
- Code TE2 no longer uses CM6 product-level events, globals, storage keys, or
  project paths; and
- real CodeMirror 6 component names remain intact and documented.

Implementation status (2026-08-09): the source, public ID, routes, clients,
state migrations, current documentation tree, and generated/package outputs
have completed the hard cutover and passed the recorded full validation matrix.
The shared runtime was intentionally not restarted during implementation. The
remaining cutover action is to stop any old Code TE2 workers and Run Profile
shells before the first live `code_te2` acceptance run; no live shell is
migrated across identities.

### Phase 5 — First UI VSIX activity-bar webview

This approved slice proves one real extension-owned UI without inventing a
second settings, project, or presentation system. It intentionally stops before
custom editors, webview panels, secondary-sidebar views, commands, menus, and
VS Code chat-session contribution points.

#### 5.1 Project and extension authority

- The existing Code TE2 extension registry remains install/enablement authority.
- Its existing User and Workspace settings projections remain configuration
  authority. Workspace configuration continues to come from the active
  project's `.vscode/settings.json` through WBA's `workspace` and `folders[0]`
  tiers.
- WBA's existing workspace switch is the project-scope boundary. UI state must
  not introduce another current-project cache or a client-selected extension
  host cwd.
- VS Code extension `globalState` and `workspaceState` use WBA's
  `MainThreadStorage` actor. TE2 injects one exact private storage root beneath
  the managed Code Server User data directory; global Mementos are keyed by
  extension id, while workspace Mementos are additionally keyed by the stable
  active-workspace identity. Writes are serialized and atomically replaced.
  Settings Sync registration remains an explicit local-only no-op; it must not
  turn Memento state into settings or webview presentation state.
- The first implementation owns one logical provider instance and one stable
  surface per `(workspace, contributed view id)`. Independent simultaneous
  provider instances per browser/client are deferred because the current
  extension host is workspace-scoped and shared.

#### 5.2 Supported contribution subset

WBA discovers `contributes.viewsContainers.activitybar` and the matching
`contributes.views` entries whose exact type is `webview`. It activates the
normal generated `onView:<viewId>` event and implements the current Code Server
4.130 RPC contract for:

- `MainThreadWebviewViews` / `ExtHostWebviewViews` provider registration,
  resolve, visibility, title, description, badge, show, disposal;
- `MainThreadWebviews` / `ExtHostWebviews` HTML, content options, state, and
  binary-safe bidirectional `postMessage`; and
- exact protocol ids discovered from the managed Code Server build rather than
  treating unknown calls as successful empty stubs.

The first live acceptance fixture is
`openai.chatgpt_26.5803.41515.vsix`, specifically its activity-bar
`chatgpt.sidebarView`. Its secondary Sidebar view and custom conversation editor
remain outside this slice.

#### 5.3 Document, resource, and message bridge

- WBA serves a trusted outer wrapper under the existing WBA service route. The
  extension HTML runs in a sandboxed inner iframe so the wrapper can own
  transport and state without giving extension content the TE2 host DOM.
- The wrapper supplies the standard one-shot `acquireVsCodeApi()` contract,
  including `postMessage`, `setState`, and `getState`.
- Host messages are re-emitted inside the opaque iframe with the document's own
  origin so origin-validating extension runtimes receive the same event shape as
  a native VS Code webview. The wrapper also supplies client-local
  `localStorage`/`sessionStorage` adapters without granting `allow-same-origin`;
  durable local storage is namespaced by the stable workspace/view surface.
- Browser-to-WBA RPC remains strict MessagePack on the existing WBA Socket.IO
  lane. The extension-host mixed-argument codec preserves ArrayBuffer and typed
  array payloads rather than converting them to JSON/base64.
- `vscode-resource.vscode-cdn.net` URLs are rewritten to a stable WBA HTTP
  resource route. Files are admitted only after realpath resolution proves
  containment beneath the extension's declared `localResourceRoots`; the
  extension location and workspace are the normal defaults when the extension
  does not provide roots.
- Script execution and form submission follow the extension's webview content
  options. The extension's own CSP remains authoritative inside the document;
  the wrapper has its own restrictive CSP.

#### 5.4 Sidebar projection and native-client compatibility

- WBA publishes complete workspace-scoped `ExtensionWebviewSurface` snapshots
  over its existing backend event pipe. Python validates those DTOs and projects
  membership into the existing Sidebar ledger as URL slots.
- The backend owns membership and teardown. Each client continues to own order,
  foreground, hidden/embedded/detached presentation, and mention targeting.
- Browser and GeckoView use the existing inline Sidebar URL presentation.
  Electron uses its existing stable-surface detach/attach machinery; no new
  Electron-only webview transport is introduced.
- This phase makes no Android source or asset changes. Gecko compatibility is a
  consequence of using the shared Sidebar/browser surface and existing WBA
  route.

#### 5.5 Lifecycle and acceptance boundary

- Workspace switch disposes the old logical views before resolving the new
  workspace's views. Provider registrations survive a WBA workspace switch
  because the extension host itself survives; a full WBA reset clears both.
- Provider unregister, failed resolve, extension-host reset, and empty/stale
  snapshots remove the corresponding Sidebar membership deterministically.
- Disconnecting one browser presentation does not dispose the shared logical
  provider. Multi-client independent view instances require a later explicit
  architecture change.
- The marketplace's unsupported notice remains until the OpenAI activity-bar
  view is live-accepted in both an inline host and Electron detach/attach. Later
  contribution points require a new approved slice.

#### 5.6 Source-backed follow-on architecture

The follow-on investigation found that the next work is not one large generic
"UI extension" feature. It is a dependency-ordered set of Code OSS actors and
Code TE2 presentation contracts. The activity-bar provider remains one logical
surface per `(workspace, view id)`; additional Codex conversations come from
custom editors and webview panels, not cloned instances of that provider.

##### 5.6A Contribution membership, hiding, and the app drawer

The current close actions for URL and dock slots both call
`ui.sidebar.window.close`, whose backend removes the slot from the authoritative
Sidebar ledger. That is correct for a user-created URL slot, but it permanently
evicts a WBA-contributed extension view and its icon even though the provider is
still registered. The client presentation model already admits `hidden`, but
the Sidebar runtime does not currently use that mode as a user action.

For extension-backed slots:

- Close/undock must destroy only the current iframe or detached presentation,
  set that client's presentation mode to `hidden`, clear its local foreground
  and transient presentation identity, and leave backend membership intact.
- The app drawer gains an Extension Views section built from current Sidebar
  membership, including hidden extension surfaces. Choosing an entry changes
  that client's mode back to `embedded`, recreates/focuses the inline
  presentation, or focuses the existing detached Electron presentation.
- Provider unregister, workspace switch, failed resolve, WBA reset, or a newer
  complete WBA snapshot that omits the surface remains the only path that
  removes extension membership and therefore removes the drawer entry.
- User-created URL slots retain their existing destructive close behavior.

This keeps lifecycle authority in WBA/Python while order, foreground, and
hidden/embedded/detached state remain client-local. It also fixes the concrete
failure where closing the dock slot permanently loses the only way to reopen
the extension.

##### 5.6B Extension identity and icons

WBA already reads `contributes.viewsContainers.activitybar`, but it currently
projects each resolved view through Python as a generic URL slot with a hard
coded puzzle glyph. Extend the surface/Sidebar projection with bounded display
metadata:

- use the contributed view/container title for drawer, dock, and detached
  window identity;
- prefer the activity-bar container icon, fall back to the extension manifest's
  root icon, and use the existing generic glyph only when neither is usable;
- resolve icon paths beneath the extension install root and serve them through
  the existing realpath-contained WBA resource route, which already supports
  extension-local SVG/PNG resources; and
- keep the icon URL independent of a live iframe so a hidden surface remains
  identifiable in the app drawer.

##### 5.6C Workspace-scoped command and context registry

The generated Code Server 4.130 nid catalog already contains the required
actors, but WBA does not load or implement `MainThreadCommands`,
`ExtHostCommands`, `MainThreadMessageService`, `MainThreadTextEditors`,
`MainThreadWebviewPanels`, `ExtHostWebviewPanels`, or
`MainThreadCustomEditors`; unknown main-thread calls currently receive empty
success responses. The next protocol slice must load the named nids and fail
unsupported calls explicitly instead of silently reporting success. The exact
Code Server 4.130 generated values remain discovery output, not hard-coded
protocol constants.

Build one workspace-generation-scoped registry that composes:

- `contributes.commands` metadata, including title, category, short title,
  enablement, and light/dark or theme icons;
- `contributes.menus` placement, alternate command, group/order, and `when`;
- live command registration/unregistration from `MainThreadCommands`; and
- the extension-defined context keys updated through `setContext`, plus the
  current Code TE2 resource/editor context needed by menu predicates.

WBA owns context-expression parsing and eligibility. Each client surface sends
only its bounded ephemeral context through its own RPC lane: the editor sends
the active URI/path, language, selection, and focus facts; Explorer sends the
clicked and selected resources; and an extension view sends its surface
identity. WBA merges those facts with extension `setContext` state and resolves
the requested menu on an active-document/menu-open event. There is no context
or selection polling and frontends do not grow separate VS Code `when`-clause
evaluators.

Context operands and comparison literals remain distinct. An absent positive
context key evaluates false, while an unquoted right-hand literal such as
`.json` remains a literal rather than being mistaken for a missing key. This
keeps unprojected Debug Pretty Print and Copilot active-diff actions hidden
until their real context/state and editor semantics exist, without maintaining
a command-id or title blacklist.

Implemented editor command execution follows the editor's existing direct
strict-MessagePack WBA lane. WBA first fires the implicit `onCommand:<id>`
activation event, synchronizes the extension host's active editor selection,
and invokes the exact registered command through `ExtHostCommands`. Match Code
Server's resource arguments: editor title/context receives the active model URI.
Later Explorer and Sidebar contribution placements must continue to originate
through those surfaces' own backend lanes rather than adding a second direct
WBA client.

Extensions can also observe selection independently of command execution through
`window.onDidChangeTextEditorSelection`. The active Monaco editor therefore
projects its latest exact selection over the existing direct strict-MessagePack
WBA lane on cursor/selection events. The frontend coalesces a burst to at most
one update per 16 ms without polling, WBA rejects a path that is not its active
editor, and the accepted update passes through
`ExtHostEditors.$acceptEditorPropertiesChanged` so both
`activeTextEditor.selection` and the extension event advance together.
Disconnected notifications are dropped; after the WBA acknowledges the current
active-document open, the editor sends one authoritative selection snapshot.
The command-time synchronization remains the final execution barrier.

The existing `workspaceContains` implementation must also use Code OSS-compatible
glob semantics. Json Crack declares `workspaceContains:**/*.{json}`, while the
current hand-written matcher escapes brace expressions and therefore misses
that cold activation event. Reuse the already-vendored `picomatch` path instead
of adding another matcher. Implement `MainThreadMessageService` against the
existing shared toast/dialog UI so extension information, warning, and error
messages do not disappear into a successful empty RPC response.

Workspace switch and WBA reset replace the whole command/menu/context
projection; stale registrations must not survive into another project.
Unsupported context-expression forms fail closed rather than making commands
visible unconditionally.

###### Json Crack command/menu fixture

`AykutSarac.jsoncrack-vscode` 5.1.0 is the first concrete fixture. The installed
runtime payload and downloaded VSIX runtime payload are byte-identical. Its
manifest contributes:

- `jsoncrack-vscode.start` to `editor/title`, group `navigation`, with distinct
  light/dark SVG icons and the predicate
  `resourceExtname == .json || editorLangId == json`;
- `jsoncrack-vscode.start.selected` to `editor/context`, group `navigation`,
  with `editorHasSelection`; and
- `jsoncrack-vscode.start.specific` as the argument-driven command used by
  other callers.

Code Server turns the `editor/title` navigation group into a primary inline
editor action and supplies the active resource URI. Its editor context menu
supplies the model URI. Json Crack then reads `window.activeTextEditor`, and
the selection command reads `activeTextEditor.selection`; WBA's current editor
projection hard-codes that selection to line 1, column 1. Correct command
visibility alone is therefore insufficient: the invocation transaction must
push the exact current Monaco selection through
`ExtHostEditors.$acceptEditorPropertiesChanged` before activating and running
the command. The existing document-change projection already supplies the
whole-document updates Json Crack observes after panel creation.

##### 5.6D Extension-requested file navigation

Code OSS has two relevant paths:

- `window.showTextDocument` uses `MainThreadTextEditors.$tryShowTextDocument`
  and expects a real extension-host editor id; and
- `vscode.open` is routed through `MainThreadCommands.$executeCommand` as the
  internal `_workbench.open` command.

WBA already owns logical document/editor ids, while Code TE2 already owns the
canonical project-contained file-open action in the host backend. The new actor
must therefore synchronize/admit the WBA document, request the canonical
backend open through a correlated WBA-push/Python-ack transaction, and return
the valid WBA editor id only after the request is accepted. Ordinary file opens
must not bypass path admission, active-file sidecar mutation, or the existing
editor-open completion contract.

##### 5.6E Generic diff surfaces

`vscode.diff` arrives as `_workbench.diff(leftUri, rightUri, title, options)`.
Code TE2's current Monaco diff machinery is coupled to Git/draft baselines and
is not a generic two-resource extension API. Add a separate backend-owned diff
request/surface contract that validates both resources, materializes their
documents through the normal open/WBA rules, and presents a bounded read-only
diff without changing active-file authority accidentally. Do not disguise an
arbitrary extension diff as a Git or draft diff.

##### 5.6F Webview panels and custom editors

Json Crack is the smaller first webview-panel fixture. Every one of its three
commands calls `window.createWebviewPanel("liveHTMLPreviewer", title,
ViewColumn.Beside, options)`, sets a dynamic PNG panel icon and document title,
enables scripts, retains context when hidden, admits only its `build/webview`
and `assets` roots, and disposes its document/message subscriptions with the
panel. Its webview uses `acquireVsCodeApi`, sends a `ready` message, consumes
host `postMessage` updates, and reads `data-vscode-theme-kind`; those document
behaviors already fit the current trusted wrapper.

The current WBA `WebviewRuntime` can be factored rather than duplicated: its
opaque document sandbox, resource containment, MessagePack transport, Web
Storage, theme injection, and wrapper routes are shared webview-document
infrastructure. Its creation, visibility, and disposal paths are currently
specific to `MainThreadWebviewViews` and activity-bar contributions. A panel
layer must add `MainThreadWebviewPanels`/`ExtHostWebviewPanels` while preserving
that shared core and giving panels their own handle/type/title/icon/view-column,
reveal, view-state, serializer, and disposal lifecycle.

The OpenAI fixture also uses both `window.createWebviewPanel` and
`vscode.openWith(..., "chatgpt.conversationEditor", ...)`, and registers the
`chatgpt.conversationEditor` custom editor. This is the real path to multiple
Codex conversation windows. Implement `MainThreadWebviewPanels` before
`MainThreadCustomEditors`, then layer custom-document resolve/save/revert/
backup lifetime over it.

- Reuse the existing trusted-wrapper, opaque sandbox, resource admission,
  MessagePack, storage, theme, and Electron detach machinery.
- Give panels/custom editors their own stable surface identities and explicit
  dispose/reveal/title/icon lifecycle instead of cloning the activity-bar view.
- Project a temporary panel/custom-editor surface into Sidebar or an editor-like
  presentation according to its contribution lifetime; closing it is a true
  disposal, unlike hiding the persistent activity-bar contribution.
- Map `ViewColumn.Beside` to the existing embedded Sidebar presentation.
  `retainContextWhenHidden` keeps the same panel document/iframe alive while a
  different Sidebar item is foreground; it does not create a second backend
  surface.
- Keep WBA/Python authoritative for shared panel count and disposal, while each
  client retains its existing local order and foreground. Panel creation caused
  by a client command emits shared membership plus a targeted initial reveal to
  that initiating client; it must not steal focus in every connected client.
  `preserveFocus` and subsequent reveal calls update only the targeted
  presentation intent.
- Preserve `supportsMultipleEditorsPerDocument` and serializer/restore semantics
  before treating simultaneous conversations as accepted.

##### 5.6G Menu projection into existing Code TE2 surfaces

Code TE2 already owns custom menu surfaces: `.fe-toolbar`, the Explorer's typed
card-menu controller, and the Monaco touch-selection menu. Monaco's built-in
context menu is intentionally disabled. Project only eligible commands into
those existing owners:

- `editor/title` group `navigation` with a usable contributed icon -> a primary
  inline button in `.fe-toolbar-actions`, matching Code Server's top-right
  editor action and the Json Crack UX;
- other `editor/title` groups and iconless commands -> an Extension Actions
  overflow group in `.fe-toolbar`;
- `editor/context` and `editor/title/context` -> an Extension Context submenu
  in the editor's pointer/touch command surface;
- `explorer/context` -> an Extension Context submenu in the Explorer card menu,
  evaluated against the selected file/directory resource; and
- `view/title` -> controls in the inline/detached extension-surface header.

The mobile implementation extends the touch-selection runtime's existing
injected tool rows/submenu contract; it does not restore Monaco's native menu or
create a second mobile-only command authority. Browser and GeckoView render the
shared projection inline. Electron handles only its established detached-window
presentation and forwards command intent through the same backend contract.
Menu eligibility is refreshed event-wise when the active document changes or a
menu is opened so selection-dependent commands are current without background
polling.

The primary extension-action group is a shrinkable horizontal viewport inside
`.fe-toolbar-actions`. It preserves fixed Run/Stop/status controls while native
touch panning and mouse-wheel translation expose additional contributed icons
when the eligible action set outgrows the available toolbar width.

##### 5.6H Recommended implementation order

1. Fix hide/reopen semantics and add contributed identity/icons to the drawer.
2. Implement the workspace-scoped command/context registry, Code OSS-compatible
   `workspaceContains`, editor-selection synchronization, message service, and
   command invocation path.
3. Project Json Crack's bounded editor-title and editor-context commands.
4. Add `MainThreadWebviewPanels` on the shared secure webview core and live-
   accept Json Crack's beside-editor visualization lifecycle.
5. Implement `showTextDocument`/`vscode.open` through canonical backend open and
   extend the bounded editor/Explorer/view menus.
6. Add the generic diff surface.
7. Add custom editors and multiple Codex conversations.

Each slice must preserve the current activity-bar acceptance and test Browser,
GeckoView, and Electron behavior proportionally. Android source remains outside
scope unless a shared-web implementation proves insufficient and a separate
approved native change is required.

##### 5.6I Local implementation checkpoint

The first combined follow-on implementation now covers steps 1–4 above without
adding native-client authority:

- activity-view Close is a client-local `hidden` presentation transition;
  authoritative provider membership and its contributed icon remain available
  in the new Extension Views app-drawer section;
- manifest commands and `editor/title`/`editor/context` menu entries resolve in
  WBA, with bounded fail-closed `when` handling, contributed icons, implicit
  `onCommand` activation, exact Monaco selection synchronization, and execution
  through `ExtHostCommands` on the existing strict MessagePack editor/WBA lane;
- active Monaco cursor/selection changes are coalesced event-wise into
  `ExtHostEditors`, with an exact post-open-ack resynchronization and no
  disconnected replay or polling, so extensions can consume both current
  `activeTextEditor.selection` and `onDidChangeTextEditorSelection`;
- absent positive context keys now remain ineligible while unquoted comparison
  literals remain valid, so unsupported built-in Debug Pretty Print and Copilot
  diff actions are suppressed without hard-coded command filtering;
- the inline extension-action group scrolls horizontally by touch or wheel when
  its eligible icon set exceeds the available toolbar width;
- `workspaceContains` uses the vendored `picomatch` implementation, including
  the singleton-brace form used by Json Crack, and `MainThreadMessageService`
  emits extension messages into the existing editor notification path; and
- `MainThreadWebviewPanels` and `ExtHostWebviewPanels` reuse the established
  opaque-sandbox document, resource containment, storage, theme, and transport
  runtime. Panels project as temporary Sidebar membership and Close performs a
  WBA/extension-host disposal instead of a local hide.

This checkpoint intentionally does not claim the remaining general menu API.
Extension-defined `setContext`, enablement/alternate commands, Explorer and
view-title placements, targeted initial panel reveal, extension-requested file
navigation, generic diffs, custom editors, and multiple Codex conversations
remain later slices. Json Crack and Browser/GeckoView/Electron presentation
behavior require live acceptance before the corresponding acceptance items are
closed.

#### 5.6J Per-client webview reconstruction continuity

The detach acceptance exposed an ownership problem rather than a missing
extension-content store. Extension `globalState`, workspace-isolated
`workspaceState`, conversations, documents, and other semantic data remain
extension-host/backend state. Webview `acquireVsCodeApi().setState()`, the
opaque document's Web Storage adapters, scroll/selection state, and detached
window placement are client presentation state used to reconstruct a destroyed
document.

The current runtime has two concrete continuity defects:

- the host `clientId` is regenerated on every main-page boot, while the console
  bridge's per-window worker id lives only in `sessionStorage`; and
- WBA stores one shared `surface.state` and sends it to the document only after
  the extension script can already call `getState()`. That is both a
  cross-client last-writer-wins scope and an initialization race.

The next implementation uses four separate identities:

| Identity | Lifetime and purpose |
|---|---|
| `surfaceId` | Stable logical `(workspace, extension, view/panel)` identity owned by WBA |
| `clientInstanceId` | Stable browser profile or native application-installation identity |
| `windowId` | Per-window/tab identity retained across reload through `sessionStorage` |
| `presentationId` | Transient embedded/detached renderer incarnation correlated with a WBA-issued writer lease |

Persisted reconstruction state is keyed by `(clientInstanceId, surfaceId)`,
never by `windowId` or `presentationId`. The main-page console worker consumes
the same identity as `main_page:<clientInstanceId>:<windowId>`; console identity
is an observability projection, not the state authority.

Identity resolution is client-owned and platform-specific behind one shared
frontend contract:

- ordinary browsers create a pseudorandom `clientInstanceId` once in
  `localStorage`;
- Electron persists it through the existing preload/main native bridge beneath
  `$TE2_CONFIG_HOME`, independent of the random browser-relay origin; and
- GeckoView reuses its existing application-private installation id, projects
  it through the always-on asset-intercept WebExtension/native messaging path,
  and delivers it to the top-level document at `document_start`. It must not
  depend on the random localhost relay origin's Web Storage.

The editor settings surface displays a human-readable client label and a
copyable identifier. Reset is an explicit confirmation-gated action that
regenerates the identity and removes that client's extension reconstruction
snapshots. Arbitrary identifier editing is not supported because accidental
collisions would merge independent clients. The identifier partitions state;
it is not an authentication credential.

Every WBA wrapper attach carries `clientInstanceId`, `windowId`,
`presentationId`, and `surfaceId`. The client remains the conceptual owner of
the snapshot, while an opaque backend projection may durably retain:

```text
clientInstanceId + surfaceId + revision + writerLease
  -> vscodeState + localStorage entries + updatedAt
```

The projection never interprets, merges, or broadcasts the payload. Different
clients receive different reconstruction snapshots while continuing to share
the extension host's semantic workspace/content state. Cross-device roaming is
a separate opt-in feature, not an accidental consequence of collaboration.
WBA validates and persists the bounded opaque record beneath the existing Code
TE2 data partition. Python must not add webview state to the membership-only
Sidebar ledger or become extension-content authority.

Restore ordering is strict and event-driven:

1. Resolve the durable client identity.
2. Attach the exact client/window/presentation/surface tuple and obtain its
   latest accepted revision.
3. Make `getState()` and persistent Web Storage available synchronously before
   the first extension-authored script executes.
4. Accept later `setState()`/storage writes only from the current writer lease
   with a monotonically newer revision.
5. On detach/reattach, mint a new presentation/lease and reject late writes
   from the destroyed iframe.

The opaque sandbox remains intact; `allow-same-origin`, polling, a second
provider instance, and direct extension-to-native messaging are not part of the
solution. `retainContextWhenHidden` may preserve a still-live document, but
serialized reconstruction remains the portable Browser/GeckoView/Electron
contract whenever a renderer is destroyed.

Acceptance requires refresh, detach, detached refresh, reattach, native-client
cold restart, two simultaneous windows, two independent remote clients, reset,
late-writer rejection, and WBA/provider teardown tests. An extension that never
calls `setState()` or uses a durable extension store is not promised arbitrary
JavaScript-heap restoration.

#### 5.6K Electron readiness ordering

Electron previously awaited Run Target projection readiness in `navigateApp()`
before it created the app view or loaded the shared app shell. That placed a
Code TE2-specific native prerequisite ahead of the framework's ordinary app
lifecycle/readiness contract. A delayed UI IPC snapshot could therefore reject
or stall navigation before the readiness splash and SSE endpoint existed,
including for unrelated apps whose manifests declare `readiness_support`.

The corrected ordering preserves the shared app shell as the visible readiness
authority:

1. Electron creates the app view and immediately loads the relayed `/app/<id>`
   shell.
2. The shell performs its existing backend lifecycle/readiness SSE gate.
3. After the backend is ready and before frontend template injection, the shell
   invokes an optional exact-view native prerequisite.
4. Electron treats that prerequisite as a no-op for every app except
   `code_te2`; Code TE2 awaits the first current Run Target projection event so
   remote listeners exist before its restored Sidebar surfaces load.

The native prerequisite has no independent timeout or polling loop. A transient
UI IPC disconnect preserves existing listeners and the waiter survives until a
fresh complete projection arrives. Reconciliation failures still reject the
prerequisite with their real collision/error rather than loading a broken Code
TE2 surface. The browser and GeckoView paths do not expose this Electron-only
hook and continue using the ordinary shared readiness contract.

#### 5.7 GeckoView transient framework failure tolerance

Gecko's saved-session and active-app health paths distinguish an authoritative
framework response from transport failure. `UNHEALTHY` means a successful
running-app projection omitted the worker or reported terminal readiness; only
three consecutive authoritative failures may return the user to the local
launcher. `UNREACHABLE` means the framework request failed or returned an
invalid projection; it preserves the current/saved app presentation, clears the
consecutive authoritative-failure count, and lets the existing sockets and
projection streams reconnect. Cold restoration remains gated behind framework
relay setup and a fresh Run Target projection. This policy adds no retry poller
or alternate connection path.

#### 5.8 UI VSIX transport-resume continuity

The first connection-robustness slice keeps the current strict-MessagePack
Socket.IO WBA lane. Replacing Socket.IO with a raw WebSocket is not required to
correct the current lifetime bug and is explicitly deferred until the bounded
resume protocol has been proven on the existing transport.

The concrete defect is in the trusted extension-webview wrapper: every
Socket.IO `connect` currently performs a fresh attach followed by an
unconditional iframe `src` assignment. A transient transport reconnect is
therefore treated as destruction and reconstruction of the extension document,
even when the WBA process, logical surface, HTML revision, and live iframe are
all unchanged. Socket.IO connection recovery is disabled because WBA owns
explicit resynchronization, but the extension-webview path does not yet
implement that resynchronization boundary.

Transport lifetime and document lifetime must become separate state machines:

- the first successful attach loads the opaque iframe through the existing
  one-time bootstrap token and reconstruction record;
- a reconnect to the same WBA epoch, surface generation, and `htmlRevision`
  preserves the existing iframe, DOM, JavaScript heap, and scroll/selection
  state;
- an authoritative HTML revision change, surface replacement/disposal, WBA
  epoch change, or unrecoverable event-sequence gap deliberately reconstructs
  the document from the existing client-partitioned state store; and
- a transport disconnect alone never assigns `frame.src`, disposes the
  provider, or changes Sidebar membership.

WBA will expose a bounded resume handshake carrying the stable
`clientInstanceId`, `windowId`, `presentationId`, `surfaceId`, current WBA
epoch, loaded HTML revision, and the last applied server event sequence. WBA
returns an explicit `resume`, `replay`, or `reload` decision. Events from an
extension to its webview receive monotonic per-surface sequence numbers and a
bounded byte/count journal. A connected wrapper applies events in order; after a
reconnect WBA replays only the retained suffix. Falling outside the retained
range is an explicit reconstruction boundary rather than an unbounded queue.

Browser-to-extension interactions use stricter failure semantics. All pending
RPC promises reject immediately when the socket disconnects, Socket.IO's client
send buffer is cleared, and disconnected interactive messages are not replayed
because the server may already have applied them. Client reconstruction state
is different: the wrapper retains the latest local `vscodeState` and persistent
Web Storage projection, obtains a new writer lease during resume, and coalesces
one newer snapshot after reconnect. The existing lease/revision fencing remains
authoritative, so a replaced presentation cannot reclaim writer authority.

The disconnected indicator may cover or disable interaction, but it must not
destroy the iframe underneath it. Resume remains fully event-driven: there is
no connection poller, document-readiness poller beyond the existing bounded
page readiness contracts, or periodic state flush. Actual WBA `reload` and
`dispose` events retain their present authoritative meanings.

Validation must include:

1. initial attach loads exactly once;
2. a transient disconnect/reconnect preserves the exact iframe and live DOM;
3. retained ordered events replay exactly once after reconnect;
4. an event-journal gap, WBA restart, or HTML revision change reconstructs
   exactly once from the latest accepted client state;
5. pending/interactive RPCs fail without implicit replay while a newer local
   state snapshot survives and flushes under the renewed lease;
6. stale presentations remain unable to write after detach/reattach; and
7. Browser, Electron inline/detached, and GeckoView pass live high-latency,
   brief-outage, and frontend-blocking acceptance.

Only if the proven resume protocol still cannot obtain deterministic heartbeat,
buffering, and replay behavior from Socket.IO should the extension-webview
delivery path move to a dedicated raw binary MessagePack WebSocket. That would
be a transport substitution for this protocol, not a redesign of its state
authority, and it would not imply migrating Monaco's working WBA intelligence
lane.

#### 5.9 Android persistent client-runtime ownership

The second robustness slice addresses Android process ownership after the WBA
resume boundary is working. The current `PersistentNetworkService` is a
notification-only `START_STICKY` foreground service. The Activity still owns
the framework relay, Run Target projection stream and listener manager, UI IPC,
native console connection, and Gecko session; `onPause()` explicitly marks the
Gecko session inactive. Live device inspection confirmed that the foreground
service was running while the process held no wake lock and was not exempt from
device-idle restrictions. This is an ownership problem, not primarily a
Kotlin-versus-NDK problem.

The replacement is one started-and-bound Android client-runtime service shared
by the Gecko and Cefrium applications. It owns the native control plane:

- configured upstream framework identity;
- the stable localhost `AndroidFrameworkRelay` and retarget lifecycle;
- the authoritative Run Target SSE projection and
  `RunTargetRelayManager` listeners;
- the persistent native UI IPC transport, with bound Activity observers for
  IME and console presentation; and
- service reconstruction from Android settings followed by fresh authoritative
  framework/Run Target snapshots.

The Activity remains the renderer and UI owner. It binds to the service,
subscribes to current connection/projection state, and attaches or detaches UI
callbacks without closing the service-owned transports. Activity recreation,
configuration changes, and ordinary backgrounding must not change the local
framework relay origin or tear down Run Target listeners. A full service
restart may read the configured framework target, but it must never restore
cached Run Target routes as authority; it reconnects to the framework relay
first and consumes a fresh complete projection before remote app restoration.

When the user has explicitly enabled persistent remote-app operation, an app
shell that is merely backgrounded remains an active but unfocused Gecko session
instead of being unconditionally marked inactive. Without that opt-in, the
normal inactive-session battery policy remains available. This renderer policy
complements rather than replaces the WBA resume protocol: Android may still
suspend or lose a connection, and every client must recover without replacing a
healthy extension document.

Power policy must be visible and bounded. Persistent mode may hold a partial CPU
wake lock and, for Wi-Fi transport, a high-performance Wi-Fi lock only while a
user-visible remote app session requires them. Settings report battery
optimization status and link the user to the system configuration; TE2 does not
silently grant itself an exemption. Locks release on explicit persistent-mode
disable, app-shell exit, framework retarget where no remote app remains, or
service shutdown.

The present `dataSync` foreground-service classification is not accepted as a
permanent solution: Android applies a six-hour-in-24-hours background limit to
that type for apps targeting Android 15 or newer. Before this slice raises the
target SDK, the implementation must select and document the applicable
long-lived type (`connectedDevice` when the remote-host relationship satisfies
that contract, otherwise a reviewed `specialUse` declaration) and add its exact
permissions/Play disclosure. The service must implement appropriate timeout and
shutdown handling even while the project still targets API 34.

Android acceptance requires focused service/controller tests plus real-device
validation for background/foreground, screen-off, forced Doze and recovery,
notification denial, Activity destruction/recreation, process/service restart,
Wi-Fi/mobile/Tailscale handoff, delayed remote framework recovery, and active
Run Target listener reconstruction. Tests must prove there is no route polling,
no stale-route cache authority, no listener collision, and no unexpected
launcher redirect.

## 4. Cross-phase validation rules

- Preserve user changes and untracked files.
- Do not restart the shared TE2 runtime without explicit approval.
- Do not publish Android assets unless that phase explicitly includes them.
- Code TE2 frontend edits require typecheck, build, focused tests, and the full
  frontend test suite.
- Rust edits require formatting plus proportional checks/tests while retaining
  the existing target cache.
- Filesystem cleanup requires a dry-run inventory and explicit approval before
  deleting anything outside the repository.
- Update `README.md`, `AGENTS.md`, `.repo_memory.md`, and current reference docs
  only when the corresponding source contract actually changes.

## 5. Completion definition

This program is complete when:

1. hover code blocks retain language-aware syntax coloring generically;
2. `te2 --help` network selectors are implemented and fail closed;
3. TE2-owned state is consolidated beneath canonical TE2 roots with
   XDG/Termux-safe resolution, and any legacy import is deliberate and opt-in;
4. supported framework and desktop source/package names no longer say `spike`;
5. public legacy identifiers are either migrated or explicitly retained for a
   documented compatibility reason; and
6. UI VSIX work has a separate approved plan based on the cleaned framework.
