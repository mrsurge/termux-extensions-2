# Search by Changes - Technical Deep Dive
**Date:** 2025-11-21

## 1. Core Architecture

The "Search by Changes" feature is built on a decoupled architecture where the backend provides raw git data and the frontend handles presentation and interactive filtering.

### 1.1 Component Stack
*   **Frontend:** Vanilla JS (`explorer.js`), CSS (`explorer.css`).
*   **Backend:** Python/Flask (`main.py`), Git Utilities (`git_helper.py`, `diff_helper.py`).
*   **Persistence:** JSON Store (`history_store.py`).

## 2. Data Flow

### 2.1 Initialization & State
1.  **Bootstrap:** When the explorer loads, it fetches the current project state.
2.  **Diff Base Resolution:** The backend checks `HistoryStore` for a `diff_base` key (default: `HEAD`).
3.  **Consistency:** This base ref is injected into the global `gitDiffBase` state object in `explorer.js`.

### 2.2 Fetching Changes
*   **Endpoint:** `GET /explorer/search?mode=changes`
*   **Execution:**
    1.  Backend retrieves the active `diff_base`.
    2.  Calls `diff_helper.collect_diff(project_root, path, base_ref)`.
    3.  Executes `git diff --unified=0 <base_ref> -- <path>` to get minimal context hunks.
    4.  Returns a JSON payload containing file paths, status codes (M, A, D), and an array of diff hunks.

### 2.3 Client-Side Rendering & Filtering
To maximize performance, the frontend fetches the data *once* and performs all subsequent filtering in memory.

*   **Cache:** `lastChangesData` holds the raw API response.
*   **Container:** `lastChangesContainer` holds the DOM reference.
*   **Logic (`applyChangesFilter`):**
    *   **Map/Filter Pipeline:** Iterates over `lastChangesData.changes`.
    *   **Shallow Copies:** Creates shallow copies of change objects to modify their `hunks` array without mutating the master cache.
    *   **Regex/String Matching:** Checks `change.rel` (filename) and `hunk.lines` (content) against the user query.

## 3. Filtering Logic Details

The filtering system supports three distinct modes of operation, implemented in `explorer.js`:

1.  **Standard Mode (Filter ON):**
    *   **Criteria:** `(Filename Match) OR (Any Hunk Match)`
    *   **Behavior:** If a file matches, it is displayed. If the match was only in the filename, *all* hunks are still shown to provide context.

2.  **Filename Only:**
    *   **Criteria:** `(Filename Match)`
    *   **Behavior:** Content is ignored. Useful for finding specific files in a large changeset.

3.  **Hunks Only:**
    *   **Criteria:** `(Hunk Content Match)`
    *   **Behavior:**
        *   Iterates through `change.hunks`.
        *   Filters the `hunks` array to keep *only* those containing the query string.
        *   If a file has matching hunks, it is shown with *only* those hunks.
        *   If a file matches by name but has no matching hunks, it is shown as a "header only" (empty hunk list).

## 4. Highlighting Implementation

Highlighting is applied dynamically during the DOM generation phase (`renderChangesList`).

*   **Helper:** `highlightText(text, query, className)` splits the string and wraps matches in `<span>` tags.
*   **Styles:**
    *   `.fe-highlight-file`: `#0f172a` text on `#e2e8f0` bg (Filenames).
    *   `.fe-highlight-text`: `#ffffff` text on `rgba(148, 163, 184, 0.18)` bg (Diff Content).
*   **Conditional Logic:**
    *   Filenames are always highlighted if they match.
    *   Diff content is highlighted *unless* "Filename Only" mode is active (to reduce visual noise when content isn't the search target).

## 5. Backend Implementation Details

### 5.1 `history_store.py`
*   **`set_diff_base(project, ref)`:** Normalizes the project path and saves the ref. Includes diagnostic logging to track "Sticky HEAD" issues.
*   **`get_diff_base(project)`:** Retrieves the ref, defaulting to `HEAD` if missing or invalid.

### 5.2 `diff_helper.py`
*   **`collect_diff`:**
    *   Accepts `base_ref`.
    *   Uses `git diff --unified=0` to minimize payload size (we only want the changes, not surrounding code).
    *   Parses raw git output into structured JSON (oldStart, newStart, lines array).
    *   Implements caching (`_DIFF_CACHE`) to prevent spawning git processes on every keystroke or minor UI refresh.

## 6. Future Considerations
*   **Virtualization:** For extremely large diffs (1000+ files), the current DOM rendering might need virtualization (rendering only visible items).
*   **Syntax Highlighting:** Currently, diffs are plain text. Integrating CodeMirror or a lightweight tokenizer for the diff views would enhance readability.
