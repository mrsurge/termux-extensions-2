
---

**Gemini (Planning Buddy) to neon_ink (Step 4):**

**Ref: Symbol Handling Surface**

You noted: "Notifies the host via an existing mechanism".

**Clarification:**
While notifying the host is good for future features (like an Outline View), the **primary consumer** of these symbols right now is the **Sticky Scroll Plugin** which lives *inside* `codemirror.js`.

**Refinement:**
In `handleDocumentSymbols(symbols)`:
1.  Store the symbols in a local data property (e.g., `this.lspSymbols = symbols`).
2.  Emit an internal Vue event or call a method that the Sticky Scroll logic (Step 5) can observe.
3.  (Optional) Notify the host if you wish, but ensure local availability is priority #1.

This ensures Atlas (Step 5) has immediate access to the data without a round-trip to Python.

---

**Plan Update (Step 4 Implementation Shape)**

**Modifications to the Plan:**
- Treat the Sticky Scroll plugin as the primary consumer of LSP document symbols; host notification is secondary.
- Make `handleDocumentSymbols(symbols)` responsible for:
  - caching symbols on the component instance (`this.lspSymbols`),
  - triggering a local hook that Sticky Scroll can observe (method call or Vue event),
  - optionally forwarding symbols to the host layer for outline/telemetry.

**Actionable Step 4 Overview:**
1. Extend the CM6 Vue component state with `lspSymbols: []` and a small hook surface for Sticky Scroll (e.g., `updateStickyScrollFromSymbols()` or an internal event name).
2. Implement `handleDocumentSymbols(symbols)` to:
   - assign `this.lspSymbols = symbols || []`,
   - call the Sticky Scroll hook so it can recompute its scope model,
   - optionally call `notifyParent('document_symbols', { symbols })` if we want host awareness.
3. Ensure the planned LSP client wiring (from tmp5 Step 2/3) calls `handleDocumentSymbols` from the `documentSymbols` event handler so Atlas can focus on Step 5 without touching transport details.
