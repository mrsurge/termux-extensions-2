# 2025-11-29 – Jump-To-Line Focus Pipeline (Search / Review / Go-To-Line)

## Summary

The Code CM6 editor supports multiple ways to “jump to a line”:

- Explorer search overlay:
  - **By Contents** (content search)
  - **By Changes** (git changes)
  - **Review Edits** (draft diff review)
- Editor menu:
  - **Go To Line…**

On mobile, some jumps caused the virtual keyboard to pop open even when the user initiated the action from the explorer overlay (outside the editor iframe). The behavior was inconsistent because focus handling varied depending on where the jump was initiated.

We introduced a **focus-aware jump pipeline** that:

- Keeps keyboard behavior predictable across all jump entry points.
- Allows overlay-driven jumps (search / review) to scroll without forcing focus.
- Preserves explicit focus behavior for direct editor actions (Go To Line).

## Previous Behavior

Pipeline (simplified):

1. Explorer overlay click:
   - `explorer.js` → `openFileAndMaybeJump(rel, lineNumber)`
   - Calls `window.appOpenFileRel(rel, currentProjectPath)` and then `window.jumpToCurrentFileLine(lineNumber)`
2. Host main:
   - `main.js` → `jumpToCurrentFileLine(line)`
   - `POST /api/app/file_editor_cm6/editor/jump_to_line` with `{line}`
3. NiceGUI iframe backend:
   - `editor_app.py` → `/jump_to_line` endpoint
   - `editor.jump_to_line(line)` (Python wrapper)
4. Vendored CodeMirror:
   - `codemirror.py` → `run_method('jumpToLine', line)`
   - `codemirror.js` → `jumpToLine(lineNumber)`:

```js
const pos = doc.line(targetLine).from;
this.editor.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
this.editor.focus();  // Always focuses editor
```

Because `jumpToLine` always called `this.editor.focus()`:

- If the editor already had focus, no visible change.
- If the user last interacted with the search overlay, the forced focus **stole** focus back into the editor, causing mobile browsers to show the keyboard after every jump.

## New Design: Focus-Aware Jump Pipeline

We extended the pipeline with a **focus flag** that can be passed from the caller down to CodeMirror:

> `focus = True` (default) for direct editor actions  
> `focus = False` for overlay-driven jumps (search/review) where we want scroll-only behavior

### 1. Host Main – `jumpToCurrentFileLine(line, options)`

- **File:** `app/apps/file_editor_cm6/main.js`
- **Function:** `jumpToCurrentFileLine`

Key changes:

```js
// Helper: Jump to line in current file
async function jumpToCurrentFileLine(line, options = {}) {
  const path = window.currentPath;
  if (!path) {
    host.toast('No file currently open');
    return;
  }
  
  try {
    const targetLine = parseInt(line, 10);
    if (!Number.isFinite(targetLine) || targetLine < 1) {
      host.toast('Invalid line number');
      return;
    }
    const payload = { line: targetLine };
    if (options && Object.prototype.hasOwnProperty.call(options, 'focus')) {
      payload.focus = Boolean(options.focus);
    }
    await apiPost('editor/jump_to_line', payload);
  } catch (e) {
    host.toast('Failed to jump: ' + (e?.message || 'unknown error'));
  }
}

window.jumpToCurrentFileLine = jumpToCurrentFileLine;
```

Notes:

- The helper now accepts an optional `options` object with a `focus` boolean.
- If `focus` is omitted, the backend defaults to `True` (backwards compatible).

### 2. Explorer – `openFileAndMaybeJump(rel, lineNumber, jumpOptions)`

- **File:** `app/apps/file_editor_cm6/static/js/explorer.js`
- **Function:** `openFileAndMaybeJump`

We unified the call sites for **By Contents**, **By Changes**, and **Review Edits** so they can pass `focus:false` when appropriate.

Core helper:

```js
async function openFileAndMaybeJump(rel, lineNumber = null, jumpOptions = {}) {
  if (!window.appOpenFileRel) {
    toast('File opener not available');
    return;
  }
  try {
    await window.appOpenFileRel(rel, currentProjectPath);
    closeDrawerIfMobile();

    if (treeElement) {
      const dirPath = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '.';
      await expandDirectory(treeElement, dirPath);
    }

    if (typeof lineNumber === 'number' && window.jumpToCurrentFileLine) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await window.jumpToCurrentFileLine(lineNumber, jumpOptions);
    }
  } catch (err) {
    toast('Failed to open file: ' + (err?.message || 'unknown error'));
  }
}
```

Key call sites:

- **Search by Changes**:

```js
group.onclick = async () => {
  if (typeof window.__cm6EnsureInlineDiffs === 'function') {
    try { await window.__cm6EnsureInlineDiffs(true); } catch (err) {}
  }
  await openFileAndMaybeJump(change.rel, firstDiffLine(change), { focus: false });
};
```

- **Review Edits – file group click**:

```js
group.onclick = async (event) => {
  if (event?.target?.closest('.fe-review-checkbox')) return;
  const lineEl = event?.target?.closest('[data-line]');
  const line = lineEl ? Number(lineEl.dataset.line || 0) : Number(event?.currentTarget?.dataset?.line || 0);
  if (typeof window.__cm6EnsureInlineDiffs === "function") {
    try { await window.__cm6EnsureInlineDiffs(true); } catch (e) {}
  }
  await openFileAndMaybeJump(entry.rel, line || firstDiffLine(entry), { focus: false });
};
```

- **Review Edits – title click**:

