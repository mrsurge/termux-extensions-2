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
node --test tests/scm_graph.test.mjs
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

## Remaining Pane Dependency Ledger

The original `scmHistoryViewPane.ts` and `media/scm.css` are copied in full but are
NOT integrated or imported yet. The following work is still required:

| Dependency family | Planned treatment |
| --- | --- |
| Graph/history types | Use the adapted literal files already present. |
| WorkbenchCompressibleAsyncDataTree, node identity, labels and resource tree | Approved exact base CompressibleAsyncDataTree runtime dependency copy under tree/upstream. No exported Monaco tree available. Workbench wrapper is omitted; pane row/data-source and labels/resource-tree integration still pending. |
| ViewPane/instantiation/context keys/menu services | Replace the outer workbench registration with the existing Explorer overlay lifecycle; remove unsupported commands via an explicit patch. No fake workbench service container. |
| SCM history provider/observables | Bind typed backend-projected graph state and cancellation; no extension-host provider for this read-only view. |
| Editor service/open dispatch | Route captured historical identities through Explorer backend to the secondary host, never open a working file as a substitute. |
| Markdown hovers/chat/drag/quick input/mutation actions | Not part of initial view; account for deletions in pane patch. No invisible leftover commands. |
| Icon/resource labels/themes | Reuse vendored icons/theme tokens and keep upstream row classes; statistics are explicit TE2 additions. |
| scm.css | Preserve baseline, then scope adapted history selectors; do not import the full unscoped stylesheet. |

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
Raw sources are excluded from TE2's TypeScript project; the future integration
must expose a narrow typed contract rather than propagate unchecked values.

`tests/scm_tree.test.mjs` instantiates the real compressible async tree in a DOM
harness, checks lazy commit-child loading, selection, collapse and disposal.
The test disposes immediately with a zero-delay active-node update pending.
`tree/patches/0001-disposable-active-node-debounce.patch` replaces the unobserved
Delayer promise with upstream RunOnceScheduler: next-tick coalescing remains,
but disposal cancels a timer rather than rejecting an ignored promise. The build
applies this patch with zero fuzz in temporary storage and uses the adapted
module in memory. Original hashes remain verified and originals are unchanged.
No production grace timer or global cancellation-error suppressor is introduced.

The upstream SCM pane and stylesheet still require their own explicit adaptation
patch. This checkpoint is a dependency foundation, not a working History tab.
