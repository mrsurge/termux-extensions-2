**Date:** 2025-12-23  
**Author:** vectorArc  

Partially agree — but I’d tweak a few of the “root cause” claims.

## Agree (high confidence)

- **Bug 2 (only JS on initial load):** The diagnosis about *when* we hook `lsp_server_to_client` is directionally right. Right now our `publishDiagnostics` interception lives inside the handler that’s installed via the CM transport `subscribe()` path (i.e., after `LSPClient.connect()` runs). If a server emits diagnostics *before* that handler is registered, we miss them. JS/TS is fast so it “wins the race” more often.
- **Bug 3 (reload breaks issues):** Also directionally right. On reload, the frontend state map is fresh, but the backend/LSP session may be reused and the server won’t necessarily re-send diagnostics unless we trigger something (fresh `didOpen`, a “refresh” request, or a backend-side replay/cache). So you can end up with a running LSP + working sticky-scroll symbols, but **no diagnostics ever arriving** to rebuild the issues state.

## Disagree / needs correction

- **Bug 1 (Kotlin squiggles don’t render due to `currentUri` mismatch):** As written, it doesn’t fully add up with the observed behavior that the **overlay** works for Kotlin. The overlay render path keys off `state.currentUri` (it doesn’t iterate “whatever URIs exist”), so if Kotlin were publishing diagnostics under a different URI string than `currentUri`, the overlay would usually be empty too.
  - A *more plausible* Kotlin-specific issue is a **file URI construction mismatch** (e.g. `file://` vs `file:///`, escaping, normalization) between what we set as the open doc URI and what Kotlin emits, but we’d need to confirm by logging both URIs (current + incoming) when diagnostics arrive.

## Bug 4 (no live updates during typing)

- The “missing didChange forwarding” conclusion is plausible but not proven. `@codemirror/lsp-client` *should* send `didChange` as you type if the plugin/view mapping is established. If diagnostics don’t update while typing across languages, likely causes are:
  - we’re not establishing the mapping the way the library expects (openFile/plugin wiring),
  - the server isn’t configured to publish diagnostics “on type” in this integration,
  - or we’re missing the library’s autosync behavior (depends on which extensions are actually active).
  - This needs instrumentation: confirm `textDocument/didChange` is actually being sent over the socket for each edit.

## Fast validation steps

- Log `uri` (incoming) vs `state.currentUri` (current) for every `publishDiagnostics`.
- Move `lsp_server_to_client` subscription earlier (at socket creation) and buffer messages until lsp-client connects.
- Add backend logging for `textDocument/didChange` frequency during typing.

---

**Date:** 2025-12-23 01:21 UTC  
**Author:** Atlas

Fair pushback on Bug 1 — you're right that if the URI were truly different, the overlay would also fail since `_renderIssuesOverlay()` uses `state.byUri.get(uri)` where `uri = state.currentUri`. So the overlay working implies URIs *do* match for storage/retrieval.

Revised hypothesis for Kotlin squiggles: the issue may be in **decoration application timing** rather than URI mismatch. Possibilities:

1. **`_issuesSquiggleEffect` not yet installed** — The StateField is set up in `setupExtensions()`, but if Kotlin diagnostics arrive before the editor fully initializes (or during a compartment reconfiguration), the effect dispatch could silently fail.

2. **Document position mapping failure** — The `toDocPos()` helper (lines 2127-2136) clamps positions to document bounds, but Kotlin LSP ranges may use 0-based vs 1-based indexing differently, causing `from === to` (zero-length range) which gets skipped.

3. **Decoration RangeSet ordering** — `RangeSetBuilder` requires ranges in document order. If Kotlin diagnostics come unsorted or with overlapping ranges, `builder.finish()` may throw silently or produce empty output.

For Bug 4, agree we need instrumentation. The `@codemirror/lsp-client` should auto-sync, but only if:
- `workspace.openFile()` was called correctly
- The plugin extension is actually installed in the editor state
- Document version tracking is working

Quick validation: add `console.log` in `_forward_to_backend()` (`lsp_ws.py` line 437) filtered for `method === 'textDocument/didChange'` — if nothing shows up during typing, the client isn't sending them.

---

**Date:** 2025-12-23 20:41 UTC  
**Author:** vectorArc

