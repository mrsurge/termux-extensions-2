# Editor loading maintenance

## Goal

Reduce TextMate/file-opening latency and eliminate avoidable round trips,
race conditions and repeated work. Treat every backend connection, including
localhost, as potentially high-latency and low-throughput. Markdown is the
priority reproduction case; model size and grammar dependency cost must be
measured separately. Preserve existing backend authority and readiness contracts.

## Scope and procedure

1. Trace file intent through content projection, selected theme/catalog,
   grammar dependency loading, model attachment and first highlighted render.
2. Record request counts, bytes, sequential dependency waves, cache hits/misses,
   invalidation reasons and stale-open cancellation. Distinguish cold client,
   warm reopen, file switch and reconnect; do not infer a race from latency alone.
3. Compare Markdown with plain text and another grammar at comparable sizes.
   Include fenced embedded languages, primary/secondary views, and rapid switches.
4. Propose source-backed fixes in coherent slices, with approval before edits.
   Reuse existing revision-scoped batched grammar loader and disk-backed
   installation/projection mechanisms rather than adding parallel authority.
5. Validate synthetic/regression behavior under delayed replies and restricted
   throughput, then perform explicit native-client live acceptance.

## Initial source orientation

- `monaco_editor/editor_textmate_runtime.ts`: catalog/factory/provider preparation
  and projection reset; document preparation awaits grammar installation.
- `monaco_editor/editor_textmate_grammar_loader.ts`: revision-scoped memory cache,
  single-flight bodies, batches of 16 and at most two active batch requests.
- `textmate_projection.py`: backend catalog and grammar-body projection.
- `docs/apps/code_te2/CODE_TE2.md`: theme/TextMate and foreground/reconnect contracts.

These are audit entrypoints, not established causes. Investigate dependency waves,
invalidation and payload duplication before choosing prefetch/projection changes.

## Repeatable offline probe

Requires Node 24 and the existing vendored TextMate module; no server/device access,
file writes, Oniguruma execution or tokenization. It imports the production body
loader with Node type stripping. Node may report the existing package's unspecified
module type; do not change production package semantics just to silence this probe.

```bash
node scripts/probe_textmate_loading.mjs --extensions /path/to/vscode/extensions --scope text.html.markdown --latency-ms 200
node --test tests/textmate_loading_probe.test.mjs
```

Repeat `--extensions` for additional installed roots; this offline inventory does
not apply the live extension registry's enablement policy. Optional
`--bytes-per-second` simulates one serialized downstream link. Raw-byte counts omit
transport overhead/compression; simulated latency is per RPC, not a measured RTT.
The probe does not model production timeouts. Each run recreates the TextMate
registry, deliberately testing body-cache reuse rather than installed-provider reuse.

## Implemented production slice (awaiting publication/live acceptance)

`editor.textmate.closure.get` takes `scope`, `revision`, and `knownIds`. It resolves
reachable full/partial repository rules, nested repositories, `$base`/`$self`,
cycles and prefix-matched injections against the existing backend registry. Grammar
reads retain installed-root, size/mtime and revision guards. JSON uses the existing
persistence codec; plist support is lazy stdlib-only. Parsing is for dependency
discovery, not tokenization. No WBA initialization is required.

The reply contains `revision`, `rootScope`, `complete`, closure `ids` and missing
`bodies`. The bounded preload admits at most 256 bodies/8 MiB of raw closure data.
An oversized closure returns a bounded prefix (`complete: false`); the factory's
existing guarded batched reads cover dependencies beyond that prefix. Resource,
parse and revision errors are not masked by this optimization. No blanket preload
of every installed grammar is performed, and known IDs do not bypass disk guards.

The browser seeds its existing revision-scoped cache atomically, shares concurrent
closure requests and rejects stale replies. Revision reset immediately releases
pending closure waiters; no uncertain request is replayed. The preload uses the
factory's actual language-to-scope mapping, not a separate preferred-scope guess.
Successful same-scope preparation is reused for the current revision.

Contribution refresh reads current catalog metadata first: unchanged revision keeps
installed providers/factory/bodies, while a changed revision invalidates them.
Concurrent refreshes are serialized/coalesced; a failed read preserves current
state and remains retryable. Theme refresh keeps its independent existing owner.

For live testing: rebuild/activate the matching mypyc domain, obtain approval for
the appropriate app-worker lifecycle transition, and explicitly OTA/update client
assets. New RPC and frontend require matched publication. Synchronize release-facing
versions before any release/client packaging; this slice does not bump or publish
a version. No client/framework restart has been performed.

## Follow-up maintenance workstream

Loading behavior is user live-accepted for reload reuse, poor-connection file
switching/reconnect/secondary editors and Settings/Run Profiles JSON grammars.
Instrumented traffic counts and release/all-device validation remain distinct.
The user follow-ups in TRACKER.md are now planned work, not implicit additions
to the completed loading scope. Each implementation slice needs concrete approval.

### F1 — Extension marketplace and registry

Start with existing `src/explorer/extensions/marketplace-controller.ts`,
`explorer/handlers/extensions.py`, `explorer/services/openvsx_marketplace.py`
and `extension_registry.py` under Code TE2. Marketplace detail actions currently
expose install/update/uninstall; schema-bearing installs already call `onInstalled`.
Reuse `explorer.extensions.configSchema.get`, `explorer.extensions.configure` and
`explorer.extensions.list` for installed-extension settings access and an installed
list/filter. Do not create a second registry or configuration authority.

