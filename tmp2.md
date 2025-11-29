## Complete Explorer Feature Assessment (Based on TECHNICAL.md)

### **Additional Features Found in Documentation:**

#### 1. **Draft Parent Styling** ✅ Documented
- Line 1821: "Tree nodes receive `.fe-draft` classes during render"
- Propagates draft status to parent directories
- No explicit WS handler needed (computed during tree generation)

#### 2. **Jump to Line from Search/Review** ✅ Documented & Implemented
- Lines 2002-2024: `openFileAndMaybeJump(rel, lineNumber, jumpOptions)`
- Used by:
  - Search by Changes: `openFileAndMaybeJump(change.rel, firstDiffLine(change), { focus: false })`
  - Review Edits: Click handlers with `{ focus: false }`
- **This is NOT a WS command** - it's a frontend-only helper that:
  1. Opens file via `window.appOpenFileRel(rel, currentProjectPath)`
  2. Expands explorer tree to reveal file
  3. Calls `window.jumpToCurrentFileLine(lineNumber, jumpOptions)`

#### 3. **Select Mode + Batch Operations** ✅ Documented
- Lines 2385-2386: "Select mode with checkboxes" + "Batch operations (copy, move, delete, stage, unstage)"
- Lines 2403-2410: CSS for `.fe-entry-checkbox` visibility toggle
- **Already in WS implementation**: batchDelete, batchCopy, batchMove, batch stage/unstage

#### 4. **Git Actions from Explorer** ✅ Documented
- Line 2387: "Git actions (init, restore, stage/unstage)"
- **Already in WS implementation**: git:init, git:restore, git:stage, git:unstage

#### 5. **Mobile Drawer Behavior** ✅ Documented
- Line 2011: `closeDrawerIfMobile()` after file operations
- Not a WS concern - pure frontend UI behavior

#### 6. **Context Menu System** ✅ Documented
- Lines 2383-2388: "Persistent context menus per card"
- Lines 2414-2432: Menu positioning algorithm
- Not a WS concern - pure frontend UI

---

## **Final Missing Features from WS Implementation:**

Based on TECHNICAL.md cross-referenced with your protocol:

### ❌ **Critical Missing (breaks UI features):**

1. **Search Handlers (0/3)**
   - `search:run` with modes: "name", "content", "changes"
   - Backend exists: lines 70-279 in main.py
   
2. **Review Handlers (0/3)**
   - `review:list`, `review:save`, `review:discard`
   - Backend exists: lines 1295-1411 in main.py
   - Doc reference: lines 1822-1823 describes the full review overlay

3. **Project List Handler (0/1)**
   - `project:list` or `project:listRecent`
   - Backend exists: `_history_store.list_projects()` in stores

4. **Git Commit List Handler (0/1)**
   - `git:listCommits` (for diff base selector)
   - Backend exists: line 1019-1036 in main.py
   - Doc reference: line 2010 uses "diff base" concept

5. **Git Branches Handler (0/1)**
   - `git:listBranches`
   - Backend exists: line 825 in main.py

---

## **Verdict on "Anything Missing?"**

### **From your explorer.js implementation:**
- ✅ File operations (11/11)
- ✅ Git operations (10/10 core, missing 2 read-only queries)
- ❌ Search features (0/3)
- ❌ Review features (0/3)
- ❌ Project queries (0/2)
- ❌ Git queries (0/2)

### **Jump to line is NOT missing** - it's handled differently:
- It's a **frontend composition** of:
  1. File opening (`window.appOpenFileRel`)
  2. Tree expansion (frontend state)
  3. Editor scroll (direct iframe call to `/editor/jump_to_line`)
- No WS protocol needed since it's orchestrated client-side

---

## **Bottom Line:**

Your WS implementation has **27/37 complete handlers (73%)**.

**The 10 missing handlers are all READ operations** (queries for UI dropdowns/lists):
- 3 search modes
- 3 review operations  
- 2 project queries
- 2 git queries

All backend logic exists - you just need to wrap it into WS handlers like you did for the write operations.