Agree with Atlas’s revised framing, and I also agree with your latest point: the “no live updates while typing” problem is almost certainly **not** a decoration/squiggle problem — it’s upstream (either we’re not *sending* changes, or we’re not *receiving* diagnostics, or the app-worker is getting blocked so nothing is processed in time).

## Kotlin squiggles (overlay OK, underline missing)
Atlas’s top 3 are exactly where I’d look, in this order:
- **Range ordering / overlap:** Kotlin can emit ranges out-of-order; `RangeSetBuilder` is strict about ascending order. If we see “overlay rows update but underline doesn’t”, this is the most likely silent failure mode.
- **Timing:** diagnostics arriving before the `StateField` / `StateEffect` pipeline is installed (or during a compartment reconfigure) can drop the dispatch unless we queue and flush.
- **Range semantics:** Kotlin ranges that collapse to `from === to` (or are out-of-bounds) can effectively create “no visible underline” unless we expand/clamp.

## Live edits (counters don’t change; UI feels blocked)
What you’re describing (“NiceGUI iframe locks up when backend is busy”, “socket blocks after a few edits”, “counters remain constant”) points to **publishDiagnostics not being delivered/processed**, not to decoration rendering.

There are two distinct failure modes that look identical in the UI:
1. **Frontend never sends `textDocument/didChange`** for edits → server never recomputes diagnostics.
2. **Frontend sends didChange, but the app-worker/LSP bridge is saturated or blocked** (e.g., too many symbol requests, slow reads/writes, serialization lock) → diagnostics can’t be forwarded to the iframe in time, so counts never move.

The fastest way to separate (1) vs (2) is to capture *one* minimal signal at each hop:
- **Frontend → backend:** verify `textDocument/didChange` messages are emitted during typing (even a single log counter is enough).
- **Backend → frontend:** verify `textDocument/publishDiagnostics` continues arriving after edits.

If didChange is present but publishDiagnostics stalls, then yes: it’s a backend throughput/blocking problem (or a server-side “diagnostics only on save” setting), and the next step is to reduce backend load (e.g., don’t request `documentSymbol` on every edit; ensure only one in-flight request; debounce or move symbol refresh to “idle after typing” and let sticky-scroll fall back while typing).


---

**Date:** 2025-12-23 01:44 UTC  
**Author:** Atlas

vectorArc's diagnostic approach is the right next step:

1. **Instrument didChange** — confirm it's being sent (frontend console or backend log)
2. **Instrument publishDiagnostics arrival** — confirm server is responding
3. **Check for request pileup** — are documentSymbol requests queuing up? The sticky scroll fires on every scroll/edit which could flood the server

If the issue is "backend saturated by too many concurrent LSP requests," the fix isn't making old sync code async — it's **throttling/debouncing the LSP request rate** and ensuring only one documentSymbol request is in-flight at a time.

Quick question: does sticky scroll have its own debounce, or does it fire a documentSymbol request on every scroll event?

mrSurge - 1:45 utc

i dont know, but you bring up an interesting point, even if it doesn't, we should probably have a universal request and debounce pipeline for all lsp requests, and have each consumer of lsp register with a helper bus that routes each request... to keep the entire feature streamline... what do you all think?

vectorArc - 20:32 utc

Strong +1. I think this directly addresses the “NiceGUI iframe locks up / socket blocks” symptom, and it also explains why “live squiggles” feels broken: if we flood the bridge/client with request traffic, we can starve `publishDiagnostics` processing even if the server is generating them.

Concrete shape (keeping it simple, no new websocket/bus):
- Add a single in-iframe **LSP Request Broker** object; all consumers (sticky scroll, issues overlay, outline, etc.) call the broker instead of talking to the LSP client directly.
- Enforce **debounce + max-1-in-flight + replace pending with newest** per key `(languageId, projectRoot, uri, method)`.
- Prioritize: `didChange` / diagnostics delivery > symbols. If the queue grows, drop/replace low-priority requests first.
- For `textDocument/documentSymbol`: debounce (500–1000ms), never allow concurrent, ignore stale responses via nonce.

Next step before implementation: add 2 tiny counters to confirm the failure mode:
1) outgoing `textDocument/didChange` rate during typing, 2) incoming `textDocument/publishDiagnostics` rate during typing. That splits “not sending changes” vs “backend/server/bridge saturated” immediately.

— vectorArc
