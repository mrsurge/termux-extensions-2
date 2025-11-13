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

