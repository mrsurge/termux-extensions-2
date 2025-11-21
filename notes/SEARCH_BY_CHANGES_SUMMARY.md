# Search by Changes - Feature Summary
**Date:** 2025-11-21

## 1. Overview
The "Search by Changes" feature in the Explorer Drawer allows developers to review, filter, and navigate the active changes in their working directory. Unlike standard file or content searches, this mode focuses specifically on what has been modified relative to a selected "Diff Base" (defaulting to `HEAD`).

It serves as a lightweight code review tool and a quick navigation aid for active development tasks.

## 2. Usage Guide

### Accessing the Feature
1.  Open the **Explorer Drawer** (left sidebar).
2.  Click the **Search** icon/tab.
3.  Select **"Changes"** from the mode toggle (options: Name, Content, Changes).

### The Diff Base Selector
*   Located at the top of the results area.
*   Displays the current reference point (e.g., `HEAD`, `main`, or a specific commit hash).
*   **Action:** Click to select a different base commit. This allows you to see changes between your working copy and *any* point in history, not just the latest commit.

### Viewing Results
*   **File List:** Displays modified, added, deleted, or untracked files.
*   **Inline Diffs:** Each file expands to show "hunks" (blocks of changed code) with context.
*   **Navigation:** Clicking a file header or a specific hunk opens the file in the editor and scrolls immediately to that change.

### Filtering & Search
A dedicated filter bar allows you to narrow down the changes:
1.  **Filter (Checkbox):** Activates the filter mode.
2.  **Input Field:** Type to search. Matches are highlighted:
    *   **Filenames:** Dark text on light grey background.
    *   **Code Content:** White text on medium grey background.
3.  **Modes:**
    *   **Standard (Default):** Matches if the query appears in the *Filename* OR the *Diff Content*. Shows full context for matching files.
    *   **Filename only:** Matches *only* the file path. Ignores code content.
    *   **Hunks only:** Matches *only* specific code blocks. Hides non-matching hunks within a file, allowing you to focus on specific code changes across the project.

## 3. Brief Architecture
The feature operates on a "Single Source of Truth" model where the backend dictates the comparison baseline, but the frontend handles high-performance filtering.

*   **Frontend (Client):** Fetches the full list of changes and diffs once. All filtering (Filename/Hunks) happens instantly in the browser using cached data, ensuring a snappy experience even with many changes.
*   **Backend (Server):** The `HistoryStore` persists the selected "Diff Base" for the project. Git commands (`git diff`, `git status`) are executed relative to this stored base.
*   **State:** The selected Diff Base is persistent across sessions. If you compare against a specific commit, that selection remains active until you change it, ensuring consistent views across the editor.
