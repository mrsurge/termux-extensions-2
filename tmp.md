# Code CM6 — Issues Overlay (UX Draft)

### 5) Inline squiggles (always-on when diagnostics exist)
- When the active file’s LSP provides diagnostics, the editor shows:
  - **Red squiggles** for errors
  - **Yellow squiggles** for warnings
- These apply to the **current buffer** (including unsaved edits), so typing can immediately produce/clear issues.

### 6) Overlay panel (details + navigation)
- A toolbar toggle (e.g. a lightbulb icon) shows/hides the **Issues Overlay**.
- The overlay is rendered inside the editor iframe (so it’s fast and doesn’t require complex host UI).
- When open, it shows:
  - A “No issues” empty state, or
  - The current issue’s **line preview** (one line), plus one or more **issue detail lines** underneath it.
- Two navigation buttons near the filename let the user jump:
  - **Prev issue**
  - **Next issue**
- Jumping moves the cursor/scroll to the issue and updates the overlay contents.

### 7) Dismiss / suppress an issue (per file, per project)
- Each issue entry has an **X** (dismiss).
- Dismissing suppresses that issue for that file in this project (stored on disk with the project’s state), so it won’t reappear unless the suppression is cleared later.
