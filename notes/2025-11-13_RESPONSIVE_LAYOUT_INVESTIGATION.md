# Responsive Layout Height Investigation - file_editor_cm6

**Date:** 2025-11-13  
**Context:** Applying lessons from `LAYOUT_HEIGHT_POSTMORTEM.md` to the current file_editor_cm6 architecture  
**Scope:** Understanding the nested HTML structure and how to properly handle mobile keyboard overlays

---

## Architecture Overview

### The Nested Structure (Outer → Inner)

```
app_shell.html (Framework)
  └─ #app-container (line 158)
      └─ template.html (App - injected as innerHTML)
          └─ .fe-root
              └─ .fe-editor-container
                  └─ <iframe src="/api/app/file_editor_cm6/ui/nc">
                      └─ NiceGUI CodeMirror (Python/vendored nicegui)
```

**Key Insight:** The app template is NOT served as a standalone page - it's injected as a div's innerHTML inside `app_shell.html`.

---

## Current Implementation

### app_shell.html (Framework Layer)

**Lines 23-30:**
```css
body { 
  margin: 0; 
  background-color: var(--background); 
  color: var(--foreground); 
  font-family: 'Inter', sans-serif; 
}

.app-shell { 
  display: flex; 
  flex-direction: column; 
  height: 100vh; 
  width: 100vw; 
}

.app-toolbar { 
  /* Sticky header */ 
  position: sticky; 
  top: 0; 
  z-index: 5; 
}

#app-container { 
  flex: 1; 
  overflow: auto; 
}
```

**Behavior:**
- `.app-shell` is `100vh` (full viewport height)
- Toolbar is sticky
- `#app-container` gets `flex: 1` (remaining space)
- `overflow: auto` on container means scrolling happens HERE, not in the app

---

### template.html (App Layer)

**Current CSS (lines 1-50):**
```css
.fe-root { 
  display: flex; 
  flex-direction: column; 
  height: 100%; 
  background: var(--bg); 
  color: var(--fg); 
}

.fe-root.layout-desktop {
  display: grid;
  grid-template-columns: var(--explorer-width, 430px) 1fr var(--agent-width, 400px);
  grid-template-rows: auto auto 1fr auto;
  height: 93vh;  /* ⚠️ HARDCODED! */
  overflow: hidden;
}

.fe-root.layout-mobile {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto 1fr auto;
  height: 94vh;  /* ⚠️ HARDCODED! */
  overflow: hidden;
}
```

**Current iframe (line 1380):**
```html
<iframe 
  id="editor-frame" 
  src="/api/app/file_editor_cm6/ui/nc"
  style="width: 100%; height: 65%; border: none; display: block; overflow: hidden;">
</iframe>
```

---

## Problems Identified

### 1. **Hardcoded Viewport Heights Break Mobile Keyboards**

**Issue:**
- Desktop: `height: 93vh`
- Mobile: `height: 94vh`

**Why This Breaks:**
- Mobile virtual keyboards shrink the viewport
- `vh` units don't account for keyboard overlay
- Results in content being pushed under keyboard or generating extra scroll space

**User's Note:** 
> "the way I have everything tweaked it's kind of just so the reactive layout behaves correctly for mobile. there are extra scroll space gets generated because of the parent HTML template"

This is a **workaround** for the framework's `#app-container { overflow: auto }` creating double-scrolling.

---

### 2. **Iframe Has `height: 65%`**

**Issue:**
- Iframe should fill `.fe-editor-container` (which is grid row 3)
- Currently arbitrarily set to 65% of container

**Why 65%?**
- Likely manual compensation for scroll space issues
- Should be `100%` if container sizing is correct

---

### 3. **Double Overflow Containers**

**Current Flow:**
```
#app-container { overflow: auto }  ← Framework scrolls here
  └─ .fe-root { overflow: hidden } ← App wants to control scroll
```

**Result:**
- Framework container scrolls
- App tries to prevent scroll with `overflow: hidden`
- Creates visual thrash and extra whitespace

---

### 4. **No Mobile Keyboard Awareness**

**From POSTMORTEM:** The solution uses:
- `visualViewport` API to detect keyboard
- CSS custom properties (`--keyboard-offset`)
- `padding-bottom` adjustments