Investigate the reported astral-sh.ty installation issue with the exact extension
ID/version/platform, install request/result and WBA restart logs. No cause is
established yet. Separate installation failure, platform selection, activation and
UI-list visibility; avoid promising one fix resolves all four.

The overlay now grows through two mutually exclusive collapsible headers:
Marketplace and Installed, with the expanded panel owning the remaining viewport.
Installed rows use one existing registry list request, filtered to user extensions;
selection reuses marketplace detail metadata with installed local fallback. No
per-row Open VSX fan-out. Keep built-in inventory in the existing settings manager.
README is an expandable section below action buttons and loads only on demand via
the existing detail RPC with validated `readme`/exact `version` parameters.
Open VSX metadata supplies `files.readme`, not an inline JSON Markdown body.
The worker limits remote/local bodies to 1 MiB, guards remote redirects before
following them and rejects installed-path/symlink escapes. Local package-derived
registry metadata is enough for fallback; XML parsing is unnecessary.

Vendor MIT streaming-markdown 0.2.15 with provenance; render using its DOM parser
and reuse the editor-owned TextMate runtime, with oversized/unknown code fences remaining
plain text. Prose/images wrap to the viewport; code and tables own horizontal
scrolling. Links/images admit HTTPS URLs only; raw HTML remains inert. Selection
generations discard late README results. Search/Changes/review snippets and README
fences share the primary editor's grammar factory, revision/body loader and selected
palette. Syntax is asynchronous and never gates rendering; match/diff wrappers
retain ownership. Snippet-only preparation does not install Monaco providers.
Theme/catalog invalidation refreshes bounded weakly tracked connected surfaces;
delayed paints require matching element/content/render generation. Highlight.js
is omitted from the host graph, not lazy-loaded. Its unused vendor source remains
a separate asset-cleanup candidate, not an active dependency.
Backend changes require a matching compiled-domain rebuild and approved worker
lifecycle, while native frontend changes require explicit client asset update.
Acceptance: existing/new installs, uninstall, settings save, no-schema extensions,
installed-list refresh and WBA recovery without page reload. Python changes require
the matching mypyc rebuild; frontend changes require correct client publication.

### F2 — Shared file picker

Approved shared-provider experiment: use one neutral file-icon adapter across
picker, Explorer/sticky directory scopes, file tabs, breadcrumbs, History and
Changes. Preserve the existing complete filename classifier and explicitly map
every semantic family to the shared monochrome provider; normalize JS/Python/TS suffix families.
Use ALS's CC0 Simple Icons SVGs for Rust/JavaScript/TypeScript/Python and existing
Seti SVGs for other code families (including C/C++), rendered as currentColor
masks. Codicons remain for directories and non-language types.
Directory icons use muted folder glyphs without geometry changes. Retain Seti
vendor assets for now; do not add a provider preference in this slice.

Lazy-icon follow-up preserves all exact-name/extension/partial rules but owns
their lookup inside the neutral helper. Definitions load once; only rendered code
families fetch individual trusted SVGs, single-flight/cached by family. Failed
loads retain Codicon fallback, with 5s abort and 64KiB streamed-body bounds.
Generate/check the full individual asset set with
`node scripts/build_file_icon_assets.mjs [--check]` before asset publication.
Seti wrapper/icons.json and ALS four-icon module are no longer runtime imports;
retain them as legacy/source-generation inputs for this trial. This optimizes
external icon resources, not host.js bundle size. No backend or Android source
changes are needed; matching client OTA remains a separate approval/acceptance.

`app/static/js/file_picker.js` now selects directories on one click/tap and enters
them on double click/tap (touch interval 450ms). Space selects, Enter enters a
directory or confirms an eligible file; arrows/Home/End move row focus. Explicit
Select Current, breadcrumbs and save/file modes retain their existing authorities.
Optional case-insensitive regex filters only names in the fetched current listing,
with no extra browse requests or recursive scans. A disposable worker bounds
pattern/name input and has a 500ms deadline; invalid/unavailable/slow filters show
an error, not a synchronous fallback. Browse and filter generations reject stale
responses. Shared vendored Codicons replace row emoji with muted grey-blue
directory/file-type glyphs and a generic file fallback. File classification shares
the Explorer's existing filename mapping through a definitions-only `getIconName`
lookup; the picker translates those semantic types to Codicons, without loading
Seti SVGs/colors. Specific Python/Markdown/Ruby/etc. glyphs are preferred; remaining
known languages (including JavaScript/HTML) use file-code. No new icon library.
Acceptance: mouse/touch/keyboard directory selection versus navigation, all picker
modes, empty directories and invalid regex. Shared assets have multiple consumers.
Source regressions pass; installed-client OTA/live acceptance remains pending.

### F3 — Editor and detached Desktop polish

Add **Collapse all** to the Code TE2 source Explorer's ellipsis menu and change
its horizontal ellipsis to a vertical ellipsis. Reuse existing tree expansion
authority/actions and menu/icon conventions; inspect search-mode and sticky-scope
effects before implementation. Acceptance: nested expanded trees collapse
consistently, file selection is preserved, and desktop/mobile menus and sticky
scopes remain correct. This targets the editor Explorer, not standalone File Explorer.

Add detached Sidebar-window minimize through the existing validated native surface
contracts/registry (`desktop_client/electron/src/{shared/sidebar-surface-contracts.ts,
main/sidebar-surface-registry.ts,surface/index.tsx}`), not main-window control:
`window_control` currently minimizes `mainWindow` in `src/main/index.ts`.
Inspect the actual detached chrome/action dispatch before editing.

