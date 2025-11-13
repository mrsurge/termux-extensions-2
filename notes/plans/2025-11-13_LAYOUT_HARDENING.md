# Layout Hardening Plan - file_editor_cm6

**Date:** 2025-11-13  
**Status:** Planning - Awaiting Approval  
**Scope:** Remove hardcoded viewport heights, make headers sticky to framework toolbar  
**Goal:** Create solid layout foundation that can support keyboard-aware responsive features

---

## Context

The current layout works well for basic responsive behavior (desktop/mobile modes), but hardcoded viewport heights (`93vh`/`94vh`) prevent it from adapting to viewport changes. This plan hardens the layout to use proper flex/grid sizing and establishes sticky header behavior, creating the foundation needed for future keyboard-aware responsive layout features.

**This plan does NOT include keyboard handling** - that's a separate feature to be added after layout is hardened.

---

## Design Philosophy (Constraints)

1. **No Automatic Stacking** - Layout changes between desktop/mobile are deliberate and programmatic, controlled by JavaScript class switching (`.layout-desktop` / `.layout-mobile`)

2. **Framework Toolbar Supremacy** - The framework toolbar is the top-level UI element that:
   - Always stays visible at `z-index` top
   - Never has elements scroll above or underneath it
   - Acts as a hard boundary (macOS menu bar metaphor)
   - App headers should stick to its bottom edge like they're part of it

3. **User-Managed Vertical Space** - When screen real estate gets tight (keyboard + terminal + editor), the app provides the layout but the user decides what stays visible (close terminal, etc.)

---

## Current Problems

### Framework Level (`app/templates/app_shell.html`)

**Lines 23-30:**
```css
.app-shell { 
  display: flex; 
  flex-direction: column; 
  height: 100vh;  /* ✓ Correct */
  width: 100vw; 
}

.app-toolbar { 
  position: sticky; 
  top: 0; 
  z-index: 5;  /* ✓ Already sticky */
}

#app-container { 
  flex: 1; 
  overflow: auto;  /* ⚠️ Creates scroll container */
}
```

**Status:** Framework is correct - it owns the viewport and provides scroll container.

---

### App Level (`app/apps/file_editor_cm6/template.html`)

#### **Problem 1: Hardcoded Viewport Heights**

**Desktop (line 53):**
```css
.fe-root.layout-desktop {
  height: 93vh;  /* ❌ Hardcoded */
}
```

**Mobile (line 172):**
```css
.fe-root.layout-mobile {
  height: 94vh;  /* ❌ Hardcoded */
}
```

**Impact:**
- Prevents layout from adapting to viewport changes
- Creates extra scroll space due to mismatch with framework's `100vh`
- Will break keyboard-aware features since viewport changes won't propagate

---

#### **Problem 2: Non-Sticky Headers**

**Toolbar (line 294):**
```css
.fe-toolbar { 
  display: flex; 
  /* ... other properties ... */
  /* ❌ No position: sticky */
}
```

**Menubar (line 302):**
```css
.fe-menubar { 
  display: flex; 
  /* ... other properties ... */
  /* ❌ No position: sticky */
}
```

**Impact:**
- Headers scroll away when explorer/agent panels scroll
- Inconsistent UX with framework toolbar
- Will cause issues with keyboard layout calculations (headers not in predictable positions)

---

#### **Problem 3: Iframe Height Hack**

**Line 1380:**
```html
<iframe 
  id="editor-frame" 
  style="width: 100%; height: 65%; ..."
                           /* ↑ ❌ Should be 100% */
>
```

**Impact:**
- Arbitrary 65% suggests layout isn't sizing container correctly
- Leaves 35% gap that gets filled with scroll space
- Should be `100%` if grid row sizing is working properly

---

## Proposed Solution

### **Change 1: Use 100% Height Instead of Viewport Units**

**File:** `app/apps/file_editor_cm6/template.html`

**Desktop Layout (line 53):**
```css
.fe-root.layout-desktop {
  display: grid;
  grid-template-columns: var(--explorer-width, 430px) 1fr var(--agent-width, 400px);
  grid-template-rows: auto auto 1fr auto;
  height: 100%;  /* ← CHANGE from 93vh */
  overflow: hidden;
}
```

**Mobile Layout (line 172):**
```css
.fe-root.layout-mobile {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto 1fr auto;
  height: 100%;  /* ← CHANGE from 94vh */
  overflow: hidden;
}
```

**Rationale:**
- `.fe-root` is injected into `#app-container` which has `flex: 1`
- Using `height: 100%` lets it fill the container naturally
- Removes hardcoded assumptions about framework toolbar height
- Enables viewport changes to propagate through flex chain

---

### **Change 2: Make Headers Sticky to Framework Toolbar**

**File:** `app/apps/file_editor_cm6/template.html`

**Toolbar (line 294):**
```css
.fe-toolbar { 
  display: flex; 
  flex-wrap: wrap; 
  gap: 12px; 
  align-items: flex-start; 
  padding: 10px 12px; 
  border-bottom: 1px solid var(--border, #333); 
  background: var(--card, #0b0f1a);
  /* ↓ ADD THESE */
  position: sticky;
  top: 0;
  z-index: 4;  /* Below framework toolbar (z-index: 5) */
}
```

