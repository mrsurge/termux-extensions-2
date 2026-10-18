# 0.2.354 release finish plan

Consolidated 2026-10-15 at `2e77c843`. Source wins over historical planning.
This is the release cut line, not permission to reopen every unchecked old task.
Execution status, acceptance and the owning-document index are in TRACKER.md.

## Approval and release boundary

User approved documentation consolidation and read-only investigation, followed
by the two R1 proven asset fixes and focused regressions/audit updates recorded
in TRACKER.md. On 2026-10-16 the user also approved a staging-only native
compression switch and two same-source Gecko comparison APK builds, leaving
R8/debug/release unchanged. No runtime restart, installation, merge, version bump
or publication is approved. Obtain concrete scope approval for each remaining
implementation/build slice and separate release approval.

Subsequent 2026-10-16 approval covers staging R8/resource shrinking and a trial
APK build/artifact checks, retaining the accepted compressed baseline and mapping
file. That build succeeded but exposed a Kotlin/R8 metadata compatibility warning;
toolchain changes, installation and release acceptance are not implied. After
the JSON-corrected APK passed user live acceptance, the user explicitly deferred
the metadata warning/toolchain alignment for now; keep it visible, not suppressed.

Ship the existing bug fixes and accepted improvements. Finish bounded asset,
Gecko staging and keyboard ergonomics work; avoid experimental architecture.
The ALS framework-pipe/Sidebar IPC migration is explicitly next-version work.

## Ordered remaining work

### Project-scoped autosave and safe switching — approved 2026-10-17

User requires save-mode ownership in each ProjectSidecar, not global preferences,
and explicit Save All / Discard All / Cancel before enabling autosave. Projects
without a stored choice start in Draft Mode; never inherit legacy global true.
Confirmation captures the project, mode/draft revisions and connected editor
snapshots, then rechecks them before mutation. Pause supporting editors during
resolution; old assets without the acknowledgement cannot authorize mutation.
Only exact confirmed draft entries may be evicted. Multi-file resolution is
sequential, not transactional: report committed progress and never replay an
uncertain mutation. Preserve Unicode, CRLF, file mode and disk-base checks.

Additional approved prerequisite: keep existing full-model mirrors as durable
pending-write safety buffers, but move autosave scheduling into the backend.
The browser's active-tab timer cannot save a file after that tab changes.
Coalesce pending work by project/file before execution, fence mode revision and
project generation, and use the existing atomic writer without a snapshot round
trip. Retain/rebase newer edits during accepted writes. Only known own-write
ancestry with exact live disk proof may repair a delayed mirror's base; external
writes remain conflicts. Failure stops autosave, retains recoverable drafts,
publishes Draft Mode and blocks automatic replay of the failed admission.

Actual project switches flush pending autosave content before root changes and
retain the editor pause through the handoff. Draft Mode switches do not save
drafts. In-flight saves, mode transitions and project switches exclude one
another; conflicting/failed preparation must leave the switch unperformed.
Destination sidecar preferences are projected independently, with project and
monotonic mode-revision fences against late old-project responses. A cold worker
adopting interrupted autosave buffers recovers them in Draft Mode, without
saving/discarding; ordinary sidecar projection reads do not change modes.

Source checks/builds are in scope. Matching Code TE2 mypyc/source worker and
frontend publication/reload, live A→B→A/cold-start/Save/Discard/Cancel acceptance,
commits and releases remain separately gated. No shared framework restart or
Android changes are authorized by this slice.

Approved cursor follow-up: unify Manual Save, autosave and Save All own-write
watcher fencing. Suppress in-flight and duplicate own-write notifications rather
than reopening an already-current Monaco model; preserve genuine different-hash
external-change handling and newer pending buffers. Validate through the actual
watcher and existing save/draft/project-switch regressions. Matching Python/domain
activation and live cursor acceptance remain separate; no runtime restart.

User subsequently accepted the slice live, explicitly including project-switch
isolation and Save All / Discard All / Cancel. Full backend model projection is
deferred to the next version for a separate design/approval pass, not required
for this release and not additional mirroring work in this slice.

### Immediate user-note finish sequence — 2026-10-17

These clarified user notes precede the remaining R4 cleanup and R5 packaging.
TRACKER.md is the single current status owner; retain other plans as technical
references and historical evidence, not competing execution queues. Preserve the
original user notes verbatim in the tracker.

