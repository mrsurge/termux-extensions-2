2025-11-17 05:45 UTC — Plan: Explorer Search (Files & Contents) + Go To Line Integration (Dex)

## Goals
1. Provide a search UI inside the explorer drawer with two modes:
   - **Name Mode**: filter files/folders by name; selecting an item opens the file (scroll to first line).
   - **Contents Mode**: search text within files; results show file + individual match lines; clicking a match opens file and jumps to that line via backend `/editor/jump_to_line`.
2. Replace the legacy “Go To Line” prompt handler in `main.js` with calls to `/editor/jump_to_line` so all navigation goes through the backend.

## UX Overview
- Add a search icon button to the explorer header (next to New/Recents). Clicking opens a full-height search panel overlaying the explorer list.
- Panel layout:
  - Mode toggle (File Names vs Contents) — radio buttons or segmented control.
  - Input field with debounced search (+ clear button).
  - Results area occupying the rest of the drawer:
    * Name mode: list of file cards (path + type). Selecting a result closes search and opens file via existing `openFile()`.
    * Contents mode: grouped results per file. Each file entry collapses/expands to show individual matches (line number + snippet). Clicking a match calls new helper `jumpToFileLine(path, line)` → backend API.
- ESC or closing icon hides the panel and restores original explorer list.

## Backend/Searcher
1. **Endpoint**: add `/explorer/search` under FastAPI blueprint (e.g., `@file_editor_cm6_bp.post('/explorer/search')`). Request body:
   ```json
   { "mode": "name" | "content", "query": "string", "project": "abs/path"? }
   ```
   - Enforce explicit project path: use `_history_store.get_active_project()` if none passed.
   - Reject empty queries (return 400) or treat as clear state.
2. **Name mode logic**:
   - Walk project root with `Path.rglob('*')` (respect existing explorer ignore rules if any).
   - Match files/dirs whose name contains query (case-insensitive). Return limited (e.g., top 200) sorted by depth/name.
3. **Contents mode logic**:
   - For performance, reuse existing git status/diff caches if possible; otherwise implement a batched `ripgrep` call (subprocess) or pure Python scan with short-circuit per file.
   - Each result item: `{ "path": str, "matches": [{"line": int, "snippet": str}] }` truncated to e.g., first 5 matches per file.
   - Consider background worker for large repos; for MVP, synchronous search with timeout.
4. **Security**: ensure all paths stay inside project root; restrict to text files (maybe rely on try/except reading as UTF-8 with replacement).

## Frontend Wiring (Explorer UI)
1. **Template (`template.html`)**:
   - Add search icon button (`fe-explorer-search-btn`) to explorer header.
   - Add hidden search panel structure inside drawer with mode toggle, input, result list, close button.
2. **JS (`static/js/explorer.js` + `main.js`)**:
   - Initialize search controller: manages state, debounced fetch (e.g., 300ms) to `/api/app/file_editor_cm6/explorer/search`.
   - Store last mode/query so panel can restore previous results when reopened.
   - Name mode result click -> call existing `openFile(absPath)` and close panel.
   - Contents mode match click -> call new helper:
     ```javascript
     async function jumpToFileLine(path, line) {
       await apiPost('editor/jump_to_line', { path, line });
     }
     ```
     After call resolves, close search panel.
   - Provide keyboard support: Enter triggers search, ESC closes.
3. **Styling**: add CSS for the overlay, result list, highlight matches, etc.

## Go To Line Menu Update
- Remove legacy prompt+direct CM view access in `main.js` (`bindMenuToggle(miGoto, ...)`).
- Replace with prompt (or custom modal) that collects line number, then calls `jumpToFileLine(currentPath, line)`. If no file open, show toast.
- Ensure backend `/editor/jump_to_line` already exists (confirmed). Handle HTTP errors by displaying toast/log.

## Preferences / Persistence
- No new persistent settings needed, but we might cache last search mode/query in session storage if desired.
- Ensure project root changes clear search results (since file set changes).

## Edge Cases & Testing
1. Empty query → no results; show placeholder text.
2. Large projects: ensure search aborts gracefully if response > time limit; show “too many matches” message.
3. Contents mode encoding issues: fallback to UTF-8 with errors=replace, skip binary files (heuristic: if null byte in first chunk, skip).
4. Jump-to-line after search should close search panel and scroll editor to target line (backend already handles selection + scroll).
5. Verify search panel works on mobile layout (drawer full screen) and respects the explorer width on desktop.

With this plan, we deliver both findability (search by name/contents) and the missing jump-to-line integration, making the editor viable for alpha/beta use.
