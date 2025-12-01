# Explorer V2 – Data & Styling Inventory

This document defines the View Model for the new Explorer V2. It maps backend data fields to their frontend visual manifestations.

## 1. Data Model (File Entry)

| Field Name | Type | Source | Description | Proposed WS Field |
| :--- | :--- | :--- | :--- | :--- |
| `rel` | `string` | `explorer_helper.py` | Project-relative path (Unique ID). | `rel` |
| `name` | `string` | `explorer_helper.py` | Filename for display. | `name` |
| `kind` | `'dir'\|'file'` | `explorer_helper.py` | Determines icon and interaction type. | `kind` |
| `gitStatus` | `string` | `git_helper` + merger | Git status code (e.g., 'modified', 'untracked'). | `git_status` |
| `hasDraft` | `boolean` | `HistoryStore` | True if unsaved changes exist in session cache. | `has_draft` |
| `isExecutable` | `boolean` | `os.stat` | True if executable bit is set. | `is_exec` |
| `isSymlink` | `boolean` | `os.lstat` | True if entry is a symbolic link. | `is_link` |

## 2. Visual Mapping (CSS & DOM)

| Data State | CSS Class | Visual Effect | DOM Attribute |
| :--- | :--- | :--- | :--- |
| `kind === 'dir'` | `.fe-entry-dir` | Folder icon. | `data-kind="dir"` |
| `kind === 'file'` | `.fe-entry-file` | File icon. | `data-kind="file"` |
| `isExecutable` | `.fe-entry-exec` | Bold green text (typically). | - |
| `isSymlink` | `.fe-entry-symlink` | Italic text / Alias badge. | - |
| `hasDraft` | `.fe-draft` | Yellow accent color. | `data-has-draft="1"` |
| `gitStatus` | `.fe-git-[status]` | Color coding (e.g., Red for modified). | `data-git-status="..."` |
| `gitStatus` | *(Badge Element)* | "M", "U", "?" badges appended to name. | - |
| `expanded` | *(Twisty Element)* | Rotates `▸` to `▾`. | `data-open="true"` |

## 3. Global/Context Data

| Field | Source | Usage |
| :--- | :--- | :--- |
| `projectRoot` | Backend | Base path for all relative paths. |
| `diffBase` | Backend/Git | The Git reference used for status comparison (HEAD vs main). |
| `selectMode` | Frontend State | Enables checkboxes for batch operations. |
