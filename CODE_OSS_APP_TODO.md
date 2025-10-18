1. **File/Project History Tabs (d)**  
   - *Why it’s easiest*: Pure client-side state. We already pull file contents via `/file`, so capturing “last opened” metadata only touches the wrapper—no bridge protocol changes.  
   - *How*:  
     - Track a `recentFiles` array (and `recentProjects`) in `teState`.  
     - Render lightweight faux tabs above CM6; clicking a tab reuses `openFileInEditor(path)`.  
     - On close, drop the entry from state; on project switch, preload the last file for that workspace.  
     - Persist project history alongside `codeOss.currentProjectPath`.  
   - *Tweaks*: Add a “pin”/“clear history” affordance to keep the list tidy.

2. **Restore Menu Actions & Auto-Save Toggle (e)**  
   - *Why next*: Menu scaffolding already exists; we just need to wire commands instead of placeholders. Most hooks map to existing bridge commands.  
   - *How*:  
     - For File → “Open…” reuse the Termux file picker and call `openFileInEditor`.  
     - Wire Save/Save As through new backend endpoints that post `replace_full` or `apply_edits` commands once bi-directional editing lands; until then, guard behind auto-save off.  
     - Hook Edit menu to CM6 commands (undo/redo use `cmState.view.dispatch`).  
     - Add an auto-save toggle in `teState`; when off, surface a dirty indicator and enable Save.  
   - *Tweaks*: throttle menu buttons while a command is in flight to avoid duplicate posts.

3. **Richer Explorer Drawer (b)**  
   - *Why mid-tier*: Needs extra data (git status, separators) but can piggyback on existing event flow with some backend help.  
   - *How*:  
     - Extend backend to run lightweight `git status --porcelain` (or lib) per workspace; cache results and attach them to bridge `explorerTree` payloads.  
     - Update drawer renderer to decorate items (badges for modified/untracked, separators between directories, counts).  
     - Optional lazy-fetch children on expand for large repos.  
   - *Tweaks*: add a toggle in settings to disable git indicators for huge repos or non-git folders.

4. **Terminal Panel Replacement (c)**  
   - *Why harder*: Needs streaming IO, lifecycle management, and a UX rethink, but still independent of the editor sync work.  
   - *How*:  
     - Replace assistant panel markup with a tabbed terminal component (reuse shell multiplexing already available in framework shells).  
     - Start with Termux-native shells (fast path); expose env vars like `IDE_CONTEXT=code-oss` so future CLI agents detect IDE mode.  
     - Later, allow secondary tab type that proxies code-server’s terminal via bridge (if we detect its WebSocket endpoint).  
   - *Tweaks*: keep the assistant toggle for now to hide the panel while we experiment; log session metadata so we can resume terminals per project.

5. **Inline Git Diffs (f)**  
   - *Why late-stage*: Requires either editor-side diff overlays or bringing VS Code’s diff into CM6. Achievable once we have richer file metadata and better document handling.  
   - *How*:  
     - Provide a backend endpoint that returns `git diff -- <file>`; render inline gutter highlights via CM6 `Decoration.match`.  
     - Optionally add a “Compare” tab that opens side-by-side diff using CM6 `MergeView`.  
     - Refresh diff markers whenever the drawer reports changes or after save.  
   - *Tweaks*: consider a lightweight badge/tag in the history tabs to indicate files with staged/unstaged changes.

6. **Bi-Directional Streaming Editor (a)**  
   - *Why last*: Needs deep integration with the bridge command queue, conflict resolution, and potentially operational transforms. Everything else benefits from this but doesn’t block on it.  
   - *How*:  
     - Leverage existing `/edits` endpoint: hook CM6 `updateListener` to translate changes into bridge `apply_edits` ops, tracking revisions (`docRevisions` already exists).  
     - Implement debounce + optimistic apply; rollback on `ack` mismatch.  
     - Ensure the bridge extension mirrors changes back (server → client is already working).  
     - Add auto-save/on-demand save flow once stable.  
   - *Tweaks*: introduce a “sync status” indicator in the status bar so users know when the editor is live or read-only fallback.