**Current Implementation:**
- Has `--keyboard-inset` and `--keyboard-gap` variables defined (lines 22-23)
- But NO JavaScript to populate them
- Variables are unused

---

## Lessons from LAYOUT_HEIGHT_POSTMORTEM.md

### What Worked in nice_code_cm6

1. **Removed manual header subtraction** - Let flex handle it
2. **Forced Quasar wrappers into flex chain** - Every intermediate div participates
3. **Used `flex: 1` + `min-height: 0`** - Proper flex growth without overflow
4. **Added `visualViewport` tracking** - Real-time keyboard offset

### What They Fixed

**Before:**
- Manual `height: calc(100dvh - header_height)` → broke with keyboards
- Missing flex participation in Quasar wrappers → 112px gap
- No keyboard offset tracking

**After:**
- Flex chain from `html` → `body` → all wrappers → content
- `padding-bottom: calc(env(safe-area-inset-bottom) + var(--vk-offset))`
- JavaScript updates `--vk-offset` on `visualViewport` resize

---

## Key Differences: nice_code_cm6 vs file_editor_cm6

| Aspect | nice_code_cm6 | file_editor_cm6 |
|--------|---------------|-----------------|
| **Architecture** | Standalone NiceGUI app | Injected into framework shell |
| **Root Container** | NiceGUI page (controls viewport) | `#app-container` inside framework |
| **Scrolling** | App controls scroll | Framework controls scroll (`#app-container`) |
| **Height Strategy** | `100vh` at app level | `93vh`/`94vh` workaround to prevent double-scroll |
| **Keyboard Handling** | Direct `visualViewport` → padding | None (framework handles viewport?) |

---

## User's Constraints

1. **Framework Adds Complexity:** `app_shell.html` wraps the app template as innerHTML
2. **Scroll Ownership:** Framework's `#app-container { overflow: auto }` means scroll happens at framework level
3. **Height Tweaks Are Intentional:** The `93vh`/`94vh` prevents extra scroll space from framework wrapper
4. **Keyboard Handling Unclear:** Framework may or may not handle keyboard offsets

---

## Open Questions (Before Proposing Solutions)

1. **Does the framework (`app_shell.html`) handle keyboard offsets?**
   - If yes: App shouldn't duplicate effort
   - If no: App needs its own `visualViewport` tracking

2. **Is the `overflow: auto` on `#app-container` required by the framework?**
   - If yes: App layout must adapt to being inside a scroll container
   - If no: Could request framework change to `overflow: hidden`?

3. **Is the iframe `height: 65%` a hack or intentional?**
   - Suspected: Manual compensation for layout issues
   - Should be: `100%` with proper container sizing

4. **Do other apps in the framework have similar issues?**
   - If yes: Framework-level fix needed
   - If no: App-specific solution acceptable

---

## Potential Solutions (NOT YET APPROVED)

### Option A: Framework-Level Keyboard Handling
**If framework should own keyboard awareness:**
- Add `visualViewport` tracking to `app_shell.html`
- Expose `--keyboard-offset` CSS variable to apps
- Apps consume variable without duplicating logic

**Pros:** Single source of truth, all apps benefit  
**Cons:** Requires framework changes

---

### Option B: App-Level Keyboard Handling (Isolated)
**If app must handle keyboards independently:**
- Add JavaScript to `template.html` to track `visualViewport`
- Update `--keyboard-inset` variable (already defined but unused)
- Adjust `.fe-root` padding-bottom with keyboard offset

**Pros:** No framework changes needed  
**Cons:** Duplicated logic across apps

---

### Option C: Hybrid - Fix Height Strategy First
**Address hardcoded `vh` units before keyboard:**
1. Change `.fe-root` from `height: 93vh`/`94vh` → `height: 100%`
2. Fix iframe from `height: 65%` → `height: 100%`
3. Test if extra scroll space still occurs
4. Then address keyboard if needed

**Pros:** Incremental, easier to debug  
**Cons:** May not fully solve mobile keyboard issue

---

## Next Steps

**User needs to clarify:**
1. Is framework (`app_shell.html`) supposed to handle keyboard offsets?
2. Is `#app-container { overflow: auto }` required, or can it be `overflow: hidden`?
3. Are the `93vh`/`94vh` values empirically tuned workarounds, or can they be replaced with proper flex?
4. What's the actual goal - just prevent extra scroll space, or also handle mobile keyboards properly?

