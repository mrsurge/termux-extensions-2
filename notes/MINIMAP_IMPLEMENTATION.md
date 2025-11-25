# Minimap Implementation Journey
**Date:** 2025-11-24
**Feature:** CodeMirror 6 Minimap Integration

## 1. Overview
The goal was to add a VS Code-style minimap to the Code CM6 editor that:
- Works on both desktop (sidebar) and mobile (overlay).
- Displays git diff markers (added/deleted lines).
- Persists user preference across sessions.
- Respects the existing architecture (Backend as Single Source of Truth).

## 2. Implementation Strategy

### Phase 1: Vendoring & Core Integration
We couldn't use a standard CDN link because the `@replit/codemirror-minimap` package isn't included in NiceGUI's default bundle.
- **Action:** Updated `app/static/vendor/nicegui/elements/codemirror/package.json` to include `@replit/codemirror-minimap`.
- **Action:** Exported `showMinimap` in `src/index.mjs`.
- **Action:** Rebuilt the bundle (with terser disabled to avoid Android OOM).

### Phase 2: Dynamic Mode Switching
Instead of separate extensions for desktop and mobile, we used a single extension configured dynamically via a `Compartment`.
- **Frontend (`codemirror.js`):** Added `applyMinimapMode(mode)` which reconfigures the minimap compartment.
- **Logic:**
  - `desktop`: Opaque sidebar, `75px` width, pushes content left.
  - `mobile`: Transparent overlay, `30%` width, `position: fixed`, fades in on scroll.
  - `off`: Extension disabled.

### Phase 3: Preference & Layout Sync
The backend shouldn't decide layout (it doesn't know screen width). The frontend shouldn't decide preference (backend is truth).
- **Backend (`preferences_store.py`):** Added `showMinimap` (bool).
- **Component (`codemirror.js`):** Added `showMinimap` prop. The component watches this prop AND `window.matchMedia` to autonomously compute the correct mode (`desktop` vs `mobile`).
- **Initialization:** Passed the preference value to the component constructor in `editor_app.py` to avoid startup flicker.

### Phase 4: Diff Integration
We wanted the minimap to show green/red markers for git changes.
- **Challenge:** The minimap extension expects a simple array of line numbers, but our diff data lives in a complex `StateField`.
- **Solution:** 
  - Tagged our main diff decorations with `spec: { diffKind: 'insert' | 'delete' }`.
  - Added `diffMinimapGuttersFromDecorations` helper to scan the `diffField`, filter by tag, and build the minimap gutter maps.
  - Updated `applyMinimapMode` to inject `this.diffField` into the minimap's compute dependencies, ensuring real-time updates.

### Phase 5: Scroll & Position Fixes
- **Issue:** Minimap scrolled away with content or "hung out" at the top.
- **Fix:** Changed CSS to `position: fixed` relative to the iframe viewport.
- **Issue:** Text slid under the minimap on desktop.
- **Fix:** Added `.cm-has-minimap-desktop` class which applies `padding-right: 85px` to `.cm-content`.

## 3. Technical Artifacts

### Key Files Modified
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`: Core logic (compartment, layout detection, diff scanning).
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`: CSS styling, backend endpoints, preference passing.
- `app/apps/file_editor_cm6/main.js`: Menu toggle wiring.
- `app/apps/file_editor_cm6/preferences_store.py`: Default schema update.

### CSS Variables (in `editor_app.py`)
- `.cm-minimap-desktop`: Fixed sidebar styling.
- `.cm-minimap-mobile`: Overlay styling with scroll-based opacity.
- `.cm-has-minimap-desktop`: Content padding trigger.

## 4. Lessons Learned
1. **Self-Contained Components:** Moving the layout detection logic *into* the Vue component (`codemirror.js`) was cleaner than trying to orchestrate it from `main.js`.
2. **Compartments are Powerful:** Using a `Compartment` for the minimap allowed us to completely change its configuration (overlay vs sidebar) without destroying the editor state.
3. **Dependency Arrays:** CodeMirror's `compute` function needs explicit dependencies. We had to pass `[doc, diffField]` to ensure the minimap redrew when git status changed.
