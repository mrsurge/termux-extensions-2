# Explorer Drawer Design

_Last updated: November 4, 2025_

The explorer is the primary navigation surface for Nice Code CM6. It must feel native on phones and desktops while respecting the project-root contract. This document summarizes its layout, styling, and behavior.

**Current Status:** ✅ Fully implemented with git status backgrounds, nested card waterfall, and responsive drawer behavior.

## Layout Overview

```
┌───────────────────────── Explorer Panel ─────────────────────────┐
│ Header Row                                                     ▲ │
│ ├─ Folder icon + project label                                 │ │
│ └─ History • Change Project • Refresh buttons                  │ │
├───────────────────────────────────────────────────────────────┤ │
│ Card Waterfall (one card per node)                             │ │
│ ├─ Directory Card (twisty + icon + name + git badge)           │ │
│ │  └─ Nested cards (children)                                  │ │
│ └─ File Card                                                    │ │
└───────────────────────────────────────────────────────────────┘ ▼
```

- **Mobile (<768px)**: Rendered inside the left drawer overlay; toggled via the folder button in the header.
- **Desktop (≥768px)**: Rendered as a permanent tile on the left side of the layout.

## Styling

- Node cards use inline styles (dark gradient, rounded corners) rather than Quasar `q-card` to avoid inherited white backgrounds.
- Cascading indentation is achieved with a computed `margin-left` (8 px × depth) and nested flex columns.
- Git badges are tiny pill labels (`text-[10px] px-1`).
- Cards react to hover via border highlight + subtle translate for depth.

### CSS Classes

| Class | Purpose |
|-------|---------|
| `.nc-explorer-card` | Root container for each entry (directory or file). |
| `.nc-explorer-card-header` | Flex row with twisty, icon, label, git badges. |
| `.nc-explorer-card-children` | Column that hosts nested child entries. |
| `.nc-explorer-twisty` | Triangular glyph toggling directory expansion. |

Inline styles (applied in Python) set background, border, shadow, padding, and flex direction for cards and child containers.

## Behavior

### Directory Toggle
- Clicking the glyph or directory label toggles expansion (`ExplorerState.toggle_expand`).
- Expanded directories render their child cards inside `.nc-explorer-card-children`.

### File Open
- Clicking a file card opens the document via `EditorModule.open_file`.
- Recent files list updates immediately, and the explorer drawer auto-closes on mobile.

### Project Controls
- **History** menu: lists recent files captured by `ExplorerState.recent_files`.
- **Change Project** prompts for a new root (guarded by `ProjectContext.set_root`).
- **Refresh** forces a git-cache refresh and rebuilds the card waterfall.

## Integration Points

- Explorer state lives in `helpers/explorer_backend.py`.
- Card rendering is defined in `modules/native/explorer.py`.
- Layout toggles (mobile overlay vs desktop tile) are managed by `core/layout_manager.py`.
- On mobile, the backdrop uses `.te-mobile-header-offset` to align with the shared shell header.

## Completed Features ✅
- ✅ Nested card waterfall with git status backgrounds
- ✅ Responsive drawer (mobile overlay / desktop tile)
- ✅ Directory expansion persistence
- ✅ Recent files tracking with history menu
- ✅ Project root changing with validation
- ✅ Git status summary bar (branch, ahead/behind, staged/unstaged counts)
- ✅ Touch-friendly hit targets
- ✅ Auto-close drawer on mobile after file selection

## TODO / Future Enhancements
- Breadcrumb trail & quick navigation buttons (home/up/back).
- Context menu for file operations (rename, delete, new file).
- Git operations (stage, commit, push) wired to backend helpers (UI ready, needs implementation).
- Filter/search box to reduce visible cards.
- Animation for expand/collapse (currently instant).

Refer to this document before tweaking explorer visuals or interaction patterns. Keep the card waterfall aesthetic consistent across new features.