Trace draft character/line styling from `editor_draft_diff_runtime.ts` to its
authored CSS/theme owner; reduce highlight opacity while retaining ranges,
readability, review semantics and theme contrast. Do not alter Monaco fork output
without demonstrating that the authored layer cannot own the change.

Palette default should open the unprefixed picker/help state, not forced `>`.
`editor_quick_input_keys.ts` currently maps P to `editor.action.quickCommand`;
inspect palette entrypoints and Monaco quick-access providers first. Preserve
explicit command mode and symbol/line modes. Clarify whether requested `ctrl, :`
means a chord or Ctrl+colon, and check Ctrl+Shift+P conflicts before binding.
Acceptance: detached target-only minimize/restore, light/dark draft contrast,
mobile/desktop palette modes, physical and virtual keyboard existing shortcuts.

### F4 — File Explorer larger features

`app/apps/file_explorer/main.js`, `template.html`, `file_explorer.py` and shared
`te_file_explorer_intents.mjs` already provide Open in Terminal intents. No embedded
drawer/session owner was found in this preliminary inventory.

**Revised user direction (2026-10-10):** durable identity belongs to disk-backed
File Explorer **tab sessions**, not ephemeral presentations. Each tab stores its
path/options and associated terminal shell if active. Open Sidebar state may
reference a tab session; multiple presentations/clients may intentionally attach
to the same session, but unrelated sessions never collapse onto one global tab
or shell. Terminal app lifecycle is now the primary behavioral reference, with a
JSON-backed session record replacing the live shell as lifetime authority. ALS
conversations remain a secondary persistence reference, not a dependency.
Determine existing state-store and ownership seams before selecting schema or
storage schema; the existing `te2_app_data_home('file_explorer')` resolves durable
records under `TE2_DATA_HOME/app_state/file_explorer`, not disposable build caches.

**Shared session synchronization:** File Explorer owns path/options and the last
associated terminal shell ID in that record. Shell exit/explicit terminal close
invalidates the shell association without deleting the session; persisted IDs
must be reconciled against actual shell authority before reuse. Sessions survive
without a visible window. Code TE2 stores a session reference in Sidebar state,
not the authoritative current path. New unbound windows show the splash/session
list; explicit fresh path intent creates, existing session ID attaches.

Use the already vendored Socket.IO client and Python Socket.IO ASGI server for
File Explorer's own session lane. Backend-controlled rooms group authorized
attachments by session ID; do not accept arbitrary renderer-provided room joins.
Navigation/update requests carry presentation identity, operation ID and expected
revision. Serialize/validate/persist changes before emitting a monotonically
revisioned session snapshot. Acknowledge the author without redirecting/remounting
its view; notify other attached socket IDs, including other windows on that same
device. Receivers apply without echoing a new mutation. Reconnect rejoins and
obtains the authoritative snapshot; fence obsolete async listings and ignore
stale revisions. Disconnect does not close a session or replay uncertain writes.
Deletion notifies attached presentations and leaves no implicit recreation.

**Import-graph reduction before Rust hosting:** remove File Explorer's FastAPI
router/dependency-injection layer in a separate coherent slice before session
implementation. Use the existing app-worker `TE2_ASGI_APP` export seam with an
explicit raw ASGI HTTP dispatcher and Socket.IO composition, retaining Uvicorn,
existing framework pipe/job/intents and response/error/download contracts. This
must eliminate transitive FastAPI/Pydantic imports for this worker, not merely
replace one import statement. Bound request bodies and validate query/body DTOs
explicitly; retain streaming downloads, containment checks and method/error
semantics. Measure import closure before/after and defer expensive job/archive
helpers where safe. Do not remove project-wide dependencies until all consumers
are migrated. Rust hosting/compilation is a later separately approved step, not
a prerequisite for the Python session lane.

Implementation order: (1) raw-ASGI/import-graph migration with compatibility
tests, (2) durable session store plus Socket.IO rooms/snapshot protocol,
(3) fresh/restore/splash frontend and backend-owned Sidebar session publication,
(4) terminal association/drawer integration and remaining F4 features.

**Typing/compilation prerequisite:** the entire File Explorer Python backend,
including job helpers, must have explicit parameter/return types, no explicit
`Any`/bare generics, checked object-boundary narrowing and concrete progress
state. Strict mypy is the primary gate (`--strict --disallow-any-explicit`), with
ty/basedpyright additional checks and a standalone mypyc group build/import
probe. This does not imply migrating shared external job/pipe libraries or
automatically activating compiled modules in the worker. Session DTOs/protocol
must extend this typed foundation; mypyc is the intended compilation direction.

**Mount/create lifecycle:** query intent is typed, not inferred from the presence
of any query string. A fresh Code TE2 Explorer directory-open request creates a
new File Explorer session at that path. A query carrying an existing state/session
ID mounts that exact record; restored Sidebar state supplies that ID. Routing,
client, host and presentation metadata alone must not create sessions. After a
fresh creation, replace the mount URL with its resolved session ID and publish
that identity through the existing backend-owned Sidebar state path, so page
reload, iframe recreation and Code TE2 Sidebar restoration do not repeat creation.
Distinguish the durable session ID from client/presentation IDs. Missing/deleted
session IDs fail visibly or return to the list, never silently create a replacement.
Creation correlation/idempotency and cancellation must be defined before mutation
wiring; URL replacement alone cannot protect delayed/concurrent creation.