**Menubar (line 302):**
```css
.fe-menubar { 
  display: flex; 
  gap: 12px; 
  align-items: center; 
  padding: 6px 8px; 
  border-bottom: 1px solid var(--border, #333); 
  background: var(--card, #0b0f1a); 
  font-size: 13px;
  /* ↓ ADD THESE */
  position: sticky;
  top: var(--fe-toolbar-height, 50px);  /* Stack below toolbar */
  z-index: 3;  /* Below toolbar */
}
```

**Note:** May need to add JavaScript to calculate actual toolbar height and set CSS variable `--fe-toolbar-height` if toolbar wraps on narrow screens.

---

### **Change 3: Fix Iframe to Fill Container**

**File:** `app/apps/file_editor_cm6/template.html`  
**Line:** 1380

**Change inline style:**
```html
<iframe 
  id="editor-frame" 
  src="/api/app/file_editor_cm6/ui/nc"
  frameborder="0"
  scrolling="no"
  allow="clipboard-read; clipboard-write"
  style="width: 100%; height: 100%; border: none; display: block; overflow: hidden;">
  <!--                   ↑ CHANGE from 65% to 100% -->
</iframe>
```

**Rationale:**
- `.fe-editor-container` is grid row 3 with `1fr` (takes remaining space after auto-sized headers)
- Iframe should completely fill this grid cell
- If 65% was working, it means the container was oversized - fixing heights will fix this

---

## Implementation Steps

### **Step 1: Update Layout Heights**
- Change `.fe-root.layout-desktop { height: 93vh; }` → `height: 100%;`
- Change `.fe-root.layout-mobile { height: 94vh; }` → `height: 100%;`

### **Step 2: Make Headers Sticky**
- Add `position: sticky; top: 0; z-index: 4;` to `.fe-toolbar`
- Add `position: sticky; top: var(--fe-toolbar-height, 50px); z-index: 3;` to `.fe-menubar`

### **Step 3: Fix Iframe Height**
- Change iframe inline style from `height: 65%` → `height: 100%`

### **Step 4: (Optional) Add Toolbar Height Tracking**
If toolbar height is dynamic (wraps on narrow screens):
```javascript
// Add to <script> section
function updateToolbarHeight() {
  const toolbar = document.querySelector('.fe-toolbar');
  if (toolbar) {
    document.documentElement.style.setProperty(
      '--fe-toolbar-height', 
      `${toolbar.offsetHeight}px`
    );
  }
}

// Run on load and resize
updateToolbarHeight();
window.addEventListener('resize', updateToolbarHeight);
```

---

## Testing Checklist

### **Desktop Mode**
- [ ] Explorer scrolls, headers stay fixed at top
- [ ] Agent drawer scrolls, headers stay fixed at top
- [ ] Terminal drawer tiles correctly below editor
- [ ] Iframe fills editor container completely (no gap at bottom)
- [ ] No extra scroll space below terminal

### **Mobile Mode**
- [ ] Editor iframe scrolls, headers stay fixed at top
- [ ] Terminal tiles below editor correctly
- [ ] Explorer drawer overlays correctly (z-index above headers)
- [ ] Agent drawer overlays correctly (z-index above headers)
- [ ] No extra scroll space at bottom

### **Header Behavior**
- [ ] Toolbar sticks to top, never scrolls away
- [ ] Menubar sticks below toolbar, never scrolls away
- [ ] Headers don't overlap framework toolbar
- [ ] Dropdowns (File, Edit, etc.) display correctly over sticky headers
- [ ] Framework toolbar always visible above app headers

### **Visual**
- [ ] No white space gaps
- [ ] No double scrollbars
- [ ] Smooth scrolling in scrollable regions
- [ ] Headers have solid background (no transparency issues)

---

## Risk Assessment

### **Low Risk:**
- Changing `93vh`/`94vh` to `100%` - straightforward substitution
- Adding sticky positioning to headers - well-supported CSS

### **Medium Risk:**
- Iframe height change from 65% to 100% - might reveal why it was 65% in the first place
- Menubar `top` offset - might need dynamic calculation if toolbar wraps

### **Mitigation:**
- Test in mobile first (simpler layout)
- If iframe 100% doesn't work, investigate `.fe-editor-container` grid sizing
- Add toolbar height tracking script if menubar overlaps toolbar on narrow screens

---

## Future Work (Out of Scope)

After layout is hardened:

1. **Keyboard-Aware Responsive Layout**
   - Add `visualViewport` tracking
   - Implement `--keyboard-offset` CSS variable
   - Add `padding-bottom` adjustments to maintain usable viewport

2. **Dynamic Grid Sizing**
   - Add resize handles for explorer/agent panels
   - Persist panel widths to localStorage

3. **Header Unification** (if needed)
   - Evaluate merging framework + app headers for mobile UX
   - Design API for apps to inject header content into framework

---

## Dependencies

**Files to modify:**
- `app/apps/file_editor_cm6/template.html` (all changes)

**No changes required to:**
- `app/templates/app_shell.html` (framework is correct as-is)

**No new dependencies or libraries needed.**

---

## Success Criteria

✅ Layout uses `100%` heights, not viewport units  
✅ Headers stick to framework toolbar correctly  
✅ Iframe fills container at `100%`  
✅ No extra scroll space  
✅ All tests pass in desktop and mobile modes  
✅ Layout is ready for keyboard viewport tracking to be added

---

**Status:** Awaiting approval to proceed with implementation.
