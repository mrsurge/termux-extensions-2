# Mobile-First Responsive Layout Implementation

**Date:** November 3, 2025  
**Status:** ✅ Implemented

## Overview

Refactored the `layout_manager.py` to implement a mobile-first responsive layout with:
- **Explorer drawer** - Button-controlled (mobile: overlay, desktop: static left tile)
- **Agent drawer** - Button-controlled (mobile: overlay, desktop: static right tile)
- **Terminal** - Collapsible bottom tile (normally closed, toggle button to open)
- **Editor** - Main content area (always visible)

## Layout Behavior

### Mobile (< 768px)

```
┌─────────────────────────────────────────┐
│ [File Path Header]                      │
├─────────────────────────────────────────┤
│ [📁] [Menu Header] [🤖]                 │  ← Toggle buttons
├─────────────────────────────────────────┤
│                                         │
│         EDITOR                          │  ← Main area
│         (Full width)                    │
│                                         │
├─────────────────────────────────────────┤
│ [▼ Terminal]                            │  ← Toggle button
│ (Terminal hidden by default)            │
└─────────────────────────────────────────┘

[📁] Button → Opens Explorer drawer (slides from left)
[🤖] Button → Opens Agent drawer (slides from right)
[▼ Terminal] → Opens terminal tile below editor
```

**Drawer Behavior:**
- Drawers are **fixed overlays** that slide over the editor
- Only one drawer can be open at a time (opening one closes the other)
- Clicking backdrop closes the drawer
- Smooth slide animation (`transition-transform duration-300`)
- Semi-transparent backdrop when drawer is open

### Desktop (≥ 768px)

```
┌──────────┬──────────────────┬──────────┐
│ [File Path Header]                     │
├──────────┼──────────────────┼──────────┤
│          │ [Menu Header]    │          │
├──────────┼──────────────────┼──────────┤
│          │                  │          │
│ EXPLORER │     EDITOR       │  AGENTS  │
│  (tile)  │   (main area)    │  (tile)  │
│          │                  │          │
│          ├──────────────────┤          │
│          │ [▼ Terminal]     │          │
│          │ (Terminal when   │          │
│          │  expanded)       │          │
└──────────┴──────────────────┴──────────┘
```

