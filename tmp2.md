# TRACE FINDINGS: Explorer File Open Path

**Investigator:** Atlas  
**Date:** 2025-11-17 19:45 UTC  

---

## **TRACED PATH: Explorer Drawer File Card Click**

### **User Action:** Click file in explorer tree

### **Execution Flow:**

**Step 1:** Click event on file entry  
**Location:** `explorer.js` line 902  
**Handler:** `onTreeClick(ev)`  
**Code:**
```javascript
} else {
  // File clicked - open it
  openFileRel(rel, currentProjectPath);  // ← Line 902
  // Close drawer after opening file
  const root = document.querySelector('.fe-root');
  root?.classList.remove('drawer-open');
}
```

**Step 2:** Explorer calls openFileRel helper  
**Location:** `explorer.js` line 1461  
**Code:**
```javascript
function openFileRel(rel, projectRoot) {
  if (window.appOpenFileRel) {
    window.appOpenFileRel(rel, projectRoot);  // ← Calls main.js
  } else {
    console.error('appOpenFileRel not available');
  }
}
```

**Step 3:** main.js converts relative to absolute  
**Location:** `main.js` line 1989  
**Code:**
```javascript
window.appOpenFileRel = (rel, projectRoot) => {
  // Convert relative path to absolute using project root
  const base = projectRoot || cachedProjectRoot || HOME_DIR;
  const abs = toAbsolute(rel, base, HOME_DIR);  // ← Path resolution
  openFile(abs).catch(e => {  // ← Calls unified opener
    host.toast(`Failed to open: ${e.message}`);
  });
};
```

**Step 4:** Unified file opener  
**Location:** `main.js` line 1303  
**Function:** `openFile(path, options)`  
**Does:**
- Validates project context
- Calls `/api/app/file_editor_cm6/read` (application backend)
- Calls `/api/app/file_editor_cm6/editor/set_content` (NiceGUI iframe)
- Updates history via `/api/app/file_editor_cm6/state/file_activity`
- Opens WebSocket connection
- Initializes diff controller
- Syncs session state
- Updates frontend state (`currentPath`, `lastSha256`)

---

## **CRITICAL FINDING: Search Uses Wrong Path**

### **What Search Currently Does (WRONG):**

**Name Mode:**
```javascript
window.appOpenFile(item.path);  // ← Uses absolute path
```

**Content Mode:**
```javascript
await window.appOpenFile(fileResult.path);  // ← Uses absolute path
```

###  **What Explorer Does (CORRECT):**

```javascript
openFileRel(rel, currentProjectPath);  // ← Uses relative path + project root
  → window.appOpenFileRel(rel, projectRoot)
```

### **Why This Matters:**

1. **Path Resolution:** `appOpenFileRel` handles path resolution correctly with project context
2. **Consistency:** Same code path as explorer means same behavior
3. **Project Context:** Ensures file is opened relative to current project root

---

## **THE FIX**

### **Change Search Results to Match Explorer:**

**Name Mode (explorer.js line ~1726):**

**Before:**
```javascript
if (window.appOpenFile) {
  window.appOpenFile(item.path);  // ← Wrong: uses absolute path
}
```

**After:**
```javascript
if (window.appOpenFileRel) {
  window.appOpenFileRel(item.rel, currentProjectPath);  // ← Correct: matches explorer
}
```

**Content Mode (explorer.js line ~1780):**

**Before:**
```javascript
await window.appOpenFile(fileResult.path);  // ← Wrong: uses absolute path
```

**After:**
```javascript
await window.appOpenFileRel(fileResult.rel, currentProjectPath);  // ← Correct: matches explorer
```

---

## **WHY IT MATTERS**

Using `appOpenFileRel` instead of `appOpenFile`:
- ✅ Matches explorer behavior exactly
- ✅ Proper path resolution with project context
- ✅ Same code path = same guarantees
- ✅ Backend search returns `.rel` field anyway (not absolute path)

---

## **NiceGUI CODEMIRROR LINE JUMP**

Searched `../niceguijson-doc/sitewide_index.json` for line jump instructions.

**Result:** No specific documentation for jumping to lines programmatically.

**Current Implementation:** Direct JavaScript execution accessing CM6 view:
```javascript
ui.run_javascript(f'''
    const view = document.querySelector(".cm-editor")?.cmView.view;
    if (view) {{
        const line = Math.max(1, Math.min({target_line}, view.state.doc.lines));
        const pos = view.state.doc.line(line).from;
        view.dispatch({{
            selection: {{ anchor: pos }},
            scrollIntoView: true
        }});
        view.focus();
    }}
''')
```

This is correct - it's the standard CM6 API for line navigation.

---

## **RECOMMENDATION**

1. ✅ Keep simplified `/editor/jump_to_line` (scroll only) - correct approach
2. ✅ Change search to use `window.appOpenFileRel()` - matches explorer
3. ✅ Use `item.rel` not `item.path` - matches backend response
4. ✅ Current line jump implementation is correct

---

_Trace complete: 2025-11-17 19:45 UTC_
