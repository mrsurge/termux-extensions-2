# Search Overlay Containment Investigation

**Date:** 2025-11-17 22:05 UTC  
**Investigator:** Atlas

---

## **Current Structure**

### **HTML Hierarchy:**
```
.fe-root
  └─ .fe-drawer (aside)
      ├─ .fe-drawer-head (header)
      └─ .fe-drawer-body (div)
          ├─ #fe-file-tree (ul.fe-tree)
          ├─ #fe-search-overlay (div.fe-search-overlay)  ← HERE
          └─ .fe-git-footer (footer)
```

### **Current CSS for Search Overlay:**
```css
.fe-search-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg);
  z-index: 10;
  display: none;
  flex-direction: column;
  overflow: hidden;
}
```

### **Parent Container (.fe-drawer-body):**
```css
.fe-drawer-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-x: visible;
  overflow-y: hidden;
  background: var(--explorer-bg);
}
```

---

## **The Problem**

**Overlay positioning:** `position: absolute` with `top/left/right/bottom: 0`

**Issue:** `position: absolute` positions relative to the **nearest positioned ancestor** (an element with `position: relative`, `absolute`, `fixed`, or `sticky`).

**Current behavior:** 
- `.fe-drawer-body` has NO positioning context (no `position` property)
- `.fe-drawer` has NO positioning context
- `.fe-root` has NO positioning context
- Therefore overlay positions relative to **viewport** (entire page)

**Result:** Full-page overlay instead of explorer-scoped overlay

---

## **Desktop vs Mobile Behavior**

### **Desktop:**
- `.fe-drawer` is a side panel (tiled layout)
- Search overlay covering entire viewport = WRONG (obvious)
- Should only cover the explorer panel

### **Mobile:**
- `.fe-drawer` becomes full-page drawer via transform
- Search overlay covering entire viewport = LOOKS OK (accidental)
- But it's still wrong - just happens to match drawer size

---

## **The Fix**

### **Option 1: Add Position Context to Parent** ✅ RECOMMENDED

Add `position: relative` to `.fe-drawer-body`:

```css
.fe-drawer-body {
  position: relative;  /* ← Add this */
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-x: visible;
  overflow-y: hidden;
  background: var(--explorer-bg);
}
```

**Result:** Overlay now positions relative to `.fe-drawer-body`, staying within explorer bounds.

**Pros:**
- Minimal change (1 line)
- Overlay automatically contained on desktop
- Works correctly on mobile (drawer is full-page anyway)
- No JavaScript changes needed
- Follows CSS best practices

**Cons:**
- None (this is the correct approach)

---

### **Option 2: Add Position Context to Drawer**

Add `position: relative` to `.fe-drawer` instead:

```css
.fe-drawer {
  position: relative;  /* ← Add this */
  /* existing styles... */
}
```

**Result:** Overlay positions relative to entire drawer (including header).

**Pros:**
- Also works
- Overlay covers header too (might be desirable?)

**Cons:**
- Overlay would cover header (search button, close button)
- Less precise than scoping to body only
- Could interfere with header interactions

---

### **Option 3: Fixed Positioning with Container Bounds**

Change overlay to `position: fixed` and calculate bounds with JavaScript:

**Cons:**
- Complex JavaScript needed
- Breaks on window resize
- Breaks on drawer open/close
- Not maintainable
- ❌ **Not recommended**

---

## **Recommendation**

**Use Option 1:** Add `position: relative` to `.fe-drawer-body`

**Why:**
1. **Correct semantically** - overlay is child of drawer body, should position relative to it
2. **Minimal change** - single CSS property
3. **No JS changes** - overlay already uses absolute positioning correctly
4. **Works everywhere** - desktop tiled, desktop drawer open, mobile drawer
5. **Future-proof** - any content in drawer body will also be contained

**File to edit:**
- `app/apps/file_editor_cm6/static/js/explorer.css` line 102

**Change:**
```diff
 .fe-drawer-body {
+  position: relative;
   flex: 1;
   display: flex;
   flex-direction: column;
   overflow-x: visible;
   overflow-y: hidden;
   background: var(--explorer-bg);
 }
```

---

## **Testing Plan**

After change, verify:

1. **Desktop Tiled Mode:**
   - [ ] Search overlay only covers explorer panel
   - [ ] Main editor still visible
   - [ ] Overlay edges align with explorer edges

2. **Desktop Drawer Open:**
   - [ ] Search overlay only covers drawer
   - [ ] Can close drawer behind overlay (shouldn't, but test)
   - [ ] Overlay contained within drawer bounds

3. **Mobile:**
   - [ ] Search overlay covers full drawer (which is full-page)
   - [ ] No visual change from before
   - [ ] Keyboard behavior still works

4. **All Modes:**
   - [ ] Close button works
   - [ ] Mode toggle works
   - [ ] Search input works
   - [ ] File opening works
   - [ ] Drawer closes after file open

---

## **Implementation Steps**

1. Edit `static/js/explorer.css` line 102
2. Add `position: relative;` to `.fe-drawer-body`
3. Test on desktop (tiled + drawer modes)
4. Test on mobile
5. Verify no regressions

**Estimated time:** 30 seconds to fix, 2 minutes to test

---

_Investigation complete: 2025-11-17 22:05 UTC_
