# Footer Functionality Restoration Plan for Explorer v2

**Timestamp:** 2025-11-30T23:55:00Z  
**Author:** _VectorArc_

---

## Executive Summary

Restore the drawer footer functionality in the new WS-driven `explorer.js` (v2) to match the old explorer's capabilities. The footer includes:

1. **Status Bar** – Displays git summary: `<branch> · staged N · changes N · untracked N`
2. **Action Buttons Row 1** – Stage All, Unstage All, Commit…, Push, Pull  
3. **Action Buttons Row 2** – Reset (hard)… (left-aligned), Status Selector (right-aligned, already implemented)

All data flows and intents must go through the existing WebSocket protocol (`/ws/app/file_editor_cm6/explorer`).

---

## Current State Analysis

### What Exists in `template.html` (DOM)
The footer structure is already present:
```html
<footer class="fe-git-footer">
  <div class="fe-git-row fe-git-meta">
    <div id="fe-git-summary" class="fe-git-summary">Git status unavailable.</div>
  </div>
  <div class="fe-git-row fe-git-actions">
    <button id="fe-git-init" class="fe-btn" type="button" style="display: none;">Initialize Git</button>
    <button id="fe-git-stage" class="fe-btn" type="button">Stage All</button>
    <button id="fe-git-unstage" class="fe-btn" type="button">Unstage All</button>
    <button id="fe-git-commit" class="fe-btn" type="button">Commit…</button>
    <button id="fe-git-push" class="fe-btn" type="button">Push</button>
    <button id="fe-git-pull" class="fe-btn" type="button">Pull</button>
    <button id="fe-git-reset" class="fe-btn" type="button" style="color: #ef4444;">Reset (hard)…</button>
    <button id="fe-git-base-btn" class="fe-btn fe-git-status-btn" type="button" style="margin-left: auto;">Status: HEAD ▾</button>
    <div id="fe-git-base-dd" class="fe-dropdown"></div>
  </div>
</footer>
```

### What Exists in Backend (`explorer_ws.py`)
The dispatcher already has all the handlers we need:
- `handle_git_status` – broadcasts `git:status`
- `handle_git_stageAll` – stages all, broadcasts status
- `handle_git_unstageAll` – unstages all, broadcasts status
- `handle_git_commit` – commits with message, broadcasts status
- `handle_git_push` – pushes changes, broadcasts status
- `handle_git_pull` – pulls changes, broadcasts status
- `handle_git_reset` – hard reset, broadcasts status
- `handle_git_init` – initializes repo, broadcasts status
- `handle_git_setDiffBase` – sets diff base, broadcasts `git:diffBaseSet`
- `handle_git_listCommits` – returns commits for dropdown

### What Exists in Current `explorer.js` (v2)
- `uiState.gitStatus` – stores git status object
- `gitSummaryEl` reference – points to `#fe-git-summary`
- `renderGitSummary()` – partially implemented (only shows branch, ahead/behind)
- `handleExplorerEvent` – handles `git:status` event but only calls `renderGitSummary()`
- `gitBaseBtn` and `gitBaseDropdown` – status selector button + dropdown (working)
- `initDiffBaseFromBackend()` – fetches diff base on init

### What's Missing in Current `explorer.js` (v2)
1. **Status bar not showing full counts**: `renderGitSummary()` only shows `branch ↑N ↓N` but not `staged N · changes N · untracked N`
2. **No button references**: No `gitButtons` object capturing all action buttons
3. **No button event handlers**: No click listeners for Stage All, Unstage All, etc.
4. **No `setGitControlsEnabled()` function**: To enable/disable buttons based on repo state
5. **No `git:init` handling**: Button exists but no handler in v2
6. **No toast integration**: Need to use `toast()` for user feedback on actions
7. **Layout issue**: Reset button and Status selector need to be on a second row with Reset left-aligned and Status right-aligned

---

## Implementation Plan

### Phase 1: Expand `renderGitSummary()` to Show Full Status

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`

**Changes:**
1. Update `renderGitSummary()` to match the old explorer format:
   ```
   <branch> [↑N] [↓N] · staged N · changes N · untracked N
   ```
2. Extract counts from `uiState.gitStatus`:
   - `staged.length`
   - `unstaged.length`
   - `untracked.length`

**Data flow:** `git:status` message → `handleExplorerEvent` → `renderGitSummary()`

---

### Phase 2: Add Git Button References and State Management

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`