Opening without a session/fresh-path intent shows a session-list/splash page with
New session and Close session actions. Closing a session ends its active terminal
if any; a mounted session requires a warning modal. Presentation closure/unmount
is not session closure. Explicit Close terminal may end/disassociate its shell
without deleting the retained File Explorer tab state. Inspect ALS's existing
conversation mount/state flow as a reference; do not add an ALS dependency.

**Launch-context refinement:** call sessions **tabs** in the UI. A bare Sidebar
launcher opens the splash; New tab resolves the current project through the app's
backend Sidebar CWD hook. An explicit fresh `path` opens a new tab directly.
An explicit `tab_id` restores exactly that record (even if a path is also present);
a closed/missing ID returns to the splash without replacement creation. A bare
Framework launcher restores the last tab ID in localstorage, never a stored path
as authority; if missing, the splash's New default is Home. Viewing the tab list
does not erase the last-active-tab hint. Durable state remains shared on disk.

Create correlation is retained before sending: fresh standalone URLs carry
`tab_create`; fresh Sidebar creation uses its existing unique host-slot identity.
Backend creation receipts prevent reload/concurrent creation from duplicating
tabs and retain closed-record receipts so an obsolete fresh URL cannot resurrect
a closed tab. Successful creation replaces `path`/`tab_create` with `tab_id` and
publishes only that reference through the existing backend Sidebar state hook.
The initial store admits 512 tabs, 8192 retained creation receipts and 4 MiB;
exhaustion is explicit, not silent eviction of restore authority. Future receipt
compaction needs a separately defined stale-launch policy.

**File selection and icons:** reuse the shared file picker's complete file-icon
rules/helper and Codicon directory styling, including semantic-family lazy assets;
do not build another extension map. Remove file-row and select-all checkboxes, not
permission/settings controls. Desktop Shift-click selects an anchored range,
Ctrl/Cmd-click toggles discontiguous items, and Ctrl/Cmd+Shift-click adds a range
without dropping previous selections. Icon buttons toggle selection on both
layouts; text/body keeps single selection and double-click opening, with long
press/right-click opening the existing context menu. Context on a selected item
preserves the batch; on another item it selects only that item. Directory changes
clear the anchor; sorting uses the current displayed order with the same path anchor.
Preserve relevant batch actions and do not accidentally open an item after a
selection gesture. Show a Clear selection button at the top while selection exists;
Esc clears selection on both desktop and mobile without stealing dialog/input
escape ownership. Define ordinary click/open, anchor reset, sorting/filtering and
context-menu batch-preservation rules before implementing.

Hiding/minimizing the drawer, page reload, or closing its presentation retains
the associated live shell; only explicit Close terminal ends it. An exited shell
is disassociated, never restarted/reopened implicitly. Session restore must verify
live ownership/capabilities rather than treating a persisted shell ID as proof.
Drawer supports minimize/maximize. **Lock directory** is a durable tab-owned
boolean, default on, synchronized to every attached client through existing tab
events. It follows explicit browsing-directory changes only: manual terminal cd
is preserved until another browse navigation, and switching tabs/restoring views
or reconnecting never requests cd. Unlock cancels pending tracking and leaves CWD
unchanged; re-lock arms future navigation without an immediate cd.
Approved implementation uses new-shell-only Bash --init-file startup, normal
login-profile sourcing, preserved prompt hooks/status and private per-shell
revisioned path mailboxes. Bash applies the latest request once at a prompt,
never by injecting command text into foreground programs/Readline. The actual
login_shell flag is off (Code Server-style startup compatibility tradeoff).
Existing shells remain untouched and report tracking unavailable until explicit
close/new start. Applied/error status follows shell acknowledgment, not transport
write success. No polling, uncertain replay or automatic shell replacement.

Reuse Code TE2's shellspec/shell and **exact Pyte screen-projection setup**, with
the standalone Terminal's frontend/custom xterm, mobile handling, key rules and
extra-key layout. This supersedes the preliminary standalone Node/headless-xterm
choice for this new drawer; the existing standalone Terminal itself is unchanged.
Inspect extractable service contracts before importing project-bound Code TE2
assembly or copying a second implementation. Explicit approval of a concrete
implementation/validation slice remains required.

Corrected worker boundary (2026-10-11): File Explorer is an ordinary Python app
worker and should use the existing Framework-Shells Python API, as Code TE2 did
before its native-worker migration. The additional uncommitted Rust shell-core
extraction was reversed; do not impose Code TE2's PyO3 hosting requirement on
File Explorer. Retain the committed shared Pyte projection, inject File Explorer's
normal raw-log reader, and use an app-owned PTY shellspec/manager adapter with
tab-specific labels. Backend shell lifecycle/association/checkpoints precede
event-driven output and drawer UI. See app/apps/file_explorer/TERMINAL.md.

Extra terminal keys are shown only for mobile user agents, not merely narrow
desktop windows; desktop user agents must not render the extra-key controls.

