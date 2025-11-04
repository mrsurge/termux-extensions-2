# Responsive Layout System

**Code CM6** implements a **convergent layout architecture** that adapts seamlessly between desktop and mobile contexts, providing a fully-featured code editing experience regardless of device form factor.

## Design Philosophy: Convergence

Rather than compromising on features for mobile or cluttering the desktop experience, Code CM6 **converges** desktop power with mobile accessibility through intelligent layout transformations. The same editor, the same capabilities—just optimized for how you work in each context.

---

## Desktop/Landscape Mode (`min-width: 768px` + `orientation: landscape`)

### Layout Architecture
- **Tiled panel system** with resizable dividers
- **Explorer sidebar** (left, always visible, ~430px default)
- **Editor column** (center, flexible width)
- **Agent drawer** (right, toggleable, ~400px default)
- **Terminal** (bottom of editor column, toggleable, ~340px default)

### Key Features
- All panels scroll independently
- Drag-to-resize handles between panels
- Terminal scoped to editor width (not full viewport)
- Explorer always visible (no toggle needed)
- Z-index hierarchy: Dropdowns > Agent > Explorer

### Persistence
- Panel widths saved to localStorage
- Restored on page reload

---

## Mobile/Portrait Mode (all other viewports)

### Layout Architecture
- **Overlay drawer system** for explorer and agent
- **Editor** (full width, center focus)
- **Terminal** (tiled at bottom, toggleable, resizable)
- **Explorer/Agent** (fullscreen overlay drawers)

### Key Features
- Terminal pushes editor up when open
- Explorer/Agent slide over entire viewport
- Touch-friendly resize handles
- Z-index hierarchy: Agent (200) > Dropdowns (150) > Explorer (100) > Terminal (50)

### UX Priority
- Editor remains primary focus
- Drawers provide quick access without obscuring work
- Terminal integrated into layout (not overlay)

---

## Convergence in Action

| Feature | Desktop | Mobile | Result |
|---------|---------|--------|--------|
| **Explorer** | Tiled sidebar | Overlay drawer | Always accessible, context-appropriate |
| **Agent** | Tiled sidebar | Overlay drawer | Full AI power in both modes |
| **Terminal** | Tiled (editor width) | Tiled (full width) | Integrated shell access everywhere |
| **Editor** | Flexible column | Full focus | Optimized real estate |
| **Resize** | Drag dividers | Drag terminal top | Customizable workspace |

---

## Technical Implementation

### Responsive Detection
- JavaScript layout manager detects viewport changes
- Applies `.layout-desktop` or `.layout-mobile` class to root
- CSS Grid reconfigures based on class

### Grid Structure (Desktop)
```css
grid-template-columns: var(--explorer-width) 1fr var(--agent-width);
grid-template-rows: auto auto 1fr auto;
```

### Grid Structure (Mobile)
```css
grid-template-columns: 1fr;
grid-template-rows: auto auto 1fr auto;
```

### Toggle Behavior
- **All toggles remain unchanged** across modes
- Only the **presentation layer** (tiled vs overlay) changes
- Consistent UX regardless of viewport

---

## The Vision

Code CM6 proves that a **fully-featured code editor** can exist on mobile without compromise. Not a "mobile editor" or a "desktop editor"—just an **editor** that adapts to you.

**Convergence** means:
- ✅ Same features, different layouts
- ✅ Touch-friendly on mobile, precision on desktop
- ✅ One codebase, universal experience
- ✅ No feature flags, no "mobile mode"—just intelligence

---

**Last Updated**: October 31, 2025
