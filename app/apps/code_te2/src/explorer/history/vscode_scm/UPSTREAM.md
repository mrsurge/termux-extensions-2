# VS Code SCM Source

## Provenance

Microsoft VS Code, MIT License; see `upstream/LICENSE.txt` and original source
headers. Source revision: `591199df409fbf59b4b52d5ad4ee0470152a9b31` from the local
`worktrees/code-server/lib/vscode` repository. `manifest.json` records each exact
repository path and SHA-256. Files were copied using `git show REV:PATH`, not from
potentially patched working files. All six originals are byte-identical.

`upstream/` is provenance source, not build input. `adapted/` is a literal patched
copy, not a graph implementation written to resemble VS Code. The existing app
TypeScript configuration checks the adapted runtime; originals and Node-only
upstream tests are excluded from the browser TypeScript program.

## Reproduction

From the Code TE2 app directory:

```sh
node src/explorer/history/vscode_scm/materialize.mjs
node --test tests/scm_graph.test.mjs tests/scm_tree.test.mjs tests/scm_history_pane.test.mjs
```

The first command checks all original hashes, applies `patches/series` in an
isolated scratch directory with zero fuzz, and compares every adapted file byte
for byte. `--write` intentionally regenerates the adapted files. No VS Code
checkout, network, Monaco rebuild or live framework is required. Scratch uses
`TMPDIR` or a dedicated local directory and is removed on completion.

## Patch Ledger

`0001-standalone-graph.patch`:

- Replaces graph-module imports with `platform.ts` and copied history types.
- Keeps the graph lane algorithm, SVG bodies, reference ordering, constants and
  incoming/outgoing-change graph handling intact.
- Removes only `toHistoryItemHoverContent`: it requires workbench Markdown
  rendering and is not used by this standalone graph foundation. The original
  remains in the pinned file for future pane adaptation.
- Corrects graph-placeholder return type to SVGSVGElement. The original DOM
  helper typed this as HTMLElement; our native SVG adapter exposes its real type.
- Removes workbench provider/repository interfaces from adapted history types.
  Retains graph/history/ref/statistics contracts; resource URIs become strings,
  icon/Markdown fields use small structural types. This is not a fake provider.
- Replaces upstream test imports and suite registration with node:test. Removes
  the workbench disposable-leak hook because these tests allocate no workbench
  services; all eleven original test bodies and assertions remain unchanged.

`platform.ts` is explicit TE2 integration, not attributed upstream code. It
provides native SVG creation, plain graph-record cloning, English localization,
index helpers, and a graph-host-scoped color registry. Theme fallback values are
TE2 adapter policy. Integration must map the active theme before mounting; no
styles or graph are currently mounted by the application.

`0002-file-row-renderer.patch` starts the pane adaptation with its file rows:

- Preserves the complete original pane under `upstream/`; this first patch
  extracts HistoryItemChangeRenderer, with subsequent patches adding other rows.
- Retains `_renderGraphPlaceholder` literally except for the template type name.
  A source-equality test protects that boundary alongside DOM geometry tests.
- Removes ResourceLabels, command/menu service injection and directory compression
  from this summary-only file renderer. No Git mutation actions are installed.
- Replaces workbench label creation with explicit document-owned text elements
  and statistics via `pane-platform.ts`, which is TE2 integration code.
- Adds distinct pending/binary/unavailable count states; none imply zero counts.
- Removes renderer-owned DOM and resets the row margin on template disposal.

`0003-pane-rows-and-data-source.patch`:

- Restores the upstream commit graph-rendering block, badge grouping order and
  load-more graph-placeholder block. Native text elements replace IconLabel and
  `h`; ref icons are validated Codicon identifiers. Badge updates follow explicit
  projection updates rather than workbench observables. Rich hover/menu services,
  incoming/outgoing pseudo-commit resolution and workbench registration are omitted.
- Adapts ListDelegate and the root/commit/file child-dispatch pattern to typed
  summary inputs. Only commit/file hierarchy is requested: ResourceTree directory
  compression is not needed. Real commit children compare against first parent;
  root commits explicitly use an absent parent, never a mutable ref or disk.
- Adds a generation-local summary cache to avoid repeating provider reads when
  upstream refreshes expanded children. Cache entries are pruned with root rows
  and cleared on disposal. Failures evict their entry and expose a TE2 retry row,
  not an empty commit. Abort fencing rejects late results after host disposal.
- TE2 additions are counts, retry affordances and the typed child-reader callback;
  no fake SCM repository, provider service, or extension-host dependency is added.