**Then we can propose:**
- Minimal changes to achieve correct behavior
- Whether to fix at framework or app level
- How to apply POSTMORTEM lessons without breaking existing reactive layout

---

## Findings Summary

**What's Broken:**
- Hardcoded `vh` units don't account for keyboards
- Iframe at `65%` doesn't fill container
- Keyboard offset variables defined but unused
- Double overflow containers (framework + app)

**What's Working (Intentional Workarounds):**
- `93vh`/`94vh` prevents extra scroll from framework wrapper
- `overflow: hidden` on `.fe-root` prevents double-scroll

**What's Unclear:**
- Is framework supposed to handle keyboards?
- Can framework's `overflow: auto` be changed?
- Are the height tweaks permanent or temporary?

**POSTMORTEM Lessons Applicable:**
- ✅ Flex chain principle (html → body → containers)
- ✅ `visualViewport` tracking for keyboards
- ⚠️ May need adaptation for framework wrapper context
- ❌ Can't directly apply Quasar wrapper fixes (different architecture)

---

**Status:** Awaiting user clarification before proposing solutions.

---

## Header Scrolling Issue Investigation

**Date:** 2025-11-13  
**Problem:** App headers (`.fe-toolbar` and `.fe-menubar`) scroll underneath the app_shell toolbar on mobile Chrome, causing double-header overlap.

---

### Current Architecture

#### app_shell.html Toolbar

**CSS (line 25):**
```css
.app-toolbar { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  padding: 10px 12px; 
  border-bottom: 1px solid var(--border); 
  background: var(--card); 
  position: sticky;  /* ✅ STICKY */
  top: 0; 
  z-index: 5;        /* ⚠️ Low z-index */
}
```

**Behavior:**
- Framework toolbar is `position: sticky` at `top: 0`
- `z-index: 5` (relatively low)
- Stays at top of `#app-container` scroll

---

#### template.html Headers (App Layer)

**CSS (lines 294, 302):**
```css
.fe-toolbar { 
  display: flex; 
  /* ... */
  padding: 10px 12px; 
  border-bottom: 1px solid var(--border, #333); 
  background: var(--card, #0b0f1a); 
  /* ❌ NO position: sticky */
}

.fe-menubar { 
  display: flex; 
  /* ... */
  padding: 6px 8px; 
  border-bottom: 1px solid var(--border, #333); 
  background: var(--card, #0b0f1a); 
  font-size: 13px; 
  /* ❌ NO position: sticky */
}
```

**Grid Positioning (Desktop - lines 58-66):**
```css
.layout-desktop .fe-toolbar {
  grid-column: 1 / -1;  /* Spans full width */
  grid-row: 1;
}

.layout-desktop .fe-menubar {
  grid-column: 1 / -1;  /* Spans full width */
  grid-row: 2;
}
```

**Grid Positioning (Mobile - lines 175-185):**
```css
.layout-mobile .fe-toolbar {
  grid-column: 1;
  grid-row: 1;
}

.layout-mobile .fe-menubar {
  grid-column: 1;
  grid-row: 2;
}
```

**Current Behavior:**
- App headers are part of the grid (rows 1 & 2)
- Grid is inside `#app-container` which has `overflow: auto`
- Headers scroll WITH the content (not sticky)
- On mobile Chrome, they scroll UP and disappear under framework toolbar

---

### The Problem

**Scroll Context:**
```
app_shell.html
  ├─ .app-toolbar (position: sticky, z-index: 5) ← Framework header
  └─ #app-container (overflow: auto) ← Scroll container
      └─ template.html
          └─ .fe-root (grid)
              ├─ .fe-toolbar (grid-row: 1) ← App header (scrolls!)
              ├─ .fe-menubar (grid-row: 2) ← App menubar (scrolls!)
              └─ .fe-editor-container (grid-row: 3)
```

**What Happens:**
1. User scrolls down in `#app-container`
2. App headers (`.fe-toolbar`, `.fe-menubar`) scroll UP
3. They slide underneath framework's `.app-toolbar`
4. Creates visual overlap/double-header effect
5. Worse on mobile Chrome due to aggressive scroll optimization