1. Detached Sidebar gap: show the last eligible docked presentation instead of
   blank space when the selected app is detached. Its icon continues to raise
   the detached window, even on repeated clicks. Focusing the visible docked
   presentation makes that presentation active. Keep detached window activation
   distinct from the presentation occupying Sidebar space; preserve client-local
   focus and shared membership. Investigate existing selection/focus owners first.
2. Project-switch draft hydration: opened files must send their full draft content
   to WBA on project restoration just as ordinary file opens do. Draft content is
   intended, not an erroneous entry in the open-model list. **Reopened after
   fresh live evidence**: startup foreground open read disk, a later client edit
   corrected it, and a subsequent same-file reopen read disk again. Earlier
   materializer/registry-only tests did not cover that production lifecycle and
   were insufficient to establish the requested behavior. The separately fixed
   diagnostic owner-clear operation did not resolve this content race.
   Approved correction: backend draft-first initialization travels in the
   existing local adapter connect/reconnect request; foreground opens attach to
   prepared documents without disk reads or synthetic client corrections.
   Ordinary backend opens prepare missing documents before client notification;
   reconciliation handles later backend content identities with protection for
   unpublished client edits. Preserve generation/hash/revision/reset guards,
   explicit invalidation and the independent visible-editor readiness boundary.
   Matching Python domain, WBA and client assets must be activated together;
   live acceptance remains required. Detailed evidence/gates are under U2.
3. Deleted-draft gutter indicator: inspect the VS Code implementation and follow
   its small red between-line deletion marker pattern in the draft gutter.
4. Mentions from the inline problem widget: reuse the existing mention owner and
   exact-client destination path rather than a parallel mechanism.
   Approved implementation adds a native Monaco peek-title action via a checked
   bootstrap adapter; capture the displayed marker/model/version, reject stale
   intent in the editor bridge, and reuse the existing targeted mention sender.
   Share diagnostic text/range formatting with Explorer rows. Validate actual
   transformed widget methods plus frontend composition, then bootstrap/host
   builds. Client publication/reload and live acceptance remain separate.
5. Terminal Sidebar launch: use the existing ALS-style immediate state-based
   window opening without the transition animation, retaining session identity.
   Approved bounded correction (2026-10-18): explicit shell/new-session queries
   choose terminal loading layout before lifecycle readiness, rather than always
   rendering the session list first. Backend snapshot validation and one-shot
   creation remain unchanged; stale/closed/failed targets return to list, while
   no-query launches retain the splash/list. Frontend tests/typecheck/build only;
   asset publication and user live acceptance are separate.
   Full-page follow-up approved: suppress session-drawer transitions by default,
   enable the existing animation only on deliberate menu open, and clear that
   enable on mode/session handoff. Preserve manual drawer opening/closing motion;
   update both Terminal template and frontend, without global app-shell changes.

Qualified Sidebar identities (original note 4) and ALS links after project
switches (original note 6) are user accepted, not pending work. Each unresolved
item still needs source-backed concrete implementation approval; this ordering
does not authorize shared-runtime restarts, Android changes or release actions.

### Terminal touch scrolling — sensitivity-first approval, 2026-10-18

User approved read-only comparison of touch-scroll-physics, Lenis,
smooth-scrollbar and use-gesture, then selected the minimal sensitivity-first
implementation rather than vendoring physics now. Raise identical Terminal and
Code TE2 helper gain from 0.4 to 1.0; File Explorer already consumes the latter.
Keep xterm-owned pixel-wheel conversion, line-step settings, TUI routing, native
mouse wheel behavior and selection gestures intact. Add direction/unit/native
wheel/no-inertia regressions. Client asset publication/live acceptance remain
separate; no worker/backend/native build is required.

