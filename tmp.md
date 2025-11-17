2025-11-17 05:45 UTC — Plan: Explorer Search (Files & Contents) + Go To Line Integration (Dex)

## Goals
1. Provide a search UI inside the explorer drawer with two modes:
   - **Name Mode**: filter files/folders by name; selecting an item opens the file (scroll to first line).
   - **Contents Mode**: search text within files; results show file + individual match lines; clicking a match opens file and jumps to that line via backend `/editor/jump_to_line`.
2. Replace the legacy “Go To Line” prompt handler in `main.js` with calls to `/editor/jump_to_line` so all navigation goes through the backend.

## UX Overview
- Add a search icon button to the explorer header (next to existing controls). Clicking opens a full-height search overlay that replaces the list.
- Overlay contains:
  - Mode toggle (name vs contents).
  - Query input with debounced search + clear button.
  - Results list:
    * Name mode: simple file/dir entries showing relative path. Selecting opens file (line 1).
    * Contents mode: grouped by file; expanding shows individual matches with line number/snippet. Clicking a match opens file + jumps to that line.
- ESC or close icon hides the overlay and restores the normal explorer contents.

## Backend `/explorer/search`
- POST body: `{ "mode": "name" | "content", "query": "..." }`. Use `_history_store.get_active_project()` for base path.
- Validate query (non-empty, trimmed). Limit result counts to avoid huge payloads.
- **Name mode**:
  - Walk project root (respect ignore rules). Match case-insensitive substrings in filenames/directories.
  - Return objects `{ path: absolute, rel: relative, type: "file"|"dir" }` sorted by relevance.
- **Contents mode**:
  - For MVP, run `rg --json --line-number --max-count 5` (if available) or implement Python fallback scanning text files.
  - Return `{ path, rel, matches: [{ line, snippet }] }` (snippet trimmed/highlighted).
  - Skip binary files (detect via null bytes or `rg` metadata).
- Ensure everything stays within project root; catch timeouts/errors and return friendly messages.

## Frontend Wiring
- **template.html**: add search button + overlay container (hidden by default) inside explorer markup.
- **explorer.js**:
  - Add state store for `searchMode`, `query`, `results`, `loading`, `error`.
  - Debounce fetch to `/api/app/file_editor_cm6/explorer/search` (e.g., 300ms after typing or on Enter).
  - Render results according to mode; use delegated click handlers to call `openFile` or `jumpToFileLine` helper.
  - Provide keyboard support (Enter to search, ESC to close, arrow keys optional).
  - Reset results when project root changes or overlay closed.
- Use `host.toast` to report backend errors/timeouts.

## Go To Line Update
- Currently `miGoto` uses prompt + direct CM view access. Replace with helper:
  ```javascript
  async function jumpToFileLine(path, line) {
    if (!path) { host.toast('No file open'); return; }
    try {
      await apiPost('editor/jump_to_line', { path, line });
    } catch (e) {
      host.toast('Failed to jump: ' + (e?.message || 'unknown error'));
    }
  }
  ```
- Menu handler prompts for line (modal or prompt), validates integer, then calls helper.
- Contents-mode matches re-use the same helper.

## Implementation Steps
1. Backend endpoint + service (search walker + optional ripgrep integration).
2. Frontend overlay UI + state management.
3. Shared `jumpToFileLine` helper + Go To Line menu update.
4. QA across desktop/mobile explorers; test on large repo to ensure acceptable performance.

## Testing Checklist
- Name mode fuzzy match works; clicking opens file top.
- Contents mode pulls multiple matches per file; clicking jumps to correct line.
- Go To Line works via menu even when search panel unused.
- Overlay closes via ESC/button; search state resets properly on project switch.

---

## Additional Requirement: Remove Explorer Collapsible Arrows
- Remove the current arrow/chevron indicators for expandable directories.
- Steps:
  1. Update explorer template markup/CSS to hide or delete the arrow element (no placeholder icon).
  2. Ensure row click still toggles expansion; if logic depended on arrow button, bind click to the entire row or specific region.
  3. Test both desktop and mobile modes to confirm layout remains aligned and there’s no leftover spacing.