Add depth-one regex listing and `du -h --max-depth=1`-style usage presentation.
Pair the current-directory regex filter with picker-style keyboard navigation:
arrows move focus through the displayed/sorted entries, Home/End reach the ends,
Space toggles selection and Enter opens the focused entry. Keep focus distinct
from batch selection and leave terminal/input key handling untouched. Reuse the
bounded shared regex worker; directory usage remains a separate backend slice.
Directory usage should use the framework filesystem service over its existing
worker pipe. File Explorer already calls `fs.listDirectory` through `service.fs`
(NID 2100); extend that service with a usage operation rather than introducing a
separate subprocess transport. The Rust service owns traversal and aggregation;
the File Explorer backend owns request/tab association and projects results to its
frontend. A depth-one result still requires recursive traversal below each child.
Investigate existing scheduler job/progress/cancellation support before choosing
the exact method contract. Keep scans user-triggered, bounded and cancellable,
preserve ordinary listing responsiveness, report incomplete/error results, and
define allocated versus apparent bytes, hard-link accounting and symlink policy
before implementation. The frontend must discard results for superseded requests.
Style the regex field using existing field colors/geometry. Typing from a focused
entry starts filtering (Space stays selection); Backspace navigates up, and Delete
uses the existing warned deletion flow for selected items or the focused item.
Context menus support arrows/Home/End, and Escape restores their invoking item
without reaching page-level selection clearing. Text fields and terminals retain
their own keyboard handling.

File Explorer frontend modularization is staged, with one minified app entry:
first extract strictly typed viewport/keyboard/menubar controllers and typed
presentation contracts; keep the existing terminal controller independent.
Source CSS/markup live under `app/apps/file_explorer/src/` and compile to the
existing inline template style delivery. The stable manifest mount adapter loads
the generated app module from the already-published `/static/js/` tree. Keep
regex work on its bounded worker, and preserve shared runtime asset URLs.
Then extract validated API/DTOs, tabs/splash, actions/properties/bookmarks and
jobs before strictly typing the reduced composition root. Do not claim remaining
JavaScript orchestration is typechecked during the first slice. See
`app/apps/file_explorer/FRONTEND.md` for source/output and navigation contracts.
The approved API/tabs slice validates the host's already-unwrapped app responses
and backend-owned tab records. Keep nullable create/attach results, serialized
directory/terminal mutations, read-only reconnect resync, and generation fences;
stale mount or same-tab mutation ACKs cannot replace a newer selection. Typed
splash/menu controllers own presentation, not tab or sidebar authority. Global
jobs/bookmarks/archive endpoints remain outside the app HTTP facade.
File actions capture selected targets and originating tab/directory before
dialogs or pickers. Presentation epochs fence away-and-back transitions, while
ordinary same-directory refresh retains the active operation context. Properties
fetch/focus/Apply use captured dialog identity; supersession stops later mutation
steps without retrying or undoing an already-issued operation. Direct copy/move
fallback is only for absent job capability, never after an attempted job POST.
The final frontend slice extracts bookmark/job controllers and converts the
composition root to strict TypeScript. Runtime host/dialog/picker/socket values
are validated; same-root remount and final page exit dispose controllers and
listeners without closing backend tabs/shells. Bfcache observation resumes by
existing resync. Pending listings cannot render old entries through filter/view
changes. Validate integrated startup/disposal as well as controller regressions,
then publish matching native assets before exact-client live checks.
Prefer existing framework filesystem/pipe services; first inspect support for
bounded aggregation, cancellation, errors, symlinks and permissions. A depth-one
display can still require recursive byte accounting: define that cost explicitly,
keep it asynchronous/user-triggered and avoid blocking ordinary directory listing.
No polling or frontend-owned durable terminal state.
Acceptance: independent clients/presentations, sidebar/standalone lifecycle,
session retention/removal, regex errors, large trees and denied paths.

### Execution order and gates

F1 → F2 → F3 → F4. These are independent coherent slices; a demonstrated urgent
bug can change the order with user approval. Preliminary source findings are not
completed implementation designs. Each slice requires targeted regression tests,
appropriate typecheck/build, correct installed-client asset publication and user
live acceptance. No Android changes, process restart, version bump or release is
authorized by this planning slice. Remaining stale-asset candidates stay deferred.

## Safety and publication

### Generic-browser HTTP gzip

Framework frontend files and native Code TE2 static files opt into the shared
`framework/asset_gzip.rs` response policy. Tower HTTP negotiates gzip only for
successful compressible asset GETs, streaming the compressed worker response.
Range/HEAD requests, already encoded bodies, failures and unmarked API responses
remain uncompressed; Socket.IO wraps the worker's asset service externally and
does not pass its polling/WebSocket responses through compression. Preserve
`Vary: Accept-Encoding` when adding CORS `Origin` variation.

This does not modify frontend source, client-local serving, APK seeds, OTA ZIPs,
or prebuilt packaging. Native clients normally bypass these server asset handlers
using their installed copies; upstream fallback requests can negotiate gzip too.
Both binary-cache fingerprints include the shared policy source. Activation needs
rebuilt framework/worker binaries and a separately approved runtime transition;
no current harness/framework restart is authorized. The UUID insecure-context fix
and preferred loopback ports remain separate follow-ups.

### Bundled Markdown-family cache and bounded misses

The native-local asset `monaco_editor/textmate/markdown-cache.json` contains the
72 built-in grammar bodies reachable from Markdown in Code Server 4.130.0.
Generate explicitly with `node scripts/build_textmate_cache.mjs <built-in-extensions-root> 4.130.0`;
ordinary frontend builds validate the artifact hashes, without consulting the
user's installed extensions. The existing TextMate asset tree is already in the
Android bundle and Electron local-serving inventory. No APK assembly is part of
this slice. Preserve the adjacent attribution/license when publishing.