Inertia was initially deferred, not implemented by that gain change. The user
subsequently approved the velocity-gated follow-up below. Survey sources:
[touch-scroll-physics](https://github.com/Experience-Monks/touch-scroll-physics)
is a small MIT renderer-independent candidate, but its update ignores dt and
applies decay per call; refresh-rate correction and lifecycle cancellation need
separate scope. [Lenis](https://github.com/darkroomengineering/lenis) and
[smooth-scrollbar](https://github.com/dolphin-wood/smooth-scrollbar) own DOM scroll
machinery rather than xterm's application mouse/scroll flow.
[use-gesture](https://github.com/pmndrs/use-gesture) supplies gesture tracking,
not the complete inertia scroller. U5 sidebar launch remains a separate next item.

### Terminal flick follow-up — approved 2026-10-18

User explicitly requires a genuine release gesture, not automatic coasting after
every drag: stronger throws travel farther, slow scrubbing/paused release stop,
and reversal cannot preserve old-direction momentum. Approved implementation uses
a small timestamped velocity estimator and elapsed-time exponential integral,
not a general-purpose engine or dependency. Preserve the accepted 1:1 touch drag,
xterm line settings and existing wheel/TUI path. Limit generated pulses to one
measured row each and bound frame/time work. Fence new touches, selections,
resize, lifecycle visibility, terminal/session/socket/checkpoint changes and
stale/hidden geometry; respect reduced motion. Deterministic tests must compare
60/90/120 Hz and cover non-flick releases and force-dependent travel. Build all
three affected frontends; matching helper/script publication and live feel
acceptance remain separate. No backend/mypyc/native changes or runtime restart.

User-approved calibration after the clock correction: regular throw should coast
a little less than one page and strongest at least four. Use continuous
`min(4.5, 0.75 * speed²)` page travel with reference release speeds 1 and 2.5
CSS px/ms, measured terminal-height normalization, and 280 ms decay. Preserve
activation gates/direct drag/cancellation; keep a bounded 16-pulse frame budget
with residual distance rather than cancelling a strong throw for exceeding the
old pixel ceiling. Test multiple viewport heights and high-row-count terminals.

### Approved follow-up: mobile shortcuts after file switches

Monaco setModel detaches/disposes its view and creates a new textarea while the
editor widget can retain focus. The Ctrl adapter must bind to the new input on
model change and actual text focus, not rely solely on widget focus transitions.
Clear the prior input before replacement; unfocused/background attachment must
not steal focus or another editor's ownership. Dispose listeners with the editor,
deduplicate repeated focus events and fence late helper loads. Preserve the
existing Gboard beforeinput transaction, modifier rules and terminal ownership.
Validate focused/unfocused swaps, palette return, old-editor disposal and IME
shortcuts; typecheck and rebuild the host. Frontend publication/live acceptance
remain separate; no Python/mypyc, Android or runtime restart is needed for this fix.

### 1. Complete static app delivery, not another transport

All eight built-in app entry templates/scripts are already represented by
`app/android_editor_assets_bundle.json`. Shared `/static/js`, fonts, CodeMirror,
xterm, app icons and ALS's pinned static snapshot also have bundle entries.
The Rust OTA ZIP endpoint and APK seed publisher use that same manifest.
Electron and Android additionally own URL interception/required-file checks;
copying an asset into the archive does not itself establish its URL mapping.

Audit the complete reachable static dependency closure for each app against OTA
inventory, APK seed, Electron inventory, Gecko and Cefrium/TE2 Termux mappings.
Include by-ID aliases, query strings, modules, workers, fonts, icons and CSS URLs.
Use an app/client matrix and exact resource evidence. Add only proven missing
resources/mappings, not source trees, dependencies or debug artifacts wholesale.
Confirm generated minified app outputs are current before final publication.
Source audit and the two corrected URL/inventory gaps: STATIC_ASSET_AUDIT.md.
ALS's snapshot must match the selected new ALS dependency, not blindly retain
the currently vendored 0.2.132 provenance.

Acceptance: several simultaneously open Sidebar apps on a slow connection use
native-local static resources. Dynamic shell/bootstrap documents, data, sockets,
readiness and user/extension resources remain live services, not OTA candidates.
Retain fail-local behavior for mapped missing files; do not hide gaps via fetching.

### 2. Gecko staging APK size and production optimization

Read-only baseline: existing October 12 arm64 staging APK is 205,044,077 bytes
(195.5 MiB), not a candidate built from today's source. Native libraries occupy
166,800,200 bytes (159.1 MiB); libxul alone is 147,057,776 bytes (140.2 MiB).
DEX contributes 8,366,278 ZIP bytes (8.0 MiB). Full ELF debug/symbol sections are
already absent from libxul; `.dynsym` and a small `.gnu_debuglink` remain.

The audited baseline staging disabled minification/resource shrinking. A later
approved staging trial now enables both with the existing optimized release
rules; -Pte2.gecko.optimize=false restores unoptimized comparison behavior.
Debug/release remain unchanged. Preserve necessary msgpack reflective classes
and Gecko/JNI consumer rules; no blanket keep rules or unsupported score claims.
See GECKO_SIZE_AUDIT.md. Build only after approval and disk preflight; compare final
APK ZIP categories, signatures, manifest/resources, install and live functionality.
Do not promise dramatic savings: R8 does not shrink Gecko's ELF engine.

User clarification (2026-10-16): downloadable release APK size is the primary
objective, not installed footprint. Add a compressed-native-library candidate
using packaging.jniLibs.useLegacyPackaging=true. Unlike direct APK loading of
uncompressed/page-aligned libraries, this requests compressed .so entries and
installation-time extraction. Already-stripped libraries can still compress;
R8 savings and native ZIP compression must be measured separately.

Before implementation, inspect Gecko's native loading/extraction assumptions and
merged manifest/packaging overrides, then approve the concrete staging scope.
The compression-only trial is now implemented/built with user approval; details,
artifact hashes and pending device gates are in GECKO_SIZE_AUDIT.md. The subsequent
R8 trial saves another 6,839,447 bytes, but R8 8.9.32 emits a Kotlin metadata
warning against Kotlin 2.2.10; the user accepts deferring it after corrected live
validation. No startup/RAM gain has been measured.
Compare same-source APKs with and without native compression; report total and
per-library compressed bytes, installation/extraction behavior, available-storage
requirements and cold launch. Verify signatures, ABI/page-size compatibility,
updates and real-device functionality. Do not promise a savings percentage or
manually recompress a signed APK. Keep debug behavior unchanged and scope this
candidate to Gecko; Cefrium/TE2 Termux require separate loader review/approval.

This supersedes the earlier blanket deferral of native compression investigation,
not the requirement for implementation/build approval. Do not replace Gecko,
upgrade AGP or hand-strip native libraries for this release without new approval.

After Gecko validation, reuse the proven packaging pattern for other APKs only
after checking each renderer/native loader. Long-term direction: at most two
Android application forms, standalone and Termux shared-UID, expected to use the
same renderer and shared packaging policy. Keep identity/signing/permissions and
Termux integration variant-specific. Renderer convergence is direction, not an
authorized migration or a reason to change existing clients in this release.

TE2 Termux follow-up is separately approved: its existing .so packaging already
uses compression and staging R8/resource shrinking. Trial DEX compression only
for Termux staging, with a same-source comparison opt-out, preserving ordinary
Cefrium/debug/release, native signing and CEF dat/pak/bin loading policy. Compare
APK contents/signature/shared UID and obtain device acceptance without automatic
installation. Details: TERMUX_COMPRESSION_AUDIT.md.

2026-10-16 closure: user marks APK Deflate steps complete. Reuse the TE2 Termux
pattern for ordinary Cefrium because both share the same base build. Its DEX
compression switch is currently Termux-staging-only, so this records the chosen
reuse direction, not an already-applied Cefrium change. Preserve CEF data-loading
exceptions and variant identity/signing; final release artifact checks remain R5.

### 3. Bounded desktop keyboard ergonomics

Approved matrix (2026-10-16): root Quick Access `rn` + Enter toggles persisted
relative line numbers, with On/Off description; `e` + Enter opens/focuses Explorer.
Go to Line retains absolute syntax and accepts `:8:k` / `:8:j`, optionally
`:8:k:4` for column 4, clamped to logical model lines/columns. Explorer arrow keys
navigate visible rows; Left/Right collapse/expand or move parent/child;
Space/Enter reuse click behavior and file opening requests editor focus. Ctrl+F
belongs to name search while Explorer has focus. Search and first tree row are
adjacent through Tab/Shift+Tab; Escape dismisses search, then returns editor focus.
Ctrl+Shift+Comma/Period cycles displayed tabs backward/forward, wraps, skips
missing files and suppresses overlapping opens. No extra Sidebar key matrix is
part of the selected slice. Browser/native interception is not added speculatively.

Audit existing host, Monaco, Explorer, file search, Sidebar and Terminal bindings
before adding shortcuts. Reuse action owners and native Monaco command palette;
do not introduce a second command system or cross-surface private calls.
Include Explorer/file-search/Sidebar focus and navigation plus relative line
numbers. Current Monaco options only map showLineNumbers to on/off.

Propose a concrete key/action matrix before implementation. Expose applicable
actions in the command palette and existing settings/menu affordances; honor
enabled preferences and existing shortcuts. Guard editable inputs, IME,
Terminal/TUI ownership, repeat handling, Ctrl/Cmd differences, overlay Escape and
focus restoration. Preserve mobile controls. Validate normal/diff editors and
refresh persistence without duplicating registrations.

### 4. Small known correctness follow-ups

- Editable fallback: user deleted a selected mypyc artifact/pin and got a missing
  domain manifest failure instead of interpreted startup. `_select_editable_domain`
  formerly treated a dangling default symlink as selected. The approved source
  correction follows the automatic selector and falls back only when its target
  is absent, preserving explicit selections, existing broken targets and I/O
  failures. CODE_TE2_FORCE_INTERPRETED=1 deliberately overrides editable domain
  selection without changing the Rust worker or artifacts; packaged installs
  reject this override. Validation/live gates are in TRACKER.md.
- Group the remaining small correctness/test-maintenance items into one cleanup
  slice rather than a standalone terminal-profile task:
  - Terminal extension profile generator: the documented TS2488/unknown iterable
    was in activation-events.ts. Narrow profiles with Array.isArray and
    add valid/missing/malformed fixtures. This is defensive extension-manifest
    bookkeeping, not VS Code terminal support; valid arrays already work and the
    existing outer catch contains malformed-contribution errors.
  - Record pre-existing test failures separately from runtime bugs; modernize
    stale retired-Python mount assertions without restoring obsolete architecture.
    The suppressed-preview MRU test targets the whole-file-group outline, not
    retired header styling. Console fixtures must target exact registered SIDs,
    not retired worker-ID rooms. This approved cleanup is implemented and locally
    validated; results and runtime-adoption boundaries are in TRACKER.md.

### 5. Packaging and final release verification

Do not infer clean dependency closure from source imports. TE2 declares bare
framework-shells and agent-log-server requirements: no minimum, exact pin or
upper cap. User requires existing source/development installs to satisfy these
edges without waiting for an unpublished stable version. Fresh installs use pip's
normal compatible release selection; this does not force upgrades of already
satisfied installs. Release-validation locks may record exact tested versions,
but do not impose those on normal installs. ALS source is 0.2.139.dev1, not published
release evidence. Verify/build cleaned ALS native wheels, regenerate target
validation locks, and validate optional uvloop target selection and
private-runtime ABI. FWS 0.2.65 is already published: do not repeat its release
merely because a historical checkbox remains open.

Approved 2026-10-18 source slice: ALS development bump/checkpoint/push; default
target-exclusive uvloop requirements in ALS/TE2 and private Linux runtime;
normal Termux installer switches to binary-only PyPI staging while preserving
offline payloads and activation/rollback. This does not authorize tags, uploads,
device installation or heavy builds. Cleaned ALS wheels, remaining Android native
dependency coverage and regenerated locks still gate release. Pixel is user-owned
for concurrent Android compilation validation; do not interfere.

Build matched current-source Linux/Termux wheels, native worker/domain receipts,
OTA and staging APK assets. Reuse artifacts only under the established fingerprint
and provenance checks. Enforce the strict 100,000,000-byte PyPI wheel budget.
Fresh Debian and Android/Termux installs must prove version, native selection,
real WBA/Node imports, console/MCP, app launch and dependency closure. Check
libarchive.file_reader, not merely import libarchive. Then perform the separately
approved merge/tag/GitHub/PyPI publication workflow. README already states Gboard
18+ support; update release references at release time, not during this audit.

## Explicit next-version backlog

First post-release investigation: browser-engine-backed Electromux runtime,
using EdgeJS's experimental engine-free host-JS mode as a candidate. The root
`ELECTROMUX_ENGINE_REUSE_PROPOSAL.md` records scope, evidence, no-fork-first audit
and acceptance gates. This priority does not expand the current release cut line.

ALS intent migration: editor -> framework -> ALS mentions; ALS -> framework ->
editor file opens and project switches. Reuse framework brokerage and typed
intents, not editor-presence-dependent Sidebar socket mediation. Preserve exact
client/presentation/project ownership and standalone behavior. Coordinate with
the user's in-progress reconnectable FWS UDS work; no prerequisite code changes
are authorized here. Intent preferences/manifests are future possibilities, not
extra requirements for the immediate cutover. Target the existing 0.2.355 follow-up.

Also defer Monaco graph/GPU experiments, general workspace edits/refactors,
observability/benchmark expansion, Electromux platform expansion, additional
native diagnostics, Aria socket/intent/502 modernization and archive intent/feature
expansion. Existing known issues remain documented; none are silently declared
fixed. A newly confirmed destructive or launch-breaking regression can reopen the
release cut line only by explicit user decision.