**Changes:**
1. Add module-level `gitButtons` object:
   ```js
   let gitButtons = {
     init: null,
     stage: null,
     unstage: null,
     commit: null,
     push: null,
     pull: null,
     reset: null,
   };
   ```

2. In `initExplorerUI()`, capture all button references:
   ```js
   gitButtons = {
     init: document.getElementById('fe-git-init'),
     stage: document.getElementById('fe-git-stage'),
     unstage: document.getElementById('fe-git-unstage'),
     commit: document.getElementById('fe-git-commit'),
     push: document.getElementById('fe-git-push'),
     pull: document.getElementById('fe-git-pull'),
     reset: document.getElementById('fe-git-reset'),
   };
   ```

3. Add `setGitControlsEnabled(enabled, showInit = false)` function:
   - When `enabled === false`: disable all action buttons
   - When `showInit === true`: show Init button, hide others
   - When `enabled === true && showInit === false`: enable all normal buttons, hide Init

---

### Phase 3: Wire Up Button Click Handlers

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`

**Changes:**
Add event listeners in `initExplorerUI()` that send WS messages:

| Button       | WS Message Type    | Payload                     | Notes                          |
|--------------|--------------------|-----------------------------|--------------------------------|
| Stage All    | `git:stageAll`     | `{}`                        | Simple broadcast trigger       |
| Unstage All  | `git:unstageAll`   | `{}`                        | Simple broadcast trigger       |
| Commit…      | `git:commit`       | `{ message: "<user input>" }`| Prompt for message, validate   |
| Push         | `git:push`         | `{}`                        | Confirm before sending         |
| Pull         | `git:pull`         | `{}`                        | Confirm before sending         |
| Reset (hard) | `git:reset`        | `{ commit: "HEAD" }`        | Show commits, confirm danger   |
| Init         | `git:init`         | `{}`                        | Confirm before sending         |

**Implementation pattern:**
```js
gitButtons.stage?.addEventListener('click', () => {
  if (typeof window.__explorerBusSend === 'function') {
    window.__explorerBusSend('git:stageAll', {});
  }
});
```

For Commit, need prompt:
```js
gitButtons.commit?.addEventListener('click', () => {
  const staged = uiState.gitStatus?.staged || [];
  if (!staged.length) {
    toast('No staged changes to commit.');
    return;
  }
  const message = window.prompt('Commit message');
  if (!message?.trim()) {
    toast('Commit message cannot be empty.');
    return;
  }
  window.__explorerBusSend('git:commit', { message: message.trim() });
});
```

For Push/Pull, need confirm:
```js
gitButtons.push?.addEventListener('click', () => {
  if (window.confirm('Push changes to remote?')) {
    window.__explorerBusSend('git:push', {});
  }
});
```

For Reset, need commit list and confirm:
```js
gitButtons.reset?.addEventListener('click', async () => {
  // Fetch commits for display
  // Show danger confirmation
  // Send git:reset with commit: 'HEAD'
});
```

---

### Phase 4: Handle Backend Responses

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`

**Changes:**
Extend `handleExplorerEvent()` to handle additional event types:

| Event Type       | Action                                       |
|------------------|----------------------------------------------|
| `git:status`     | Update `uiState.gitStatus`, call `renderGitSummary()`, enable/disable controls |
| `git:restored`   | Toast success, potentially reload current file |
| `git:diffBaseSet`| Update `gitDiffBase`, update selector labels |

After receiving `git:status`, determine if repo exists:
- If `uiState.gitStatus` is null or has no `branch` → show Init button
- Otherwise → show normal buttons

---