The backend remains selection authority: `editor.textmate.closure.get` with
`metadataOnly: true` returns revision, selected IDs and SHA-256 fingerprints, not
large bodies. The browser verifies the local asset once with shared SHA-256 and admits
only matching ID/hash pairs into its revision cache. A missing/corrupt seed or an
extension override uses `editor.textmate.chunk.get`, limited to 64 KiB UTF-8 per
reply and two active streams. Offsets count Unicode codepoints, not UTF-16 units.
Every chunk revalidates revision/resources; its content fingerprint must remain
consistent. No WBA fallback or uncertain request replay is introduced.

Oversized closure prefixes still use TextMate discovery, with bounded on-demand
chunks beyond the prefix. Plain HTTP origins without WebCrypto use the pinned
JavaScript SHA-256 fallback for seeds and persistent bodies. Other languages reuse matching bodies from
this same family (including HTML/CSS); no language-specific selection rule changes.
This reduces cold grammar network payload, not TextMate's requirement to have all
reachable rules before constructing a grammar. Live high-latency acceptance is
still required, using a freshly OTA-published client and the interpreted diagnostic
worker (or a newly rebuilt matching compiled domain).

### Generic-browser grammar HTTP delivery

Keep compact editor-RPC closure selection, then fetch browser misses through GET
`/api/app/code_te2/textmate/grammar`. Logical ID and revision are required; closure
reads supply expected SHA-256. Dependency tails receive the current fingerprint.
Reuse installed-resource/root/stat/size guards and recheck revision after reading.
Native clients retain packaged-first loading and bounded chunk RPC.

Identity-bearing JSON uses existing negotiated gzip and no-store headers. Browser
admission checks identity/revision/hash and a four-MiB raw cap. Two active streams,
a 30-second deadline and bounded decompressed response reads constrain transfers.
Failures do not retry/fall back. Insecure origins skip the unverifiable seed
download. No WBA route, arbitrary file reader or new selection authority.

Activation requires rebuilt worker, matching interpreted/compiled domain and
browser assets. Source validation is not live acceptance.

No shared framework restart, device changes or network shaping without explicit
approval. Client-owned bundles require OTA or rebundled packages before native
testing; reload alone cannot publish changes. Compiled Python changes require a
matching mypyc rebuild and approved worker lifecycle transition. No version bump,
tag or release in the investigation slice. Electromux remains a separate workstream.

## Deferred follow-up sequence

Markdown cache and browser HTTP grammar loading are implemented and user accepted
on the observed paths. Continue in this order:

1. **Restore compiled execution.** Rebuild/validate the current matching-ABI mypyc
   group and restore the shellspec's `CODE_TE2_MYPYC_DIR` environment substitution.
   Obtain explicit app-worker transition approval, then verify accepted loading
   and extension-restart behavior in compiled mode.
2. **Stable native loopback origins.** Inspect all four clients and use existing
   relay ownership for a preferred port with a free-port fallback. Preserve
   upstream routing/security and client identity. A fallback port still changes
   the browser storage origin; account for that explicitly.
3. **Socket compression investigation.** Assess polling gzip separately from
   WebSocket compression using actual Rust/Node transport capabilities. Measure
   latency, bytes, CPU and memory before enabling anything, especially on Android.
   Existing asset gzip does not compress sockets.
   Offline real-payload POC now demonstrates another route: capability-negotiated
   application-level gzip around existing MessagePack bytes, leaving Socketioxide
   binary carriage unchanged. This is distinct from native WebSocket compression
   and does not require an Engineioxide fork. Before implementation, design
   matched-peer negotiation, strict frame/expansion limits, ordered asynchronous
   browser decode, queued-byte backpressure and disconnect-generation fencing.
   POC evidence is in TRACKER; production codec changes remain approval-gated.
   Approved first implementation slice: `/rpc/editor` only, optional exact
   `msgpack-gzip-v1` connect authentication alongside unchanged `msgpack-v1`.
   Rust frames responses and compresses only at >=1 KiB when smaller; browser
   requests are raw framed MessagePack (synchronous, no client compression queue).
   Python only validates the negotiated name; no Python byte-codec dependency.
   Bound wire and declared output to the existing 8 MiB budget, decode serially
   with queue byte/count bounds and cancellation/deadline/generation fencing.
   Other lanes remain unchanged. Validate malformed frames, ordering, disconnect,
   mixed-client fan-out and Rust/browser interoperability, then frontend/native
   builds. No live restart, OTA/APK, version bump or release in this slice.
4. **Persistent grammar caching.** Design cross-reload reuse with stable origins
   where available and backend revision/ID/hash invalidation. Preserve native
   packaged-first loading, bounded storage and verified admission. Choose storage
   from evidence, not an assumption of localStorage; no new selection authority.
   Approved frontend-only implementation uses origin-scoped IndexedDB
   `te2-textmate-bodies`, with exact logical-ID/SHA-256 content keys. The existing
   revision-scoped memory and matching packaged bodies precede persistent reads;
   current closure metadata remains authority. Verify stored hashes before reuse.
   A batched metadata-first read admits <=8 MiB before cloning bodies, with a
   250ms read deadline; unavailable storage or failed verification is a miss. WebCrypto
   is preferred, with pinned JavaScript SHA-256 when unavailable. Background
   writes hash-verify fetched bodies, retain <=512 records/32 MiB UTF-8 body
   bytes and evict oldest stored records in the same write transaction. This is
   an application data budget, not a promise of browser database disk overhead.
   Writes/eviction never gate model mounting; queues retain <=256/8 MiB per batch.
   Existing HTTP/RPC paths and generation fences remain unchanged. No Python,
   Rust, APK or mypyc rebuild is needed; native live validation requires OTA.