`0004-scoped-history-styles.patch` retains only upstream history selectors and
scopes them to `.te2-scm-history`. Native label/count layout lives separately in
`history-tree-host.css`. The original stylesheet remains untouched.

`history-tree-host.ts` replaces workbench outer service wiring with an explicitly
TE2-owned component. It accepts the real tree constructor via `tree-contract.ts`,
owns one immutable generation, subscribes once to upstream's combined mouse/touch
activation event, handles keyboard leaf activation, and deduplicates load-more.
It cancels native refreshes before disposing event sources, aborts provider reads,
and owns only its own DOM. File-open and load-more callbacks are intents, not
authority or cross-lane frontend RPCs.

The component is exercised with the actual upstream class in DOM tests. The app
does not import/mount it yet: production asset wiring, framework providers and
second-editor routing remain later phases, not mock working-file fallbacks.

## Remaining Pane Dependency Ledger

The original pane/CSS are copied in full; their adaptations are integrated in the
standalone component but NOT imported by the application's entry point yet.

| Dependency family | Planned treatment |
| --- | --- |
| Graph/history types | Use the adapted literal files already present. |
| WorkbenchCompressibleAsyncDataTree, node identity, labels and resource tree | Resolved: pinned base CompressibleAsyncDataTree, typed constructor boundary, native labels and commit/file identity. No directory compression or workbench wrapper. |
| ViewPane/instantiation/context keys/menu services | Resolved for standalone component: explicit HistoryTreeHost lifecycle. Mounting it in the Explorer overlay remains Phase 4. |
| SCM history provider/observables | Typed child-reader and explicit row updates exist; real Rust/Python DTO transport remains Phase 2. No extension-host provider. |
| Editor service/open dispatch | Route captured historical identities through Explorer backend to the secondary host, never open a working file as a substitute. |
| Markdown hovers/chat/drag/quick input/mutation actions | Not part of initial view; account for deletions in pane patch. No invisible leftover commands. |
| Icon/resource labels/themes | Reuse vendored icons/theme tokens and keep upstream row classes; statistics are explicit TE2 additions. |
| scm.css | Resolved: adapted history selectors and generated base-tree CSS are scoped to the History host. |

Further exact dependency copies must be pinned and added to the manifest. A
materially larger workbench transplant requires scope review; do not quietly
replace the preserved pane with a newly invented lookalike.

## Base Tree Dependency Checkpoint

`tree/manifest.json` pins the 164 runtime inputs of the actual upstream
`src/vs/base/browser/ui/tree/asyncDataTree.ts` entry to the same revision.
`tree/upstream` contains those unchanged files, the original license and full
third-party notices (including the bundled DOMPurify notice), and upstream
compiler configuration. No files are resolved from the developer checkout.

`node tree/build.mjs` verifies hashes, bundles in memory, and rejects new or
unused runtime dependencies. It explicitly retains upstream legacy-decorator
and field-initialization semantics instead of inheriting TE2's compiler defaults.
This script does not publish a generated artifact or import the tree into TE2.
Raw sources are excluded from TE2's TypeScript project; `tree-contract.ts`
describes the used API, and the runtime test exercises it against the actual tree.
Base-tree CSS is scoped during the in-memory build using esbuild's CSS parser and
nesting transform, without editing the original dependency stylesheets.

`tests/scm_tree.test.mjs` instantiates the real compressible async tree in a DOM
harness, checks lazy commit-child loading, selection, collapse and disposal.
The test disposes immediately with a zero-delay active-node update pending.
`tree/patches/0001-disposable-active-node-debounce.patch` replaces the unobserved
Delayer promise with upstream RunOnceScheduler: next-tick coalescing remains,
but disposal cancels a timer rather than rejecting an ignored promise. The build
applies this patch with zero fuzz in temporary storage and uses the adapted
module in memory. Original hashes remain verified and originals are unchanged.
`tree/patches/0002-observe-refresh-cleanup.patch` returns the subtree refresh
cleanup promise rather than orphaning the rejection from `finally`. The host can
then cancel native pending refreshes before disposal without global exceptions.
No production grace timer or global cancellation-error suppressor is introduced.

The isolated pane tests cover refs, row recycling, mouse/touch/keyboard intent,
single-flight load-more, first-parent/root reads, retained expanded children,
failure/retry, in-flight disposal and stylesheet scope. This is a standalone view
foundation, not a working production History tab or completed framework protocol.