---

### Root Cause

**Sticky doesn't work across scroll contexts:**
- Framework toolbar: sticky relative to `#app-container` scroll ✅
- App headers: NOT sticky, just grid items ❌
- App headers scroll WITHIN `#app-container`, so they can't stick to its top

**Why it's worse on mobile Chrome:**
- Chrome on mobile has scroll momentum/bounce
- Rapid scrolling makes overlap more visible
- Desktop browsers scroll slower, less noticeable

---

### Solutions

#### Solution 1: Make App Headers Sticky (Simplest)

**Add to `.fe-toolbar` and `.fe-menubar`:**
```css
.fe-toolbar {
  position: sticky;
  top: 0;
  z-index: 10;  /* Higher than framework's z-index: 5 */
  background: var(--card, #0b0f1a);
  /* ... existing styles ... */
}

.fe-menubar {
  position: sticky;
  top: 0;  /* Or calculate offset if toolbar is also sticky */
  z-index: 10;
  background: var(--card, #0b0f1a);
  /* ... existing styles ... */
}
```

**If both are sticky, adjust menubar top:**
```css
.fe-menubar {
  position: sticky;
  top: var(--toolbar-height, 50px);  /* Offset by toolbar height */
  z-index: 9;  /* Below toolbar, above content */
}
```

**Pros:**
- Minimal change
- Headers stay visible during scroll
- Works in all browsers

**Cons:**
- App headers overlap framework toolbar (need higher z-index)
- Creates "triple header" (framework + app toolbar + app menubar)
- May not be desired UX

---

#### Solution 2: Remove Framework Toolbar (Radical)

**If framework toolbar is redundant:**
- Remove `.app-toolbar` entirely from `app_shell.html`
- Let each app provide its own header
- `#app-container` starts at top of viewport

**Pros:**
- No overlap issue
- Apps have full control
- Cleaner visual hierarchy

**Cons:**
- Breaks existing framework navigation (Home, Reload, Quit, Lock buttons)
- Need to migrate those features to apps or elsewhere
- Breaking change for all apps

---

#### Solution 3: Move Framework Toolbar Inside App Container

**Change `app_shell.html` structure:**
```html
<div class="app-shell">
  <div id="app-container">
    <div class="app-toolbar"><!-- Framework toolbar HERE --></div>
    <!-- App template injected here -->
  </div>
</div>
```

**CSS adjustments:**
```css
.app-toolbar {
  position: sticky;
  top: 0;
  z-index: 100;  /* ABOVE app headers */
}
```

**Pros:**
- Framework toolbar stays sticky at scroll top
- App headers can be sticky underneath
- Clear z-index hierarchy

**Cons:**
- Requires framework refactor
- App template injection point changes
- All apps might need updates

---

#### Solution 4: Collapse App Headers on Scroll (UX Alternative)

**Use IntersectionObserver to hide app headers when scrolling:**
```javascript
// In template.html <script>
const toolbar = document.querySelector('.fe-toolbar');
const menubar = document.querySelector('.fe-menubar');

const observer = new IntersectionObserver(
  ([entry]) => {
    if (!entry.isIntersecting) {
      toolbar.style.transform = 'translateY(-100%)';
      menubar.style.transform = 'translateY(-100%)';
    } else {
      toolbar.style.transform = 'translateY(0)';
      menubar.style.transform = 'translateY(0)';
    }
  },
  { threshold: 0 }
);

observer.observe(toolbar);
```

**Pros:**
- App headers auto-hide when scrolling down
- Recovers screen space on mobile
- No sticky conflicts

**Cons:**
- Headers not always visible
- Users might expect them to stay visible
- More complex JS

---

#### Solution 5: Unified Header (Recommended for Mobile)

**Merge framework + app headers into single sticky header:**

**Framework provides:**
- Navigation (Home, Reload)
- App switcher (Recents)

**App injects:**
- File name/path
- App-specific actions

**Implementation:**
```html
<!-- app_shell.html -->
<div class="app-toolbar">
  <button id="btn-home">Home</button>
  <button id="btn-recents">Apps</button>
  <div id="app-header-slot"></div> <!-- App injects here -->
</div>
```