5. **OTA compression investigation.** Inspect existing archive compression and
   native update/download/extraction flows before proposing changes. Measure
   transfer savings, CPU/memory, integrity checks and backward compatibility
   independently of browser HTTP gzip. Preserve installed asset inventory and
   atomic activation; no OTA format/client changes without separate approval.
   Source inspection confirms existing Deflate ZIP delivery across Android and
   Electron. The offline manifest comparison recorded in TRACKER.md supports
   retaining the current format/default level: stronger compression saved only
   about 0.55% against level 6 while substantially increasing preparation time.
   These are Python/zlib proxy measurements, not native Rust/device timings.
   No updater or compression-policy change is warranted by this evidence.
6. **Finish the loading audit.** Cover cold/warm comparison languages, rapid file
   switches, reconnect and primary/secondary editors under poor connections.
   Separate tokenization, transport latency and model readiness; act only on
   demonstrated inefficiencies or races.
7. **Unused vendored/stale asset inventory.** Separately audit source references,
   build inputs, dynamic runtime loaders, native interception inventories and
   OTA/APK/wheel packaging manifests. Distinguish genuinely unused assets from
   required runtime dependencies and intentional compatibility copies; absence
   of a direct import is not removal evidence. Report candidate paths, sizes,
   consumers and confidence, including any unresolved dynamic use. This step is
   read-only: deletions, manifest changes and rebuilt publication require a
   separately approved concrete plan.
   Preliminary findings are recorded in TRACKER.md. Prioritize individually
   proving legacy packaged grammar consumers, keeping the settings JSON grammar;
   do not confuse already-excluded development backups with shipped savings.
   Monaco ESM and prebuilt contribution chunks remain required build inputs.
   Approved first cleanup removes the 91 unconsumed legacy grammar files only;
   retain the settings JSON grammar, verified Markdown seed and tokenizer/theme
   resources. Remaining inventory candidates are not deletion-approved. Native
   installed trees need explicit OTA/package replacement to receive this trim.
8. **Maintenance release integration.** With separate release approval, synchronize
   versions and package matching domain/worker/framework artifacts, frontend
   assets and staging APK seeds. Validate provenance and target installs before
   merge/tag/publication. No release is authorized by this documentation update.

Each implementation slice still requires concrete scope approval. Documentation
approval does not authorize builds, client changes or runtime restarts.

### File Explorer terminal drawer checkpoint

File Explorer terminal UI checkpoint: ordinary Python Framework-Shells plus
shared Pyte now has an authored TypeScript xterm drawer, exact-tab live output/
exit observation, reconnect checkpoints, explicit start/close and minimized/
maximized presentation. Build with `node build.mjs` in `app/apps/terminal`;
typechecking there includes the drawer. The next acceptance gate is refreshing
the File Explorer worker and native OTA, then checking input/output, tab restore,
two presentations, explicit closure and mobile-only keys. Directory-lock shell
injection remains separately deferred; no shared-framework restart or release
is authorized by this checkpoint. Detailed contract: File Explorer TERMINAL.md.

### Stable native origin implementation

Electron persists its per-install preferred port in
`TE2_CONFIG_HOME/desktop-framework-relay.json`, separate from endpoint settings.
First publication is complete-file/non-overwriting; invalid stored configuration
fails explicitly rather than silently rotating the origin. Android persists
`framework_relay_preferred_port` in app-private `android_app_settings`, shared in
source by Gecko/Cefrium/TE2 Termux but private to each installed package.
Generated ports are in 49152..65535. Normal settings writes do not change them.

Existing relays bind directly, falling back to port zero only for address
collision. The preferred value is never replaced by a fallback port. Retarget
keeps the live listener; preferred/actual/fallback values are logged. This is
storage convenience, not client or remote-host identity. No security bypass,
storage migration, Python change or automatic client restart is introduced.
Android deployment requires APKs; editor OTA cannot publish relay Kotlin changes.
# File Explorer shell-control follow-up

## Opt-in broker coordination proof

The Terminal broker now has an experimental `TERMINAL_STREAM_DIRECTORY_CONTROL=1`
path requiring an explicit `TERMINAL_STREAM_CONTROL_ROOT`. It selects app-owned
Bash init integration and admits typed `directory.request`; `directory.result`
and `shell.state` are broker output envelopes. This flag is not supplied by the
Terminal or File Explorer launchers, so ordinary sessions remain unchanged.

The proof uses Bash 4.4+ PS0 to mark shell-owned busy state before user command
execution, without replacing DEBUG/preexec hooks. The final prompt hook applies
pending intent and publishes idle. A clean-idle request wakes Bash through
SIGWINCH, not terminal bytes; the trap rechecks shell-owned state. Later input is
held up to 64 KiB until completion or a bounded two-second wake failure; partial
input conservatively defers to the next prompt. Busy rejections downgrade to
prompt-time application. Existing WINCH traps fail explicitly as unsupported in
this proof; composition and Termux signal behavior remain compatibility gates.

Current frontend transport is File Explorer `/tabs` WebSocket-only Socket.IO,
including input/output/checkpoints; standalone Terminal `/ws/terminal` is binary
MessagePack over a separate raw WebSocket. No frontend transport was changed.
Next integration should extract/reuse the broker session/pipe adapter without
importing Terminal's FastAPI backend into File Explorer. Keep durable tab identity,
shared checkbox authority, explicit close and no reconnect creation/replay. A
raw WebSocket frontend migration is optional and requires its own bounded
checkpoint/sequence/reconnect contract; it is not required for shell controls.

