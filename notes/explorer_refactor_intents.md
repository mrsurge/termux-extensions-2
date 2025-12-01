# Explorer Refactor – Discovery Phase

This document captures the existing data bindings and user intents found in `explorer.js`. It serves as the specification for the new `explorerDom` adapter and the WebSocket protocol.

## 1. Dataset & DOM Inventory Form
*Mapping the current DOM attributes to backend data fields.*

| DOM Attribute / Class | Element | Usage / Logic | Mapped Backend Field |
| :--- | :--- | :--- | :--- |
| `data-rel` | `li.fe-tree-node` | Unique ID for file operations & updates. | `entry.rel` |
| `data-kind` | `li.fe-tree-node` | Distinguishes `dir` vs `file` for click behavior & icons. | `entry.kind` |
| `data-open` | `li.fe-tree-node` | Tracks expansion state (`true`/`false`). | *(UI State)* |
| `data-name` | `li.fe-tree-node` | Used for prompt defaults (rename, copy). | `entry.name` |
| `data-has-draft` | `li.fe-tree-node` | Controls "unsaved" styling (`1`/`0`). | `entry.hasDraft` |
| `data-git-status` | `li.fe-tree-node` | Stores status code (`modified`, `untracked`...) for badge logic. | `entry.gitStatus` |
| `.fe-git-*` | `li` class | Styling for Git status (e.g., `.fe-git-modified`, `.fe-git-ignored`). | `entry.gitStatus` |
| `.fe-entry-*` | `span` class | Icons/Styling (e.g., `.fe-entry-exec`, `.fe-entry-symlink`). | `entry.isExecutable`, `entry.isSymlink` |
| `.fe-draft` | `li` class | Visual yellow accent for files with drafts. | `entry.hasDraft` |
| `.fe-draft-parent` | `li` class | visual yellow accent for parent directories of drafts. | *(Derived from children)* |

---

## 2. User Intent Inventory Form
*Mapping user actions to proposed WebSocket commands.*

### Core Navigation
| Intent Name | Trigger (UI Event) | Current Implementation | Proposed WS Command |
| :--- | :--- | :--- | :--- |
| **Open File** | Click `li[data-kind="file"]` | `openFileRel(rel)` → `fetch('/read')` | `explorer:open` |
| **Toggle Dir** | Click `li[data-kind="dir"]` | `fetch('/explorer/list?rel=...')` | `explorer:toggleExpand` |
| **Refresh Tree** | Manual / Auto-trigger | `refreshTree()` | `explorer:refresh` |

### File Operations
| Intent Name | Trigger (UI Event) | Current Implementation | Proposed WS Command |
| :--- | :--- | :--- | :--- |
| **Add File** | Context Menu | `fetch('/explorer/touch')` | `explorer:createFile` |
| **Add Directory** | Context Menu | `fetch('/explorer/mkdir')` | `explorer:createDir` |
| **Rename** | Context Menu | `fetch('/explorer/rename')` | `explorer:rename` |
| **Delete** | Context Menu | `fetch('/explorer/delete')` | `explorer:delete` |
| **Copy To** | Context Menu | `fetch('/explorer/copy')` | `explorer:copy` |
| **Move To** | Context Menu | `fetch('/explorer/move')` | `explorer:move` |
| **Copy From** | Context Menu | `fetch('/explorer/copy_from')` | `explorer:copyFrom` |
| **Move From** | Context Menu | `fetch('/explorer/move_from')` | `explorer:moveFrom` |
| **Batch Copy** | Select Mode -> Menu | `fetch('/explorer/batch_copy')` | `explorer:batchCopy` |
| **Batch Move** | Select Mode -> Menu | `fetch('/explorer/batch_move')` | `explorer:batchMove` |
| **Batch Delete** | Select Mode -> Menu | `fetch('/explorer/batch_delete')` | `explorer:batchDelete` |
| **Open in File Explorer** | Context Menu | `fetch('/api/apps/file_explorer/open')` | `explorer:openExternal` |

### Git Operations
| Intent Name | Trigger (UI Event) | Current Implementation | Proposed WS Command |
| :--- | :--- | :--- | :--- |
| **Git Status** | Load / Refresh | `fetch('/git/status')` | `git:status` |
| **Stage File** | Context Menu | `fetch('/git/stage')` | `git:stage` |
| **Unstage File** | Context Menu | `fetch('/git/unstage')` | `git:unstage` |
| **Stage All** | Toolbar Button | `fetch('/git/stage_all')` | `git:stageAll` |
| **Unstage All** | Toolbar Button | `fetch('/git/unstage_all')` | `git:unstageAll` |
| **Batch Stage** | Select Mode -> Menu | `fetch('/git/stage')` (list) | `git:stage` |
| **Batch Unstage** | Select Mode -> Menu | `fetch('/git/unstage')` (list) | `git:unstage` |
| **Commit** | Toolbar Button | `fetch('/git/commit')` | `git:commit` |
| **Push** | Toolbar Button | `fetch('/git/push')` | `git:push` |
| **Pull** | Toolbar Button | `fetch('/git/pull')` | `git:pull` |
| **Reset Hard** | Toolbar Button | `fetch('/git/reset_hard')` | `git:reset` |
| **Git Init** | Toolbar Button | `fetch('/git/init')` | `git:init` |
| **Change Diff Base** | Dropdown | `fetch('/git/diff_base')` | `git:setDiffBase` |
| **Restore File** | Context Menu | `fetch('/git/restore')` | `git:restore` |

### Search & Review
| Intent Name | Trigger (UI Event) | Current Implementation | Proposed WS Command |
| :--- | :--- | :--- | :--- |
| **Search (Name/Content)** | Input `keyup` | `fetch('/explorer/search')` | `search:run` |
| **Search (Changes)** | Tab Click | `fetch('/explorer/search?mode=changes')` | `search:run` |
| **Review List** | Tab Click | `fetch('/review/list')` | `review:list` |
| **Review Save** | Button Click | `fetch('/review/save')` | `review:save` |
| **Review Discard** | Button Click | `fetch('/review/discard')` | `review:discard` |

### Project & System
| Intent Name | Trigger (UI Event) | Current Implementation | Proposed WS Command |
| :--- | :--- | :--- | :--- |
| **Open Project** | Button Click | `fetch('/project/open')` | `project:open` |
| **Create Project** | Button Click | `fetch('/project/create')` | `project:create` |
| **Clone Repo** | Button Click | `fetch('/git/clone')` | `git:clone` |
| **Clear Recents** | Menu Item | `fetch('/history/files/all')` | `history:clearRecents` |
| **Remove Recent** | Menu Item | `fetch('/history/file')` | `history:removeRecent` |
