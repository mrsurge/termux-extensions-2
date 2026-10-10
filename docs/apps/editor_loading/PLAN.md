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
large bodies. The browser verifies the local asset once with WebCrypto and admits
only matching ID/hash pairs into its revision cache. A missing/corrupt seed or an
extension override uses `editor.textmate.chunk.get`, limited to 64 KiB UTF-8 per
reply and two active streams. Offsets count Unicode codepoints, not UTF-16 units.
Every chunk revalidates revision/resources; its content fingerprint must remain
consistent. No WBA fallback or uncertain request replay is introduced.

Oversized closure prefixes still use TextMate discovery, with bounded on-demand
chunks beyond the prefix. Insecure browser origins without WebCrypto skip seeds
and retain bounded RPC functionality. Other languages reuse matching bodies from
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
4. **Persistent grammar caching.** Design cross-reload reuse with stable origins
   where available and backend revision/ID/hash invalidation. Preserve native
   packaged-first loading, bounded storage and verified admission. Choose storage
   from evidence, not an assumption of localStorage; no new selection authority.
5. **OTA compression investigation.** Inspect existing archive compression and
   native update/download/extraction flows before proposing changes. Measure
   transfer savings, CPU/memory, integrity checks and backward compatibility
   independently of browser HTTP gzip. Preserve installed asset inventory and
   atomic activation; no OTA format/client changes without separate approval.
6. **Finish the loading audit.** Cover cold/warm comparison languages, rapid file
   switches, reconnect and primary/secondary editors under poor connections.
   Separate tokenization, transport latency and model readiness; act only on
   demonstrated inefficiencies or races.
7. **Maintenance release integration.** With separate release approval, synchronize
   versions and package matching domain/worker/framework artifacts, frontend
   assets and staging APK seeds. Validate provenance and target installs before
   merge/tag/publication. No release is authorized by this documentation update.

Each implementation slice still requires concrete scope approval. Documentation
approval does not authorize builds, client changes or runtime restarts.

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
