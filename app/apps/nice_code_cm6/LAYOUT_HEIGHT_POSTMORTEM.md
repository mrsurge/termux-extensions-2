# NiceGUI Layout Height Postmortem

**Date:** November 3, 2025  
**Scope:** `app/apps/nice_code_cm6` + shared `app/apps/nicegui_shell/worker.py`

---

## Background

While finishing the NiceGUI migration we hit a show-stopper: the explorer, editor, and agent
modules were clamped to ~130 px of vertical space even though the shell header and the
overall layout were full height. The surface-level fix attempts (margin tweaks, hard-coded
heights, sticky headers) only masked the issue and caused regressions on mobile.

This document captures the debugging journey, the architectural constraints we uncovered,
and the final layout contract we landed on so future work (feature parity, modals, etc.)
stays aligned with the framework shell.

---

## Symptoms

* Explorer / editor / agent stack rendered underneath the headers but ended ~112 px above the
  footer, leaving a blank gap.
* DevTools showed `.nicegui-content` reporting the expected height (header-to-footer),
  while `.main-scroll`, `.app-body`, and the `relative flex w-full` container under
  `layout_manager.py` collapsed to ~130 px.
* Attempts to compensate with `height: calc(100dvh - header_height)` or sticky headers
  caused mobile keyboards to overlap the editor or introduced extra whitespace between the
  stacked headers.

---

## Root Causes

1. **Header subtraction in shell CSS**
   * Earlier iterations subtracted the measured header height from `.main-scroll` by hand,
     which worked when the nested wrappers were missing flex sizing but produced the 112 px
     offset once we tightened the stack.

2. **Missing flex participation in Quasar wrappers**
   * NiceGUI wraps every page in `q-layout → q-page-container → q-page →
     <div class="nicegui-page ...">`.
   * Only `.nicegui-content` and our inner containers were flex columns. The intermediate
     wrappers defaulted to `display: block`, so children (`.main-scroll`) fell back to their
     intrinsic height.

3. **`layout_manager` leaf container lacked flex growth**
   * The innermost wrapper (`main_container` in `core/layout_manager.py`) only carried
     `h-full min-h-0`, which is a no-op without a flex parent. Once the outer stack was fixed
     it also needed `flex-1`.

---

## Final Solution

| Layer | Change | File |
| --- | --- | --- |
| NiceGUI shell | Removed manual header subtraction; kept keyboard padding; added flex sizing for Quasar wrappers | `app/apps/nicegui_shell/worker.py` |
| Quasar wrappers | Forced `q-page-container`, `q-page`, and any intermediate `.nicegui-page*` divs into `display:flex; flex-direction:column; flex:1; min-height:0;` | `app/apps/nicegui_shell/worker.py` |
| Scroll container | Restored `.main-scroll` to flex column, `overflow-auto`, plus `height:100%; min-height:0;` | `app/apps/nicegui_shell/worker.py` |
| Layout manager | Added `flex-1` to `main_container` (`relative flex …`) so it expands to the full height provided by the scroll layer | `app/apps/nice_code_cm6/core/layout_manager.py` |

```css
.nicegui-content {
    flex: 1 1 auto;
    display: flex !important;
    flex-direction: column !important;
    width: 100% !important;
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
}

.q-page-container,
.q-page,
.q-page > div,
.nicegui-page,
.nicegui-page-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
}

.main-scroll {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--vk-offset));
    background: #020617;
    height: 100%;
    min-height: 0;
}

.app-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
}
```

```python
# core/layout_manager.py
with body_container:
    main_container = ui.element().classes("relative flex flex-1 w-full min-h-0")
```

These changes keep the headers untouched but guarantee that every descendant participates
in the same flex column, preventing future modules from collapsing.

---

## Verification Checklist

* **Desktop:** Explorer/editor/agent stack fills the viewport under the headers; no blank gap.
* **Mobile:** Keyboard overlay slides up without shifting headers; content stays scrollable.
* **Modals/Dialogs:** As long as modals are rendered inside `.main-scroll` / `.app-body`, they
  inherit the full height. NiceGUI’s global dialogs already overlay correctly.
* **Viewport resize:** `ResizeObserver` in `worker.py` updates `--shell-header-height`; height
  stays correct when headers grow/shrink.

---

## Future Guidance

* **Add new modules inside `.app-body`.** They will automatically inherit the flex column
  and height rules.
* **Avoid reintroducing hard-coded viewport math.** Let the flex stack handle height, and use
  the existing CSS variables only when you need keyboard padding.
* **When adding custom wrappers**, remember to set `display:flex; flex-direction:column; flex:1;
  min-height:0;` if they sit between the shell header and the modules. Missing one layer will
  recreate the collapse.
* **Modals / popovers** are fine as long as they live inside the main container or use
  NiceGUI’s overlay primitives.

With this baseline in place we can safely proceed to feature parity migration, agent drawer
work, and the rest of the NiceGUI integration without revisiting height regressions.