```js
title.onclick = async () => {
  if (typeof window.__cm6EnsureInlineDiffs === "function") {
    try { await window.__cm6EnsureInlineDiffs(true); } catch(e){}
  }
  await openFileAndMaybeJump(entry.rel, firstDiffLine(entry), { focus: false });
};
```

This ensures:

- Search/Review-driven jumps:
  - Open file via `appOpenFileRel`.
  - Expand tree to reveal the file.
  - Scroll to the relevant line **without forcing focus**.
- Direct editor actions (e.g., menu “Go To Line…”) still call `jumpToCurrentFileLine(line)` without `options`, preserving focus behavior.

### 3. NiceGUI Iframe Backend – `/editor/jump_to_line`

- **File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- **Endpoint:** `POST /editor/jump_to_line`

Updated implementation:

```python
@editor_router.post('/jump_to_line')
async def jump_to_line(data: dict = Body(...)):
    """Jump to a line in the currently loaded file. Does NOT load new files."""
    editor = get_active_editor()
    if not editor:
        return {"ok": False, "error": "Editor not ready"}

    try:
        target_line = int(data.get('line', 1))
    except (TypeError, ValueError):
        return {"ok": False, "error": "Invalid line number"}

    focus_flag = data.get('focus')
    should_focus = True if focus_flag is None else bool(focus_flag)

    print(f"[JUMP_TO_LINE] Scrolling to line {target_line}", file=sys.stderr)

    # Use the vendored CodeMirror jump_to_line method
    editor.jump_to_line(target_line, focus=should_focus)

    return {"ok": True, "line": target_line, "focus": should_focus}
```

Notes:

- Backwards compatible: if `focus` is omitted, `should_focus` defaults to `True`.
- The endpoint echoes `focus` in its response for debugging.

### 4. Vendored CodeMirror Proxy – Python Wrapper

- **File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
- **Method:** `CodeMirrorEditor.jump_to_line`

Updated signature and payload:

```python
def jump_to_line(self, line: int, *, focus: bool = True) -> None:
    """Jump to a specific line in the editor.
    
    Args:
        line: The line number to jump to (1-based indexing)
        focus: Whether to focus the editor after scrolling (default: True)
        
    Example:
        editor.jump_to_line(42, focus=False)  # Scroll without triggering focus
    """
    self.run_method('jumpToLine', {"line": line, "focus": focus})
```

### 5. Vendored CodeMirror Implementation – JS Method

- **File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- **Method:** `jumpToLine`

Previous behavior:

```js
jumpToLine(lineNumber) {
  // ...
  this.editor.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  this.editor.focus();  // always focus
}
```

New behavior:

```js
jumpToLine(payload) {
  if (!this.editor) {
    console.warn('[CodeMirror] jumpToLine: editor not ready');
    return;
  }

  let shouldFocus = true;
  let input = payload;
  if (payload && typeof payload === 'object') {
    input = payload.line;
    if (Object.prototype.hasOwnProperty.call(payload, 'focus')) {
      shouldFocus = !!payload.focus;
    }
  }

  const line = parseInt(input, 10);
  if (isNaN(line) || line < 1) {
    console.warn('[CodeMirror] jumpToLine: invalid line number', input);
    return;
  }
  
  try {
    const doc = this.editor.state.doc;
    const maxLine = doc.lines;
    const targetLine = Math.max(1, Math.min(line, maxLine));
    const pos = doc.line(targetLine).from;
    
    this.editor.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true
    });

    if (shouldFocus) {
      this.editor.focus();
    }

    console.log('[CodeMirror] jumpToLine: jumped to line', targetLine, 'focus=', shouldFocus);
  } catch (err) {
    console.error('[CodeMirror] jumpToLine failed:', err);
  }
}
```

## Behavior Matrix

| Entry Point              | Caller                           | `focus` flag | Keyboard Behavior          |
|--------------------------|-----------------------------------|--------------|----------------------------|
| Go To Line… (menu)       | `miGoto` → `jumpToCurrentFileLine(line)` | omitted      | **Focus editor, keyboard shows** |
| Search: By Contents      | `openFileAndMaybeJump(rel, line, {focus:false})` | `false`       | Scroll only, no forced focus |
| Search: By Changes       | Same as above                    | `false`       | Scroll only                 |
| Review Edits – group     | `openFileAndMaybeJump(..., {focus:false})` | `false`       | Scroll only                 |
| Review Edits – title     | Same as above                    | `false`       | Scroll only                 |

## Guidelines for Future Features

When implementing new jump-like features (e.g., “Jump to Definition”, “Search in Selection”):

1. **Use `jumpToCurrentFileLine(line, { focus })` from `main.js`.**
2. **Decide focus behavior explicitly:**
   - Actions originating *inside* the editor (menus, keybindings) should usually pass `focus: true` (or omit the flag).
   - Actions originating *outside* the editor (overlay, drawers, external agents) should usually pass `focus: false` to avoid surprising keyboard pops on mobile.
3. **Avoid direct DOM scroll hacks:**
   - Always use `/editor/jump_to_line` → `editor.jump_to_line` → vendored `jumpToLine`.
   - Do not call `editor.focus()` directly from new code paths—use the focus flag instead.

This keeps the focus semantics centralized and predictable, and avoids reintroducing the keyboard regression we just fixed.

## Related Files

- `app/apps/file_editor_cm6/main.js`
  - `jumpToCurrentFileLine`
- `app/apps/file_editor_cm6/static/js/explorer.js`
  - `openFileAndMaybeJump`, search/review click handlers
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
  - `/editor/jump_to_line` endpoint
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
  - `CodeMirrorEditor.jump_to_line`
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - `jumpToLine` implementation

