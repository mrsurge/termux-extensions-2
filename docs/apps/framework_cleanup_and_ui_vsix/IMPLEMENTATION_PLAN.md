# Framework Cleanup And UI VSIX Implementation Plan

Status: Phases 1 through 3 and Phase 4A are implemented and validated. Real
legacy-root migration applies, filesystem deletion, Phase 4B public identifiers,
and UI VSIX work remain separate approval boundaries.

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

### Phase 5 — UI VSIX rough-draft milestone

This phase is a placeholder, not an implementation plan.

Questions to investigate after Phases 1-4:

- which contribution points are required for the first supported UI extension
  (`viewsContainers`, `views`, commands, menus, webview views, or a smaller
  subset);
- how the WBA extension host registers and disposes one UI surface;
- how extension messages cross the backend boundary without a frontend-to-WBA
  side channel;
- how extension resources receive a stable origin, CSP, and bounded access;
- how server-owned surface membership maps onto browser/Gecko inline and
  Electron detachable presentations;
- how reload, extension disable/uninstall, WBA restart, client reconnect, and
  shell exit destroy stale presentations; and
- which small real extension is the acceptance fixture.

Initial invariants:

- WBA remains extension-host authority;
- the backend owns durable membership/lifecycle facts;
- each client owns presentation and foreground state;
- GeckoView remains compatible and inline;
- Electron may detach using its existing presentation registry;
- UI extensions do not inherit Run Profile process ownership merely because
  they reuse presentation machinery; and
- the Explorer marketplace continues to say UI extensions are unsupported
  until an end-to-end contribution is accepted.

Expected deliverable for this phase is a separate source-backed UI VSIX plan
and tracker. No UI VSIX runtime code is authorized by this document.

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
