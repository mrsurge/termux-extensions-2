# Code TE2 Major UI Changes Proposal

## Objective

Replace the stale File/Edit/Editor/View menubar and Recents dropdown with:

- one consolidated toolbar for commands and status controls
- one horizontally scrollable recent-file tab strip
- one shared fullscreen action for every bottom-drawer panel

The editor continues to keep exactly one active file/model at a time. Tabs are
a bounded projection of recent files, not a multi-model lifecycle authority.

## Authority

`ProjectSidecar.recent_files` remains the authoritative, project-scoped,
12-entry file history. `ProjectSidecar.last_file` remains active-file
authority.

Browser localStorage may retain only visual tab ordering. It must not add tabs,
retain tabs removed by the backend, choose the active file, or rewrite backend
MRU order.

The merge rule is:

1. retain locally ordered paths that still occur in the backend projection
2. append newly projected backend paths in backend MRU order
3. discard local paths that no longer occur in the backend projection

## Chrome Layout

### Toolbar

Remove `.fe-menubar` completely. Move its controls into `.fe-toolbar` in this
order:

1. File
2. Edit
3. Editor
4. View
5. Branch

The branch control keeps its existing dropdown behavior and uses the vendored
Git Codicon as its visible trigger. The active branch remains available through
accessible text and the control title.

The toolbar no longer renders the active filename. The active file is shown by
the active tab. Existing Explorer, issue, run, adapter, and sidebar controls
remain in the toolbar.

### File Tabs

The former menubar grid row becomes a file-tab viewport. Tabs have square
corners and compact rectangular geometry; "square" does not mean a forced 1:1
aspect ratio.

Each tab contains:

- a corrected file-type Codicon
- the file label
- an optional diagnostics marker
- a close button whose hit target spans the complete tab height

The active tab uses the Explorer active-file accent. File tabs reuse Explorer
file-card rules for:

- Git modified, staged, added, deleted, renamed, untracked, ignored, and
  conflict states
- right-edge unsaved draft indication
- error and warning diagnostics indication

Directory aggregation, sticky scopes, folder animation, and card menus do not
apply to tabs.

## Interaction

### Open

Selecting a tab uses the existing host `openFile` transaction. It does not
create a parallel editor-open path.

### Close

Closing a non-active tab removes only that entry from
`ProjectSidecar.recent_files`.

Closing the active tab:

1. chooses the visual tab to the right, or the left tab when no right tab exists
2. opens that successor through the existing `openFile` transaction
3. removes the former active entry through typed UI IPC

Closing the final tab clears backend active-file state and resets the host to
its no-file presentation.

The backend close mutation operates directly on `ProjectSidecar`, bumps the
open-state revision once, saves once, and publishes the existing
`OpenStateChanged` fact. The legacy `HistoryStore` file mirror is not authority.

### Scroll And Reorder

- mouse wheel deltas scroll the tab viewport horizontally
- touch swipes use native horizontal scrolling
- mouse drag reorders immediately
- touch drag reorder starts after a short long press, keeping normal swipes
  available for scrolling
- close-button gestures never open or reorder a tab

Reordering writes only the project-scoped localStorage presentation key.

## Decoration Projection

The host must not inspect Explorer DOM or consume Explorer RPC directly.

A bounded backend projector consumes the existing worker facts:

- `OpenStateChanged`
- `GitSnapshotChanged`
- `DraftStateChanged`
- `DiagnosticsDetailChanged`

It emits a lightweight UI IPC projection for only the current recent-file
entries. The projection is generation-guarded and carries no file content,
diagnostic messages, or Git diff bodies.

## Drawer Fullscreen

Move the existing bottom-drawer fullscreen action into shared drawer chrome.
Terminal, Console, Problems, Extensions, and Code Inspector all use the same
drawer-level fullscreen state. Panel-specific headers retain only
panel-specific controls.

## Validation

- focused Python tests for sidecar removal, successor handling, and revision
  changes
- focused frontend tests for merge order, close selection, Codicons,
  scrolling, and reorder persistence
- focused drawer sizing/fullscreen tests where practical
- `npm run typecheck`
- `node build.mjs`
- `git diff --check`

Android asset publication, release version changes, and framework restarts are
outside this slice.