**App exposes API:**
```javascript
// In template.html
window.setAppHeader = (html) => {
  document.getElementById('app-header-slot').innerHTML = html;
};

setAppHeader(`
  <div class="fe-title-block">
    <div class="fe-file-name">main.py</div>
    <div class="fe-file-path">/home/project</div>
  </div>
  <button class="fe-btn">Save</button>
`);
```

**Pros:**
- Single header, no overlap
- Clean mobile UX
- Framework controls sticky behavior

**Cons:**
- Requires both framework + app changes
- Apps lose some header control
- More coupling between layers

---

### Recommendation

**For file_editor_cm6 specifically:**

**Quick Fix (Solution 1):**
```css
.fe-toolbar,
.fe-menubar {
  position: sticky;
  z-index: 10;
  background: var(--card, #0b0f1a);
}

.fe-toolbar {
  top: 0;
}

.fe-menubar {
  top: 50px; /* Adjust based on toolbar height */
}
```

**Long-term (Solution 5):**
- Design unified header API at framework level
- Apps provide header content via JS API
- Framework handles sticky positioning
- Consistent across all apps

---

### Impact on Keyboard Handling

**If headers are sticky:**
- They'll stay visible when keyboard appears
- Need to account for header height in `--keyboard-offset` calculations
- Sticky headers reduce available editor height

**Calculation:**
```javascript
// In visualViewport tracking
const stickyHeaderHeight = 
  document.querySelector('.app-toolbar')?.offsetHeight || 0 +
  document.querySelector('.fe-toolbar')?.offsetHeight || 0 +
  document.querySelector('.fe-menubar')?.offsetHeight || 0;

const availableHeight = window.visualViewport.height - stickyHeaderHeight;
```

---

**Status:** Awaiting user decision on header strategy before implementing.


---

## Decision Log

**Date:** 2025-11-13  

### Keyboard Handling Location

**Decision Status:** ⏳ **In Progress / Under Consideration**

**Proposed Approach:**
- Implement `visualViewport` tracking in `app_shell.html` at the framework level
- Expose `--keyboard-offset` CSS variable for all apps to consume
- Framework handles viewport changes, apps adapt to the variable

**Rationale:**
- Single source of truth prevents duplicate logic across apps
- Framework owns the viewport (`100vh` on `.app-shell`), should track changes
- All apps benefit automatically without individual implementations
- Prevents conflicts from multiple keyboard handlers

**Status:** Awaiting final approval before implementation.

---

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

---

## Implementation Addendum - 2025-11-13

**Status:** ✅ **RESOLVED - Layout Working**  
**Final Solution:** Root scroll lock prevents Chrome URL bar collapse

---

### What We Tried (In Order)

#### Attempt 1: Remove Hardcoded vh Heights
- Changed `height: 93vh/94vh` → `height: 100%`
- **Result:** Didn't solve the header scrolling issue
- **Why:** `#app-container { overflow: auto }` was still the scroll container, creating wrong stacking context for sticky elements

#### Attempt 2: Rename Elements to Avoid Browser Heuristics
- Changed `.app-toolbar` → `.app-topbar`
- Changed `.fe-toolbar` → `.fe-topbar` 
- Changed `.fe-menubar` → `.fe-menu-strip`
- **Result:** No effect on behavior
- **Why:** Browser heuristics aren't based on class names, issue was architectural

#### Attempt 3: Make App Headers position: sticky
- Added `position: sticky; top: 0` to `.fe-toolbar`
- Added `position: sticky; top: var(--fe-toolbar-height)` to `.fe-menubar`
- **Result:** Headers stuck within `#app-container` scroll context, not viewport
- **Why:** Sticky positioning works relative to nearest scrolling ancestor

#### Attempt 4: Framework Toolbar position: fixed + Spacer Div
- Changed framework toolbar to `position: fixed`
- Added mandatory spacer div consuming `--framework-toolbar-height`
- Grid positioning: spacer at row 1, headers shifted down
- JavaScript to track and update framework toolbar height
- **Result:** 
  - Desktop: Worked but with quirks
  - Mobile: Spacer and headers overlapped, everything squished to top
  - Other apps: Drawers broke with spacer implementation
- **Why:** Complex height calculations, grid row conflicts, broke drawer z-index stacking

