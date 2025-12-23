# Kotlin Diagnostics + CM6 LSP “Nudge” / `sync()` — Notes (2025-12-23)

This file captures (verbatim in meaning and detail) what I stated in the last two replies about the current Kotlin “issues/diagnostics” behavior and what to do next.

---

## 1) Kotlin LSP: why symbols work but `publishDiagnostics` is missing

Given the symptom:
- Kotlin **document symbols work** (sticky scroll works), but
- Kotlin **never emits** `textDocument/publishDiagnostics` (nothing reaches the frontend, nothing shows in backend logs),

the most likely explanation is **not** a bug in the bridge anymore — it’s a **protocol mismatch**:

- The official JetBrains/Kotlin LSP you’re using is very likely operating in a **pull-based diagnostics** mode.
- In that model, the server does **not** push diagnostics via `textDocument/publishDiagnostics` as the primary mechanism.
- Instead, the client must explicitly request diagnostics using the **pull diagnostics** requests:
  - `textDocument/diagnostic` (document-level)
  - (optionally later) `workspace/diagnostic` (workspace-level)

### What to do (proposal)

Treat Kotlin diagnostics as **pull**:

- After `didOpen` and after debounced `didChange`, request `textDocument/diagnostic`.
- Consume the response shapes and feed them into your existing Issues pipeline:
  - Responses may be `Full` or `Unchanged`.
  - Responses may include `resultId` (for incremental/pull caching).
  - Responses may include `relatedDocuments` (for multi-file cascades).
- Convert that returned diagnostics list into your existing internal representation (per-URI map → counts/overlay rows → squiggle decorations).

### What this implies for your existing “nudge” idea

Your current nudge concept (“after reload, prod the server so diagnostics show up again”) still makes sense, but for Kotlin it should be:

- “Do a pull diagnostic request” (after ensuring the server has current text),
not:
- “Wait for `publishDiagnostics`” (because Kotlin may never send it in the first place).

### Capability negotiation detail

Some servers change diagnostic behavior depending on what the client advertises:

- If the client advertises a pull diagnostics capability (`textDocument.diagnostic`), a server may reduce or disable legacy push diagnostics (`publishDiagnostics`) behavior.

So you generally want one of these:

1) **Implement pull diagnostics properly** (recommended for Kotlin), or
2) **Stop advertising pull diagnostics** if you’re trying to force push (but for Kotlin this may not be viable).

### Why your earlier “live edit” fix makes sense for other servers

Independently of Kotlin: CodeMirror’s `@codemirror/lsp-client` can be “lazy” about when it sends `didChange` unless `sync()` is invoked in a controlled way.

That’s why adding explicit didChange / sync logic can be necessary to get “diagnostics on type” behavior to be consistent.

### One clarification question (still relevant)

The above is specifically about the JetBrains/Kotlin LSP you downloaded (the `kotlin-lsp` distribution). If you switch Kotlin servers (e.g. a different Kotlin language server implementation), the diagnostics behavior could change (push vs pull).

---

## 2) Should we replace the current “nudge” with debounced `client.sync()`?

Answer: debounced `client.sync()` is a **real functional improvement** (more robust / reproducible), but it solves a **different** problem than the reload “nudge”.

### What debounced `client.sync()` buys you (robust/reproducible)

- `client.sync()` is the library-sanctioned way to flush pending CM6 → LSP document state (`didOpen` / `didChange`) on a predictable schedule.
- It reduces variability like “maybe didChange gets sent later / only on certain transactions / only on idle”, and makes diagnostics-on-type behavior more deterministic across:
  - page reloads,
  - different language servers,
  - different editor transaction patterns.

This is a real step toward reproducibility (robustness), not merely a semantic refactor.

### What `client.sync()` does *not* buy you

`sync()` does **not** request diagnostics by itself.

It only ensures the server has the current text state. Then:

- For **push-diagnostics servers** (`publishDiagnostics`), fresh text is often enough to trigger a new diagnostics emission.
- For **pull-diagnostics servers** (likely Kotlin), fresh text is not enough — you still must request diagnostics (`textDocument/diagnostic`) after syncing.

### Why `sync()` alone is not a sufficient “nudge” after reload

Your reload “nudge” problem is:
- server already running
- server already thinks file is open
- UI state is fresh after reload
- no fresh diagnostics arrive automatically

In that scenario:
- `sync()` may send **nothing** if CM thinks nothing changed (same content, no pending diff).
- Therefore `sync()` is not guaranteed to “nudge” anything.

### Recommended split of responsibilities (robust + correct)

Use both, with clear roles:

1) **Live edits:** use debounced `client.sync()` (or equivalent explicit didChange flushing) so the server reliably sees typed changes.

2) **Reconnect/reload “nudge”:** keep an explicit action that forces diagnostics to appear again:
   - For push servers: force a refresh pattern the server responds to (often a deliberate didChange even if content is same, or a reopen sequence).
   - For Kotlin/pull servers: perform `textDocument/diagnostic` after ensuring the document is synced.

Net: `client.sync()` is a move toward robustness/reproducibility, but it is not a full replacement for the separate “nudge” logic, and Kotlin likely requires pull diagnostics regardless.

