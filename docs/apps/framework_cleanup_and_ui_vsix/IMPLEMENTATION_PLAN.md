# Framework Cleanup And UI VSIX Implementation Plan

Status: source investigation complete; implementation phases require separate
approval.

This plan coordinates four framework-readiness fixes and leaves UI VSIX
extensions as a deliberately rough later milestone:

1. preserve WBA hover content faithfully so fenced code is tokenized;
2. restore the network-interface/IP/subnet behavior advertised by `te2 --help`;
3. consolidate TE2-owned cache, data, configuration, and runtime paths under
   canonical XDG `te2` roots;
4. remove current-product `spike`, `cm6`, and other historical names where they
   are no longer truthful; and
5. investigate UI VSIX surfaces only after the framework work is stable.

The phases are intentionally independent. A phase is not authorization to
start the next phase, delete a legacy directory, restart the shared framework,
publish Android assets, bump versions, or rename a public app identifier.

## 1. Source-backed findings

### 1.1 The narrow `--broadcast` forms are advertised but ignored

The installed `te2 --help` currently advertises:

```text
--broadcast IP_SUBNET_OR_IFACE [IP_SUBNET_OR_IFACE ...]
```

and describes `all`, IP addresses, subnets, and interface names as valid
targets. `rust-spike/app/bootstrap.py` parses and retains every target, but
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

Current source actively owns several incompatible roots:

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

### 1.3 Current-product source names still say `spike`

The supported framework is still rooted at `rust-spike/`, packaged under
`te2/rust-spike`, compiled as `te2-rust-spike-server`, launched with
`prog="te2-rust-spike"`, cached under `te2-rust-spike`, and configured through
`TE2_RUST_SPIKE_*` variables. The active desktop client similarly lives under
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

### 2.1 Canonical roots

New TE2-owned paths must be descendants of one of these roots:

| Purpose | Canonical root | Contents |
|---|---|---|
| Rebuildable/cache | `${XDG_CACHE_HOME:-~/.cache}/te2` | build outputs, downloads, generated probes, logs with bounded retention |
| Durable data | `${XDG_DATA_HOME:-~/.local/share}/te2` | apps, managed runtimes, editor drafts/history, installed assets |
| User config | `${XDG_CONFIG_HOME:-~/.config}/te2` | framework, desktop, and Code TE2 user configuration |
| Process runtime | `${XDG_RUNTIME_DIR:-<safe user fallback>}/te2` | sockets, pid-scoped files, ephemeral coordination |

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

### 2.2 Migration invariants

Every state-bearing move must follow these rules:

1. Acquire a migration lock before any writer opens the old or new store.
2. Detect old and new roots independently; never assume only one exists.
3. Prefer an atomic rename on the same filesystem.
4. When a merge is required, accept exact-identical files, copy missing files,
   and stop with a conflict report instead of overwriting divergent data.
5. `fsync` durable files and their parent directory before declaring success.
6. Record a small versioned migration receipt in the canonical root.
7. Start normal services only after the canonical store validates.
8. Remove an old directory only after it is empty and the canonical copy has
   been verified.
9. Do not keep an indefinite read/write fallback to both roots.
10. Never delete unowned roots merely because their names resemble TE2.

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
- `npm run typecheck` and `node build.mjs` in `file_editor_cm6`;
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

### Phase 3 — Canonical XDG roots and state migration

This phase is split so the highest-risk durable state does not move in the same
change as rebuildable caches.

#### Phase 3A — Shared path contract and rebuildable caches

- add language-appropriate path helpers backed by the same documented XDG
  contract;
- move the Rust build cache beneath `te2/framework/build`;
- move TE2 console and TE2-owned Framework-Shells cache paths beneath `te2`;
- normalize code-server download/probe and desktop build caches;
- stop new writes to feature-specific cache roots;
- add path-resolution and environment-override tests.

#### Phase 3B — Framework settings, state, jobs, and bookmarks

- move durable framework stores out of `termux_extensions` cache;
- preserve schema and API behavior;
- migrate atomically under a versioned lock;
- reconcile Python jobs with the Rust-owned framework path contract.

#### Phase 3C — Code TE2 drafts, history, preferences, and runtime files

- migrate `cm6_editor/projects` first and verify every draft index/sidecar pair;
- migrate history, preferences, icons, and active Code TE2 data from
  `termux-extensions-2` into `te2/code_te2`;
- remove or migrate the unused `cm6_sessions` sidecar path only after proving
  its helper methods have no live callers;
- move the Sidebar backchannel socket to the runtime root;
- decide whether TE2's managed code-server should receive a private
  TE2-owned user-data/extensions root instead of sharing `~/.config/code-server`.

#### Phase 3D — App-local and client-local paths

- move TE2-owned per-app state beneath `te2/apps/<app_id>`;
- retain Electron configuration under the canonical TE2 config root;
- classify and clean old Electrobun/CEF and Android-install scratch roots only
  with explicit filesystem-deletion approval;
- leave external/unknown caches untouched and report them.

Validation:

- migration tests with old-only, new-only, identical-both, divergent-both, and
  interrupted-migration fixtures;
- permission and atomicity tests;
- Code TE2 draft recovery test using real sidecar content;
- framework settings/state/bookmark/job persistence tests;
- desktop settings/assets and Framework-Shells restart-reuse tests;
- post-migration scan proving current source no longer writes legacy roots.

Exit criteria:

- active TE2 writes occur only under canonical roots;
- durable state is present and validated at the canonical destination;
- legacy roots are either removed when empty or explicitly reported with a
  reason they remain.

### Phase 4 — Current-product naming cleanup

#### Phase 4A — Safe internal and package names

Proposed target shape:

```text
framework/
  bootstrap/
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

Compatibility aliases may read old environment variables for one documented
transition window, but canonical writes and logs must use only the new names.
The `te2` command is canonical; retirement of `te2-rust` is a separately
tracked compatibility decision.

#### Phase 4B — Public identifiers and truthful `cm6` names

Audit before changing:

- `file_editor_cm6` app id and URL/Socket.IO routes;
- manifests, asset inventories, Android interception, Electron contracts, and
  persisted sidebar/run-profile state;
- CSS/DOM/storage keys; and
- names that still correctly describe an embedded CodeMirror 6 component.

If the public app id is renamed, provide an explicit alias and persisted-state
migration. Do not mechanically replace every `cm6` occurrence.

Validation:

- editable and installed-package launch tests;
- wheel/sdist contents and bootstrap discovery tests;
- Rust workspace build/test after crate/path rename;
- Electron typecheck/build/package after source-directory rename;
- stale-name scan categorized into active compatibility aliases and historical
  documentation only.

Exit criteria:

- no supported component identifies itself as a spike;
- remaining historical names are intentional and documented.

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
3. TE2-owned state is consolidated beneath canonical XDG `te2` roots without
   losing drafts, settings, extensions, or runtime assets;
4. supported framework and desktop source/package names no longer say `spike`;
5. public legacy identifiers are either migrated or explicitly retained for a
   documented compatibility reason; and
6. UI VSIX work has a separate approved plan based on the cleaned framework.