**Desktop Behavior:**
- Explorer and Agent drawers are **static tiles** (always visible)
- No toggle buttons needed (they're hidden with `md:hidden`)
- Terminal is a collapsible bottom tile (toggle button always visible)
- Resizable tiles (width: 256px/16rem by default)

## Implementation Details

### State Management

Three boolean flags control visibility:
```python
self.explorer_visible = False   # Explorer drawer state
self.agent_visible = False      # Agent drawer state
self.terminal_visible = False   # Terminal collapsed/expanded
```

### Toggle Functions

```python
def toggle_explorer(self) -> None:
    """Toggle explorer drawer, close agent if opening."""
    self.explorer_visible = not self.explorer_visible
    if self.explorer_visible:
        self.agent_visible = False

def toggle_agent(self) -> None:
    """Toggle agent drawer, close explorer if opening."""
    self.agent_visible = not self.agent_visible
    if self.agent_visible:
        self.explorer_visible = False

def toggle_terminal(self) -> None:
    """Toggle terminal visibility."""
    self.terminal_visible = not self.terminal_visible

def close_all_drawers(self) -> None:
    """Close all mobile drawers (called by backdrop click)."""
    self.explorer_visible = False
    self.agent_visible = False
```

### CSS Classes Breakdown
> **Layout Shell Note:** The NiceGUI shell forces `.q-page-container`, `.q-page`, and the local
> wrapper divs into a shared flex column. The layout manager’s `main_container` and each module
> zone must keep `flex-1 min-h-0` so the explorer/editor/agent stack consumes the full height
> beneath the shared headers. The keyboard padding lives in the shell CSS; no module should
> reintroduce viewport height math.

**Explorer Drawer:**
```css
/* Mobile: Fixed overlay drawer */
fixed md:relative          /* Fixed on mobile, relative on desktop */
inset-y-0 left-0          /* Full height, anchored left */
z-50                      /* Above content */
w-80 md:w-auto            /* 320px mobile, auto desktop */
transform transition-transform duration-300  /* Smooth slide */
-translate-x-full md:translate-x-0  /* Hidden left on mobile, visible desktop */

/* Desktop: Static left tile */
md:flex md:flex-shrink-0 md:w-64  /* 256px width tile */
bg-slate-950/95 md:bg-transparent  /* Dark backdrop mobile, clear desktop */
shadow-2xl md:shadow-none          /* Shadow on mobile only */
te-mobile-header-offset            /* Offset overlay below shell header on mobile */
te-mobile-drawer-padding           /* Keyboard + safe-area padding on mobile */
```

**Agent Drawer:**
```css
/* Mobile: Fixed overlay drawer (from right) */
fixed md:relative
inset-y-0 right-0         /* Full height, anchored right */
z-50
w-80 md:w-auto
transform transition-transform duration-300
translate-x-full md:translate-x-0  /* Hidden right on mobile, visible desktop */

/* Desktop: Static right tile */
md:flex md:flex-shrink-0 md:w-64
bg-slate-950/95 md:bg-transparent
shadow-2xl md:shadow-none
te-mobile-header-offset
te-mobile-drawer-padding
```

**Terminal Zone:**
```css
/* Always a tile (bottom) */
flex-shrink-0             /* Don't compress */
overflow-auto             /* Scrollable content */
visibility: hidden/visible /* Controlled by terminal_visible flag */
height: 240px             /* Fixed height when visible */
```

**Backdrop (Mobile Only):**
```css
md:hidden                 /* Hidden on desktop */
fixed inset-0             /* Full screen overlay */
bg-black/50               /* Semi-transparent black */
z-40                      /* Below drawers (z-50), above content */
opacity-0 pointer-events-none transition-opacity duration-200
te-mobile-header-offset
```

### State Synchronization Helpers

The drawers and backdrop now share explicit helpers so we can keep Tailwind classes in sync without relying on
transform-returning visibility bindings (which were brittle on mobile):

```python
def _apply_explorer_state(self) -> None:
    if not self._explorer_drawer:
        return
    if self.explorer_visible:
        self._explorer_drawer.classes(
            add="translate-x-0 pointer-events-auto",
            remove="-translate-x-full pointer-events-none",
        )
    else:
        self._explorer_drawer.classes(
            add="-translate-x-full pointer-events-none",
            remove="translate-x-0 pointer-events-auto",
        )
    self._update_backdrop()

def _apply_agent_state(self) -> None:
    if not self._agent_drawer:
        return
    if self.agent_visible:
        self._agent_drawer.classes(
            add="translate-x-0 pointer-events-auto md:flex md:flex-shrink-0 md:opacity-100 md:pointer-events-auto",
            remove="translate-x-full pointer-events-none md:hidden md:opacity-0 md:pointer-events-none",
        )
    else:
        self._agent_drawer.classes(
            add="translate-x-full pointer-events-none md:hidden md:opacity-0 md:pointer-events-none",
            remove="translate-x-0 pointer-events-auto md:flex md:flex-shrink-0 md:opacity-100 md:pointer-events-auto",
        )
    self._update_backdrop()

def _update_backdrop(self) -> None:
    if not self._backdrop:
        return
    if self.explorer_visible or self.agent_visible:
        self._backdrop.classes(
            add="opacity-100 pointer-events-auto",
            remove="opacity-0 pointer-events-none",
        )
    else:
        self._backdrop.classes(
            add="opacity-0 pointer-events-none",
            remove="opacity-100 pointer-events-auto",
        )
```

`terminal_zone.bind_visibility_from(self, "terminal_visible")` still controls the collapsible terminal tile; no changes needed there.

> **Shared Shell Helpers:** `.te-mobile-header-offset` and `.te-mobile-drawer-padding` live in the shell CSS (`app/apps/nicegui_shell/worker.py`). They keep overlays anchored beneath the combined shell/app headers on phones and preserve the safe-area + virtual-keyboard inset. Apply them to any future mobile overlays so they don’t slide under the header.

## Header Buttons

**Explorer Toggle (Mobile Only):**
```python
ui.button(icon="folder_open", on_click=lambda: self.toggle_explorer())
    .classes("md:hidden")
    .tooltip("Toggle Explorer")
```

**Agent Toggle (All Breakpoints):**
```python
ui.button(icon="smart_toy", on_click=lambda: self.toggle_agent())
    .tooltip("Toggle Agent")
```

**Terminal Toggle (Always Visible):**
```python
ui.button(icon="terminal", on_click=lambda: self.toggle_terminal())
    .classes("w-full")
    .tooltip("Toggle Terminal")
```

## Testing Instructions

### Quick Test
```bash
cd /home/mrsurge/Documents/code_cm62
./scripts/run_framework.sh

# Open browser to http://localhost:8088
# Click Code CM6 (NiceGUI) app
```

### Mobile Testing
1. **Open DevTools** → Toggle device toolbar (Ctrl+Shift+M)
2. **Select mobile device** (e.g., iPhone 12, Pixel 5)
3. **Test Explorer:**
   - Click folder icon in header
   - Drawer should slide in from left
   - Backdrop should appear
   - Click backdrop → drawer closes
4. **Test Agent:**
   - Click robot icon in header
   - Drawer should slide in from right
   - Explorer drawer should close if open
5. **Test Terminal:**
   - Click terminal button
   - Terminal tile expands below editor
   - Click again → collapses

### Desktop Testing
1. **Resize browser** to > 768px width
2. **Verify:**
   - Explorer tile remains visible without needing a toggle
   - Agent button stays in the header; clicking it slides the agent panel in/out
   - Terminal toggle still visible
   - Terminal expands/collapses at bottom

## Module Updates Needed

Current modules render placeholder content. To complete the implementation:

### 1. Explorer Module (`modules/native/explorer.py`)
```python
def render(self, container: ui.element) -> None:
    with container:
        with ui.column().classes("h-full w-full p-4"):
            ui.label("Explorer").classes("text-lg font-semibold mb-4")
            # Add file tree here
            # Add breadcrumbs navigation
            # Add create/delete buttons
```

### 2. Agent Drawer Module (`modules/native/agent_drawer.py`)
```python
def render(self, container: ui.element) -> None:
    with container:
        with ui.column().classes("h-full w-full p-4"):
            ui.label("Agents").classes("text-lg font-semibold mb-4")
            # Add session list
            # Add message history
            # Add input field
```

### 3. Terminal Module (`modules/native/terminal.py`)
```python
def render(self, container: ui.element) -> None:
    with container:
        with ui.column().classes("h-full w-full p-2"):
            # Add xterm.js terminal
            # Add PTY connection
            # Add command history
```

## Future Enhancements

### Resizable Terminal
```python
# Add resize handle
with ui.element().classes("cursor-ns-resize h-2 bg-slate-700 hover:bg-slate-600"):
    # Drag to resize terminal height
```

### Swipe Gestures
```python
# Add touch event handlers for swipe
@ui.on_event('touchstart')
def handle_touch_start(e):
    # Track touch position

@ui.on_event('touchmove')
def handle_touch_move(e):
    # Calculate swipe direction and distance

@ui.on_event('touchend')
def handle_touch_end(e):
    # Open/close drawer based on swipe
```

### Persistent State
```python
# Save drawer state to preferences
def save_layout_state(self):
    prefs.set('layout.terminal_visible', self.terminal_visible)
    prefs.set('layout.terminal_height', self.terminal_height)
```

## Benefits

✅ **Mobile-First** - Touch-friendly drawers, no cramped multi-column layout  
✅ **Desktop-Optimized** - Static tiles for quick access, no drawer overhead  
✅ **Progressive Enhancement** - Same HTML, different CSS behavior  
✅ **State Management** - Python controls visibility, NiceGUI handles reactivity  
✅ **Smooth Animations** - Tailwind transitions for polished UX  
✅ **Flexible Terminal** - Only visible when needed, saves vertical space  

## Aligns With Migration Plan

From `MIGRATION_PLAN.md`:

> **Mobile Behavior:**
> - Explorer: Full-screen drawer (left swipe) ✅
> - Agent Drawer: Full-screen drawer (right swipe) ✅
> - Terminal: Always tiled (bottom) ✅ (collapsible)
> - Editor: Main content area ✅

> **Desktop Behavior:**
> - Explorer: Left tile (resizable) ✅
> - Agent Drawer: Right overlay panel (with icon tabs) ✅ (static tile for now)
> - Terminal: Bottom tile (resizable) ✅ (collapsible)
> - Editor: Center tile ✅

---

**Implementation Status:** ✅ Complete  
**Next Steps:** Port content from legacy `file_editor_cm6` modules  
**Ready for Testing:** Yes - start framework and test responsiveness
