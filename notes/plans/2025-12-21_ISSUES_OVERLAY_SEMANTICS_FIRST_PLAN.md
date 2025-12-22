# Code CM6 — Issues Overlay (Diagnostics) Semantics-First Plan

**Date:** 2025-12-21  
**Status:** Draft plan (no UI polish yet)  
**Scope:** Code CM6 iframe (NiceGUI/CM6) + minimal host wiring + disk-backed suppression list (HistoryStore → ProjectSidecar)

## Goals

1. **Diagnostics (errors/warnings) for JavaScript/TypeScript** first (via the existing TypeScript LSP), using two buckets:
   - **Errors** (red)
   - **Warnings** (yellow)
2. **Always-on squiggles** in the editor for current in-memory text (not disk).
3. **Issues overlay** inside the editor iframe:
   - Shows *the full line* for the currently selected issue line.
   - Under that, shows 1..N messages for all issues on that line (in document order).
   - Includes per-issue dismiss (suppression) action.
4. **Navigation affordance** in the host chrome (next/prev) but *no new comms channel*:
   - Reuse the existing iframe→host message bus (the one currently used for drafts/toasts).
5. **Suppression list persisted per-project, per-file** using the same SSOT pattern as drafts:
   - HistoryStore facade APIs
   - ProjectSidecar stores the data

## Non-goals (for semantics-first)

- No code actions UI (quick fixes) yet.
- No “Problems” list for the whole workspace yet.
- No semantic tokens / semantic highlighting yet (diagnostics first).
- No “hover” UI (mobile doesn’t have hover).

## Reuse: Existing iframe↔host message bus

We already have:
- Iframe → host: `notifyParent(type, data)` (codemirror.js)
- Backend → iframe → host: `editor.notify_parent(type, data)` (codemirror.py)
- Host listens for `window.message` events and routes `notification`, `draft_state`, etc.

For issues, we add **new message types** but reuse the same bus:
- Host → iframe: `issues_cmd` (command envelope)
- Iframe → host: `issues_state` (counts + current position)

No new websocket namespaces; no new transport.

## Data model (iframe)

### Inputs
- LSP `textDocument/publishDiagnostics` messages for the current document URI.

### Normalized representation
- `diagnosticsByUri: Map<uri, Diagnostic[]>` (raw)
- `visibleDiagnosticsByUri: Map<uri, Diagnostic[]>` (raw minus suppressed)
- `issuesIndexByUri: Map<uri, IssueIndex>` (computed)

Where `IssueIndex` contains:
- `byLine: Map<lineNumber, LineIssues>`
- `flat: IssueRef[]` (sorted by line, then column, then severity)
- `counts: { errors, warnings }`

`LineIssues` contains:
- `lineNumber` (1-based)
- `lineText` (string)
- `issues: IssueItem[]` (sorted by range.start)

### Severity bucketing
Primary:
- Error bucket: `DiagnosticSeverity.Error`
- Warning bucket: `DiagnosticSeverity.Warning`
Policy:
- For semantics-first, treat `Information` + `Hint` as **Warnings** (optional toggle later).

## Editor squiggles (iframe)

Implement CM6 decorations:
- Wavy underline over the diagnostic range.
- Red for Error, yellow for Warning.

Edge cases:
- Zero-length ranges: underline at least 1 char (or the token at position if available).
- Multi-range diagnostics: LSP diagnostics are single-range; code actions can come later.

## Issues overlay (iframe)

### Placement
- Inside the iframe, docked above the search bar / bottom chrome, similar to sticky scroll.

### Content
- “Replica line”:
  - Render the full line text (monospace) with squiggle styling aligned to the diagnostic ranges on that line.
- Detail rows:
  - One row per diagnostic on the line.
  - Shows severity badge + message (+ optional `source`/`code`).
  - Dismiss button (X) per row.

### Navigation inside iframe
- Maintains `activeIssueFlatIndex` per current URI.
- `next/prev` jumps to the diagnostic range in the editor (scroll + selection).
- Keeps overlay synced to the active issue (line changes as you jump).

## Host chrome affordances (minimal)

Use the bus:
- Host sends `issues_cmd`:
  - `{ action: 'toggle' }`
  - `{ action: 'next' }`
  - `{ action: 'prev' }`
- Iframe sends `issues_state`:
  - `{ uri, errors, warnings, activeIndex, total, currentLine }`

Host responsibilities:
- Display counts/badges near filename.
- Provide prev/next buttons (tap-friendly).
- No rendering of issues content in host (iframe owns it).

## Suppression (HistoryStore facade → ProjectSidecar storage)

### Storage location (ProjectSidecar)
Add a new optional field:
```json
{
  "suppressed_diagnostics": {
    "<file_key>": [
      { "sig": "...", "created_at": "..." }
    ]
  }
}
```

Where `<file_key>` matches the same file-keying approach used by drafts (preferred) or is the absolute file path (acceptable, but less portable).

### Signature format
Goal: stable enough to persist, but not too broad:
- `sig = sha1(source + code + severity + message)` plus optional range hint.

Policy:
- If we include range in the signature, suppression is very specific but may not persist through edits.
- If we exclude range, suppression is more durable but may hide multiple occurrences.

Semantics-first default:
- Exclude range from the signature (hide “this diagnostic type”), but store last-seen range for UI display.

### HistoryStore APIs (facade)
Add methods mirroring draft patterns:
- `list_suppressed_diagnostics(project_path, file_path) -> list[SigEntry]`
- `add_suppressed_diagnostic(project_path, file_path, sig_entry) -> bool`
- `remove_suppressed_diagnostic(project_path, file_path, sig) -> bool`
- `clear_suppressed_diagnostics(project_path, file_path) -> bool`

### Flow
- On file open / didOpen: iframe requests suppressed list for that file via host (bus).
- On dismiss: iframe sends a suppression request to host; host persists via HistoryStore → ProjectSidecar; host acks via bus.

## Implementation phases

### Phase 0 — Plumbing / contracts
- Add message types on the existing bus:
  - `issues_cmd` (host → iframe)
  - `issues_state` (iframe → host)
  - `issues_suppress` (iframe → host) + `issues_suppress_ack` (host → iframe)
  - `issues_suppressed_list` (host → iframe) for initial load

### Phase 1 — Diagnostics ingestion + squiggles (iframe)
- Capture `publishDiagnostics` and store per-URI.
- Build `IssueIndex` + counts.
- Render squiggle decorations.
- Emit `issues_state` updates (counts).

### Phase 2 — Issues overlay (iframe)
- Render overlay for current URI:
  - active line replica
  - per-line details
- Implement next/prev + jump-to-range behavior.

### Phase 3 — Suppression (disk-backed, no UI polish)
- Implement ProjectSidecar schema + HistoryStore facade methods.
- Wire dismiss button to persist suppression and re-filter diagnostics.

## Known risks / gotchas

- LSP servers vary in severity mapping; treat `Hint/Information` carefully.
- Diagnostic ranges sometimes point at whitespace/zero-length; squiggle fallback needed.
- Suppression signature policy needs to avoid being too broad (false hiding) or too specific (annoying).
- Kotlin/clangd may emit large diagnostic bursts; overlay must remain performant.

## Validation checklist

- Open unsaved edits → diagnostics reflect in-memory text.
- Squiggles appear/disappear as edits happen.
- Overlay shows full line + all issues on that line.
- Next/prev navigates consistently.
- Dismiss persists across reloads and project switches (HistoryStore/sidecar SSOT).

