# File Explorer header overlap diagnosis and fix plan

## Problem summary
- On narrow viewports where the File Explorer renders its mobile footer, scrolling to the end of the file list causes the toolbar/header of the app to slide underneath the sticky app shell header, producing a double-header overlap that does not happen in Archive Manager.
- The app shell keeps its own toolbar fixed to the top and makes `#app-container` a scrollable region, so when the File Explorer column is allowed to move the shell header visually stacks on top of the explorer header.【F:app/templates/app_shell.html†L23-L30】

## What differs between File Explorer and Archive Manager
- Both apps render a flex column that relies on an inner content pane with `overflow: auto`, but File Explorer appends a fixed-position mobile footer outside of the `[data-app-root]` column while Archive Manager does not render any extra sibling elements.【F:app/apps/file_explorer/template.html†L35-L83】【F:app/apps/file_explorer/template.html†L649-L848】【F:app/apps/archive_manager/template.html†L1-L120】
- File Explorer’s script queries the footer off the outer `root`, confirming the footer currently lives outside the primary flex column. Any scroll chaining that escapes the inner content will therefore move the entire `fx-app` block relative to the shell header.【F:app/apps/file_explorer/main.js†L500-L541】

## Root cause
- With the footer fixed to the viewport and not participating in the main flex column’s layout, the inner list (`.fx-content`) has less usable height on phones. When the list reaches its end, subsequent wheel/touch events bubble to the shell’s scroll container (`#app-container`), which then scrolls the entire File Explorer block and tucks its toolbar underneath the sticky shell toolbar.【F:app/templates/app_shell.html†L24-L30】【F:app/apps/file_explorer/template.html†L35-L83】【F:app/apps/file_explorer/template.html†L649-L848】
- Archive Manager lacks the extra fixed footer, so the inner scroll area rarely propagates events to the shell container, leaving its toolbar stationary.

## Fix plan for an agent
1. **Collapse the app into a single scroll container.** Move the `<div class="fx-mobile-footer">` inside the `.fx-app` element so the footer becomes part of the flex column rather than a sibling. Keep it as the final child in the column and ensure selectors continue to work (change the footer queries in `main.js` to use `container` instead of `root`).【F:app/apps/file_explorer/template.html†L649-L848】【F:app/apps/file_explorer/main.js†L500-L541】
2. **Replace the viewport-fixed footer with an in-app sticky footer.** Update the footer CSS to drop `position: fixed` and instead rely on the column layout: give `.fx-app` `overscroll-behavior: contain;` and keep `.fx-content` flexing. Make the footer `position: sticky` (or give it `margin-top: auto`) with `bottom: 0` so it stays anchored within the app without forcing the shell container to scroll.【F:app/apps/file_explorer/template.html†L35-L83】
3. **Preserve spacing for the footer.** Keep or adjust the existing bottom padding on `.fx-content` for mobile breakpoints so file rows are not hidden behind the sticky footer after the layout change.【F:app/apps/file_explorer/template.html†L544-L608】
4. **Verify no regressions.** After restructuring, confirm that:
   - The File Explorer header no longer slides under the shell header when scrolling to the end of the list on a narrow viewport.
   - The mobile footer still responds to selection state (button enabling/disabling) via the updated selectors.
   - Archive Manager remains unaffected since its template does not render the footer.

## Suggested manual test script
1. Start the Flask stack and open the File Explorer in the shell UI.
2. Shrink the window below 820px so the mobile footer renders.
3. Scroll to the bottom of a large directory; keep dragging upward and verify the shell toolbar stays in place while the File Explorer toolbar remains fully visible.
4. Repeat in Archive Manager to confirm consistent behavior.