#### Attempt 5: Remove Framework Scroll Container
- Changed `#app-container { overflow: auto }` → `overflow: hidden`
- Apps handle internal scrolling
- **Result:** Still didn't fully solve sticky header issue
- **Why:** Root cause was Chrome mobile URL bar collapse behavior

---

### The Root Cause Discovery

Found article explaining Chrome mobile URL bar behavior:
- Chrome hides/shows URL bar when it detects "page scroll"
- Any scroll container at root level triggers this behavior
- No meta tag or CSS property can disable it
- Only solution: **Lock root scroll, use inner scroll container**

**The "aha" moment:** This was the fundamental issue all along. Not sticky positioning, not viewport heights, but Chrome's URL bar auto-hide triggering viewport changes.

---

### The Final Solution

**One simple change to framework (`app/templates/app_shell.html`):**

```css
html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    overflow: hidden;      /* ← ROOT SCROLL LOCK */
    position: fixed;
    width: 100%;
}
```

**What this does:**
1. Locks `html` and `body` from scrolling
2. Browser sees no page-level scroll → doesn't hide URL bar
3. `#app-container { overflow: auto }` becomes the scroll container
4. Apps scroll internally, viewport stays stable
5. Sticky elements work correctly relative to their containers

**App changes made:**
- Desktop: `height: 93vh` → `height: 100%`
- Mobile: `height: 94vh` → `height: 100%`  
- Iframe: `height: 65%` → `height: 100%`
- Grid layouts: 4 rows (toolbar, menubar, editor, terminal)
- Headers: Normal flow, no sticky positioning needed

**What we DIDN'T need:**
- Spacer divs
- position: sticky on app headers
- position: fixed on framework toolbar
- JavaScript height tracking
- CSS variable calculations
- Grid row offset gymnastics

---

### Files Modified

**Framework:**
- `app/templates/app_shell.html`
  - Added root scroll lock (`html, body { overflow: hidden; position: fixed; }`)
  - Framework toolbar remains `position: sticky` (works now that root is locked)

**App:**
- `app/apps/file_editor_cm6/template.html`
  - Changed layout heights from viewport units to percentage
  - Fixed iframe height to 100%
  - Grid layouts use correct 4-row structure
  - Headers remain in normal document flow

**Not modified:**
- Other apps (archive_manager, aria_downloader, file_explorer, settings, terminal)
- No mandatory spacers added to other apps

---

### Testing Results

✅ **Desktop Mode:**
- Explorer scrolls smoothly, no jank
- Agent drawer scrolls correctly
- Terminal tiles properly
- Iframe fills container (no 35% gap)
- No extra scroll space

✅ **Mobile Mode:**
- Editor scrolls without URL bar collapse
- Terminal tiles correctly
- Drawers overlay properly
- No overlap issues
- Headers stay in place

✅ **Cross-Browser:**
- Chrome mobile: URL bar stays visible ✓
- Firefox: Works correctly ✓
- PWA mode: Works correctly ✓

---

### Key Learnings

1. **Browser behavior trumps CSS tricks:** Understanding the platform (Chrome URL bar auto-hide) was more important than CSS positioning hacks

2. **Root scroll lock is the pattern:** For PWA-like experiences in mobile browsers, lock root scroll and use inner containers

3. **Simplicity wins:** The final solution was simpler than any attempted fix - just prevent root scroll

4. **Viewport units are problematic:** Using `vh` units with dynamic browser chrome causes issues. Use `100%` and let flex/grid handle sizing

5. **Test the premise:** We spent time on sticky positioning when the real issue was the scroll container triggering browser UI changes

---

### Next Steps

With layout now stable and working:

1. **Add keyboard-aware responsive features** (original goal)
   - Implement `visualViewport` API tracking
   - Add `--keyboard-offset` CSS variable
   - Handle virtual keyboard overlay gracefully

2. **Apply pattern to other apps** if needed
   - Currently only file_editor_cm6 modified
   - Other apps can be updated to use `100%` heights if they have similar issues

3. **Document the pattern** for future app development
   - Root scroll lock is mandatory
   - Use percentage heights, not viewport units
   - Apps manage internal scrolling

---

**Resolution Date:** 2025-11-13  
**Time to Resolution:** ~4 hours of investigation and attempts  
**Final Status:** Layout is stable, no URL bar jank, ready for keyboard handling implementation