The prompt-only directory mailbox has a live-discovered gap: navigation at an
already idle prompt waits for Enter/a subsequent prompt. It is not accepted as
the final Nautilus-like behavior. Preserve the durable default-on tab lock,
shared-client ownership, explicit-navigation-only requests and no reconnect replay.

Approved direction: reuse the Terminal app's pipe-owned Node PTY broker and typed
MessagePack framing rather than inventing a second broker. Terminal output and
directory requests/results/shell-state events are separate envelope types. The
existing broker `ready` event proves spawn, not prompt readiness. The existing
frontend raw WebSocket transport need not become a control-authority surface.

An app-owned Bash init/rc hook is still required; do not edit user startup files.
First prove shell/broker coordination in isolation, then approve File Explorer's
PTY-to-pipe migration. An empty Readline callback can apply literal paths without
Enter and refuse unfinished input, but its wake-up bytes MUST NOT be sent to a
busy program. Prompt sentinels alone can be stale around command dispatch; typed
transport alone does not solve that race. Signal-only traps did not wake idle
Readline in the desktop probe. Next proof must address foreground programs,
blocking builtins, partial commands and navigation/input ordering before live
integration. The opt-in coordination proof above supersedes this initial
prototype-only status; the following approved integration supersedes migration-pending notes.

## File Explorer pipe-broker integration

File Explorer now launches the existing Terminal Node pipe shellspec, production
runtime resolver and typed MessagePack codec. Only these launches enable directory
control. Its small Python adapter subscribes to the exact live manager pipe and
serializes framed stdin writes; no Terminal FastAPI import, Pyte/log replay or
Code TE2 domain coupling is introduced. Control replies resolve independently
of the bounded event publisher, so tab-lock-held checkpoints cannot deadlock.

Socket.IO remains the tab/CRUD, directory and checkpoint command lane. The
approved latency follow-up sends input immediately over the already-authorized
raw terminal socket, with sequential backend handling and live SID/tab/shell
guards, rather than waiting for per-input Socket.IO acknowledgements.
Output temporarily retains its existing Socket.IO event with session-local byte
offsets derived from broker output; Node checkpoint sequences remain authoritative
for gaps. The user explicitly deferred a separate raw WebSocket output lane until
this broker integration works. Broker/prompt live acceptance has now passed;
the separately approved follow-up implements raw output and strict MessagePack
Socket.IO control together, modeled after standalone Terminal. Preserve tab-owned
shell identity, checkpoint fences and no mutation replay. Native OTA plus an
approved File Explorer worker refresh are required for live validation; no shared
framework restart, Code TE2 compiled rebuild or APK build is needed.

Old PTY sessions are not converted or silently replaced. Their exact signed tab
label permits explicit Close; other I/O fails closed. Restoration does not create
or cd. Unlock cancels pending directory intent through the broker then confirms
ordered control processing with ping; re-lock only arms future navigation.

Next live gate: explicitly approved File Explorer worker refresh and frontend
OTA, then new-terminal idle/busy/partial-input navigation, shared lock/peer state,
checkpoint reconnect and explicit close. No shared framework restart, Android
build, compiled Code TE2 rebuild or release is required/authorized by this slice.

### Prompt refresh correction

Approved frontend follow-up adds the standard top-edge terminal resize affordance,
bounded to the app's available content region and presentation-local. Reuse the
existing debounced viewport observation for terminal dimensions/checkpoints;
retain Minimize/Maximize and dispose pointer ownership on view transitions.
No backend transport, durable tab layout setting or Android changes are required.

Idle SIGWINCH changes CWD but leaves Readline's expanded prompt stale. The approved
correction uses a guarded empty accepted line after shell-confirmed clean-idle
application, holding later input until fresh idle. Normal Bash prompt hooks/PS1
generate the display; no Starship-specific renderer or injected cd command is
needed. Deferred application precedes prompt hooks, including bash-preexec's
precmd list (which can otherwise reorder ahead of PROMPT_COMMAND). Existing
terminal processes require explicit close/new start for the new init hooks.
Actual installed Starship/custom-hook and busy/partial ordering regressions pass;
physical acceptance remains separate.

### File Explorer terminal isolation correction (2026-10-11)

This supersedes the shared standalone-Terminal broker design above. The user
requested an app-owned pipe shell wrapping node-pty with directory-control
signals. Importing Terminal's source, launching its shellspec, or extending its
broker/build for File Explorer violates that boundary.

Restore standalone Terminal's source to its pre-File-Explorer behavior. File
Explorer owns its shellspec, Node worker/control hooks, dependency lock/runtime
bootstrap, MessagePack codecs and frontend build. Reuse only app-neutral Pyte
projection code under app/libs/terminal_runtime. Node appends canonical raw bytes
and forwards output without headless parsing. Python creates offset-bounded
checkpoints on demand; shell signals use a narrow split-safe OSC sentinel reader.
Keep current tab ownership, raw output socket, correlated Socket.IO controls,
directory lock, special keys and resizing semantics.

Validate both applications independently, including real Bash/Starship control,
checkpoint boundaries and reconstruction with a new Python owner. Existing
shells retain their executable code: live validation needs fresh terminal
sessions after File Explorer worker refresh. No shared framework restart or
release is required. The reported standalone latency is not proven to originate
in headless xterm: that parser/output queue existed before File Explorer work.