### Phase 5: Reload Current File After Certain Actions

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`

**Changes:**
After commit, push, pull, reset operations complete (when `git:status` arrives as confirmation), consider calling:
```js
if (typeof window.__cm6ReloadCurrentFile === 'function') {
  window.__cm6ReloadCurrentFile();
}
```

The old explorer did this for commit and reset. We can detect these by tracking "pending action" state or by adding a `lastAction` field to the git:status response (backend change, optional).

Simpler approach: Always reload after receiving `git:status` if the user just performed an action. Use a flag like `pendingGitAction = true` before sending, clear after receiving.

---

### Phase 6: Layout Adjustment for Two-Row Footer

**File:** `app/apps/file_editor_cm6/static/js/explorer.css` (or inline in template.html styles)

**Changes:**
Restructure the footer to have two rows:
- **Row 1:** Stage All, Unstage All, Commit…, Push, Pull
- **Row 2:** Reset (hard)… (left) | Status Selector (right, `margin-left: auto`)

This may require either:
1. Adding a second `<div class="fe-git-row">` in template.html
2. OR using CSS flex-wrap with order properties

**Recommended approach:** Minor HTML restructure in `template.html`:
```html
<footer class="fe-git-footer">
  <div class="fe-git-row fe-git-meta">
    <div id="fe-git-summary" class="fe-git-summary">Git status unavailable.</div>
  </div>
  <div class="fe-git-row fe-git-actions fe-git-actions-primary">
    <button id="fe-git-init" class="fe-btn" type="button" style="display: none;">Initialize Git</button>
    <button id="fe-git-stage" class="fe-btn" type="button">Stage All</button>
    <button id="fe-git-unstage" class="fe-btn" type="button">Unstage All</button>
    <button id="fe-git-commit" class="fe-btn" type="button">Commit…</button>
    <button id="fe-git-push" class="fe-btn" type="button">Push</button>
    <button id="fe-git-pull" class="fe-btn" type="button">Pull</button>
  </div>
  <div class="fe-git-row fe-git-actions fe-git-actions-secondary">
    <button id="fe-git-reset" class="fe-btn" type="button" style="color: #ef4444;">Reset (hard)…</button>
    <button id="fe-git-base-btn" class="fe-btn fe-git-status-btn" type="button" style="margin-left: auto;">Status: HEAD ▾</button>
    <div id="fe-git-base-dd" class="fe-dropdown"></div>
  </div>
</footer>
```

---

### Phase 7: Initial State Hydration on Load

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`

**Changes:**
In `initExplorerUI()`, after capturing button refs:
1. Call `setGitControlsEnabled(false)` initially (disabled until we know state)
2. When `project:setActive` arrives and then `git:status` arrives, enable controls appropriately

The WS dispatcher already sends `git:status` on connect via `broadcast_git_status()` in `initialize()`.

---

## File Change Summary

| File | Changes |
|------|---------|
| `app/apps/file_editor_cm6/static/js/explorer.js` | Add `gitButtons` refs, `setGitControlsEnabled()`, button handlers, expand `renderGitSummary()`, expand `handleExplorerEvent()` for control state |
| `app/apps/file_editor_cm6/template.html` | Split footer buttons into two rows (primary + secondary) |
| `app/apps/file_editor_cm6/static/js/explorer.css` | (Optional) Minor styling for two-row layout if needed |

---

## Protocol Messages Used

### Outbound (Client → Server)
| Type | Payload | Handler |
|------|---------|---------|
| `git:stageAll` | `{}` | `handle_git_stageAll` |
| `git:unstageAll` | `{}` | `handle_git_unstageAll` |
| `git:commit` | `{ message: string, amend?: bool }` | `handle_git_commit` |
| `git:push` | `{ remote?: string, branch?: string, force?: bool }` | `handle_git_push` |
| `git:pull` | `{ remote?: string, branch?: string, rebase?: bool }` | `handle_git_pull` |
| `git:reset` | `{ commit: string }` | `handle_git_reset` |
| `git:init` | `{}` | `handle_git_init` |
| `git:listCommits` | `{ limit?: number }` | `handle_git_listCommits` |

### Inbound (Server → Client)
| Type | Payload | Notes |
|------|---------|-------|
| `git:status` | `{ branch, detached, ahead, behind, staged, unstaged, untracked }` | Primary state snapshot |
| `git:commits` | `{ commits: [...] }` | Response to `git:listCommits` |
| `git:diffBaseSet` | `{ ref: string }` | After diff base change |
| `git:restored` | `{ path: string }` | After file restore |

---

## Testing Plan (Placeholder)

*Testing steps to be determined in a separate phase.*

Suggested verification points:
1. Status bar shows correct counts after various operations
2. Each button triggers the correct WS message
3. Buttons enable/disable correctly based on repo state
4. Init button appears for non-git projects, hides for git projects
5. Commit validation works (no staged changes, empty message)
6. Confirm dialogs appear for Push, Pull, Reset
7. File reloads after commit/reset
8. Status selector still works (already implemented)
9. Layout looks correct on mobile and desktop

---

## Dependencies & Risks

1. **No new backend changes needed** – All handlers exist in `explorer_ws.py`
2. **DOM already present** – Just needs JS wiring
3. **Low risk** – This is additive code, no removal of existing functionality
4. **Potential edge case** – Need to handle WS disconnect gracefully (buttons should disable)

---

_Plan complete. Ready for implementation._

— _VectorArc_
