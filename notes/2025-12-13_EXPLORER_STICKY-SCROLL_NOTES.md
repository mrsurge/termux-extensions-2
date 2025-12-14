# 2025-12-13 — Explorer Sticky Scopes (Sticky Scroll) Notes

This document describes the **Explorer Sticky Scopes** feature in the Code CM6 app (`file_editor_cm6`): a Monaco-like “docked folders” / sticky-scroll UX for the explorer drawer.

## What It Does

As you scroll the explorer:
- The **open directory chain** for the “current” visible content **docks** at the top of the explorer pane as a stack of directory cards (“scopes”).
- The stack uses **geometry-based push-up / pull-down** so sibling scopes feel physically stacked (Monaco-ish).
- Sticky scope rows are **non-interactive** (to avoid accidental opens) except for:
  - The **⋮ menu button**, which still opens the normal context menu.
  - Clicking a sticky scope row (outside ⋮) **collapses that directory** in the underlying tree and performs a “magic” scroll so the collapsed row lands where the sticky row was.

## Files / Entry Points

- JS extension: `app/apps/file_editor_cm6/static/js/explorer_extensions/sticky_scopes.js`
  - `initExplorerStickyScopes({ treeElement, drawerBodyEl, openCardMenuForEntry })`
- Explorer hook + click interception: `app/apps/file_editor_cm6/static/js/explorer.js`
  - Imports the extension and initializes it.
  - Intercepts clicks in the sticky region (because the overlay uses `pointer-events: none`) and maps the click to the top-most slot by z-index.
- CSS: `app/apps/file_editor_cm6/static/js/explorer.css`
  - `.fe-sticky-scopes`, `.fe-sticky-scope-slot`, `.fe-sticky-scope-underlay`, `.fe-sticky-scope`

## How It Works (High Level)

### 1) Determine Which Scopes Are “Active”

The extension samples a **focus point** in the scrolled tree (`elementsFromPoint`) at an offset that accounts for:
- sticky stack height (row count × row height),
- scroll direction adjustments (slightly earlier release on upward scroll),
- small pixel-level tuning knobs.

From the focus node, it builds the **directory ancestor chain**, with a key rule:
- Only the **root** plus **open** directories can become sticky scopes (closed dirs do not).

### 2) Render a Slot Per Scope

Each scope gets its own overlay slot:
- A single-row `<ul class="fe-tree fe-sticky-scope-slot">` containing a `<li class="fe-tree-node fe-sticky-scope">`.
- The slot is positioned to match the source directory row’s left/right geometry so it aligns with the underlying card indentation.
- The row copies “visual” classes (git/draft/root + derived dir flags) so the sticky header looks like its source.

### 3) Push-Up / Pull-Down Animation (Geometry)

On each update frame:
- Compute an anchor Y for each slot (where it “wants” to sit).
- Find the **next tree node after the directory’s entire subtree** (dir *or* file), and use its `getBoundingClientRect().top` as the collision boundary.
- Apply a `translateY(...)` so the current scope is pushed up when the next boundary overlaps its anchor.

Important bug fix: push-up cannot depend on “next sibling directory only”:
- If an opened directory is the **last directory** in a scope (only files after it, or none), directory-only collision detection produces flicker and broken stacking.
- The fix is to treat the next boundary as the **next tree node** after the subtree (dir or file), walking up ancestors if needed.

### 4) “Blocker” Underlays (Solid Background Behind Indented Sides)

Each scope also gets a `.fe-sticky-scope-underlay`:
- Same left/right as the slot (same “scope width”).
- Solid background to hide the noisy scrolling content behind the indented sides of the sticky overlays.
- Height is anchored to the slot position and is prevented from shrinking during push-up so deep scopes don’t lose the blocker effect.

## Tuning Knobs

All tuning lives in `sticky_scopes.js`:
- `CAPTURE_Y_ADJUST_PX`: moves when a scope becomes captured/docked.
- `PUSH_TRIGGER_ADJUST_PX`: moves when push-up begins.
- `CROSS_SCOPE_GAP_PX`: compensates for the small spacing gap when the next collision boundary is found by climbing to an ancestor scope (i.e., the “next” node is outside the current directory’s sibling list).
- `KEY_STABILITY_FRAMES`: small hysteresis to reduce chain flapping at exact geometric thresholds.

## UX Notes

- This feature is **frontend-only**: it doesn’t change backend/SSOT behavior.
- Sticky rows intentionally avoid “normal” click-open behavior. Instead:
  - Tap sticky row → collapse the corresponding directory in the real tree.
  - Tap ⋮ → open the normal menu for that directory.

