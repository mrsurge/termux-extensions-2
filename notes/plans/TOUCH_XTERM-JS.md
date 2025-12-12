Short version: xterm.js is *not* very touch-friendly out of the box (and the maintainers explicitly call this out as an open problem) so you have to build most of the mobile UX yourself around it: layout/CSS, custom touch → scroll/selection/zoom handling, your own copy/paste affordances, and explicit “show keyboard” hooks. I’ll walk through the full stack and give you concrete patterns you can drop in.

## Implementation plan (Termux-Extensions-2 / `file_editor_cm6` terminal)

Scope for the next iteration: **incremental zoom** + **touch scroll semantics** + **touch selection semantics** (no project state in the browser).

1. **Incremental zoom**
   - Add `A−` / `A+` buttons in `.terminal-header` (`app/apps/file_editor_cm6/template.html`).
   - Wire them to clamp + update `term.options.fontSize` and refit (`app/apps/file_editor_cm6/static/js/terminal.js`).
   - (Optional later) add 2‑finger pinch → fontSize mapping.

2. **Touch scroll semantics**
   - Hide scrollbar on touch; keep it narrow on desktop (`app/apps/file_editor_cm6/template.html` CSS).
   - Implement 1‑finger drag → scrollback via `term.scrollLines()` with integer-safe accumulation (no wheel required).
   - Prevent the page behind the drawer from scrolling while dragging (use `touch-action` + `preventDefault`).

3. **Touch selection semantics**
   - Tap: focus terminal (bring up keyboard).
   - Long‑press (e.g. ~450ms): enter selection mode; drag selects via synthetic mouse events (`mousedown/mousemove/mouseup`) so xterm’s built-in selection model is used.
   - (Optional later) double‑tap → word select via synthetic `dblclick`.
   - Add a simple “Copy selection” button so selection is actually usable on mobile.

---

## 0. Reality check: what xterm.js does (and doesn’t) do on touch

* There is a **current open issue**: “Limited touch support on mobile devices impacts terminal usability”. It lists missing things like touch scrolling, pinch-zoom, touch selection, long-press context menu, double-tap word selection, etc. Most of those either don’t work or degrade to basic mouse emulation. ([GitHub][1])
* Older issues also show copy/paste and selection on iPad being problematic enough that people ship *term.js* just for mobile. ([GitHub][2])

So: xterm.js gives you:

* A **terminal engine + buffer + selection model + APIs** ([xtermjs.org][3])
* A hidden `<textarea>` to capture keyboard input (critical for iOS) ([tbodt.com][4])
* Event hooks (`onData`, `onSelectionChange`, `attachCustomWheelEventHandler`, etc.) ([xtermjs.org][3])

Everything “nice” for touch (gesture semantics, context menus, custom keyboard affordances, pinch-zoom) is on you.

---

## 1. Baseline xterm options tuned for mobile

Start by making the terminal *visually* touch-friendly:

```ts
import { Terminal } from '@xterm/xterm';

const term = new Terminal({
  fontSize: 16,              // larger for thumb distance
  lineHeight: 1.2,
  letterSpacing: 0,
  scrollback: 5000,          // more history = more value to scrolling
  smoothScrollDuration: 120, // smooth scroll for flicks (ms)
  scrollSensitivity: 1,      // tweak per device
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorInactiveStyle: 'outline', // clearer focus state
  theme: {
    background: '#000000',
    foreground: '#f5f5f5'
  }
});
```

Those options are all straight from `ITerminalOptions` (`fontSize`, `lineHeight`, `scrollback`, `smoothScrollDuration`, `scrollSensitivity`, cursor options, theme). ([xtermjs.org][5])

Then:

```ts
const container = document.getElementById('terminal');
term.open(container);
```

---

## 2. Layout & CSS so touch doesn’t fight the page

You want the terminal to feel like a full-screen surface, not a tiny scrollable div inside another scrollable page.

Key CSS on the container:

```css
#terminal {
  position: relative;
  width: 100%;
  height: 100%;
  max-height: 100vh;
  /* avoid the page behind it scrolling when you interact with the term */
  overscroll-behavior: contain;
  /* let us decide what gestures do */
  touch-action: none;  /* or 'pan-y' if you want native vertical scroll */
}
```

`overscroll-behavior: contain` stops the surrounding page from rubber-banding while you scroll inside the terminal. ([Medium][6])

On mobile you’ll also want a sane viewport meta:

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover">
```

(If you *really* want to prevent browser zoom completely, you can add `user-scalable=no`, but that’s generally frowned on for accessibility.)

---

## 3. One-finger touch = scrollback (custom scroll semantics)

By default, xterm uses **wheel events** for scrollback, not touch gestures. Wheel events don’t fire for `touchmove`, so nothing happens.

You have two main patterns:

### 3.1 Direct “drag to scroll” using `scrollLines`

Use `touchstart` / `touchmove` on `term.element` and convert vertical movement to scrollback:

```ts
const el = term.element!;
let lastY: number | null = null;

el.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  lastY = e.touches[0].clientY;
}, { passive: false });

el.addEventListener('touchmove', e => {
  if (e.touches.length !== 1 || lastY == null) return;

  const y = e.touches[0].clientY;
  const dy = y - lastY;
  lastY = y;

  // tune divisor based on fontSize/lineHeight
  const lines = -dy / 24; // ~1 line per 24px
  term.scrollLines(lines);

  e.preventDefault();   // stop page scroll
  e.stopPropagation();  // stop other handlers
}, { passive: false });

el.addEventListener('touchend', () => {
  lastY = null;
}, { passive: false });
```

Here you’re telling xterm “scroll the viewport N lines” yourself via `scrollLines` / `scrollPages`, which are part of the public API. ([xtermjs.org][3])

To make it feel more inertial, rely on `smoothScrollDuration` (xterm will animate the scroll over that duration for jumps). ([xtermjs.org][7])

### 3.2 Map touch gestures to *mouse wheel* (if you prefer that semantic)

If you’d rather keep xterm’s wheel behavior (respecting mouse tracking modes, alternate screen behavior, etc.), you can synthesize `WheelEvent`s instead of calling `scrollLines`. Then, optionally, use `attachCustomWheelEventHandler` if you need to intercept/scale them. ([xtermjs.org][3])

Example:

```ts
function sendWheel(deltaY: number) {
  const rect = el.getBoundingClientRect();
  const evt = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    deltaY
  });
  el.dispatchEvent(evt);
}

let lastY: number | null = null;
el.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  lastY = e.touches[0].clientY;
}, { passive: false });

el.addEventListener('touchmove', e => {
  if (e.touches.length !== 1 || lastY == null) return;
  const y = e.touches[0].clientY;
  const dy = y - lastY;
  lastY = y;

  sendWheel(dy);        // device-specific tuning here

  e.preventDefault();
}, { passive: false });
```

If you *also* use touch gestures for cursor movement (Midnight Commander, etc.), you’ll want the StackOverflow trick: `event.stopPropagation()` in your own `touchmove` handler so your gesture doesn’t scroll the terminal and send arrows at the same time. ([Stack Overflow][8])

---

## 4. Selection & copy on touch

This is where xterm is weakest on mobile. There’s a long-standing iPad issue where selection and clipboard don’t behave in a usable way. ([GitHub][2])

### 4.1 Easiest workable pattern: map touch → mouse events

A StackOverflow user reports success by mapping touch events to mouse events and letting xterm’s selection code do the rest. ([Stack Overflow][9])

This is conceptually simple:

```ts
function synthMouse(type: string, touch: Touch, button = 0) {
  const rect = el.getBoundingClientRect();
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: touch.clientX,
    clientY: touch.clientY,
    button
  });
  el.dispatchEvent(evt);
}

el.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  synthMouse('mousedown', e.touches[0], 0);
  e.preventDefault();
}, { passive: false });

el.addEventListener('touchmove', e => {
  synthMouse('mousemove', e.touches[0], 0);
  e.preventDefault();
}, { passive: false });

el.addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  synthMouse('mouseup', t, 0);
  e.preventDefault();
}, { passive: false });
```

Now a “tap-drag-release” gesture behaves like click-drag-release, which uses xterm’s built-in selection model.

### 4.2 Copy button wired to `getSelection` + Clipboard API

On mobile you can’t rely on OS shortcuts, so expose an explicit button:

```ts
const copyBtn = document.getElementById('copy');

copyBtn.addEventListener('click', async () => {
  const text = term.getSelection();   // API call :contentReference[oaicite:13]{index=13}
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    // optionally show a toast
  } catch {
    // as a fallback, show modal textarea for manual copy
  }
});
```

`getSelection()` is exactly for this: “implementing copy behavior outside of xterm.js.” ([xtermjs.org][3])

### 4.3 Basic “double tap = word” semantics

If you want nicer semantics:

* Use `touchstart` timestamp + position.
* If you get a second tap within N ms and within a small radius, treat as double-tap and call `term.select` or `term.selectLines`.

To map touch Y → row index, you can treat:

```ts
const rect = el.getBoundingClientRect();
const relY = touch.clientY - rect.top;
const approxRow = Math.floor(relY / (term.options.lineHeight! * fontPx));
```

Then adjust with buffer base offset (via `buffer`) if you need exact ranges. `select` takes start/end columns and rows in buffer coordinates. ([xtermjs.org][3])

That’s more work, but it lets you own word/line selection completely and not rely on browser text selection, which is pretty janky inside canvas/DOM terminals.

---

## 5. Touch-aware copy/paste with a helper overlay

Because **paste** is even more constrained on mobile, the most stable pattern is:

* A **Paste** button which:

  * Calls `navigator.clipboard.readText()` on user gesture where supported.
  * Or pops a `<textarea>` dialog where users can paste, then you call `term.paste(text)` or `term.input(text, true)`.

```ts
const pasteBtn = document.getElementById('paste');
pasteBtn.addEventListener('click', async () => {
  if (navigator.clipboard?.readText) {
    const text = await navigator.clipboard.readText();
    if (text) term.paste(text);
  } else {
    // fallback: show modal textarea, then paste its value
  }
});
```

`paste(data)` is explicitly there to emulate user pastes into the terminal. ([xtermjs.org][3])

Keep in mind there’s a known iPad bug where even keyboard Cmd-C doesn’t always copy from xterm selection, so explicit UI affordances are worth it. ([GitHub][2])

---

## 6. Making the keyboard experience not horrible

xterm uses a hidden `<textarea>` for input, and the terminal is only “focused” when that textarea is focused. ([tbodt.com][4])

On mobile, what tends to work best:

1. **Tap-to-focus gesture**

   ```ts
   el.addEventListener('click', () => term.focus());
   ```

   That drives focus into the textarea, which tells iOS/Android to raise the soft keyboard.

2. A persistent **Keyboard** button (bottom-right) that also calls `term.focus()`. This solves the “I scrolled up, lost focus, can’t get keyboard back” problem.

3. If you have a custom overlay keyboard, you can feed it into xterm via:

   ```ts
   term.input(customKeySequence, true); // marks as user input :contentReference[oaicite:19]{index=19}
   ```

4. Use `attachCustomKeyEventHandler` to fix the usual mobile quirks: intercept `Ctrl+C`, `Ctrl+V`, arrow keys from hardware keyboards, etc. ([xtermjs.org][3])

   Example: treat `Ctrl+C` as copy when there’s a selection, otherwise send SIGINT:

   ```ts
   term.attachCustomKeyEventHandler(ev => {
     if (ev.ctrlKey && ev.key === 'c') {
       if (term.hasSelection()) {
         const text = term.getSelection();
         navigator.clipboard.writeText(text).catch(() => {});
         return false; // don't send ^C to pty
       }
     }
     return true; // let xterm handle normally
   });
   ```

---

## 7. Gestures beyond scroll: pinch-zoom & long-press

None of this is built-in; you can layer it on top.

### 7.1 Pinch-zoom that actually changes font size

You can implement classic “two-finger pinch” and map scale → fontSize:

```ts
let pinchStartDist: number | null = null;
let pinchStartFont: number | null = null;

function dist(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

el.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    pinchStartDist = dist(e.touches[0], e.touches[1]);
    pinchStartFont = term.options.fontSize || 16;
  }
}, { passive: false });

el.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && pinchStartDist && pinchStartFont) {
    const d = dist(e.touches[0], e.touches[1]);
    const scale = d / pinchStartDist;
    let newSize = pinchStartFont * scale;
    newSize = Math.max(10, Math.min(28, newSize)); // clamp

    term.options = { ...term.options, fontSize: newSize };
    term.refresh(0, term.rows - 1); // redraw :contentReference[oaicite:21]{index=21}

    e.preventDefault();
  }
}, { passive: false });

el.addEventListener('touchend', () => {
  if (event.touches.length < 2) {
    pinchStartDist = null;
    pinchStartFont = null;
  }
}, { passive: false });
```

This gives you *real* zoom (bigger text), not browser page zoom.

### 7.2 Long-press = context menu

Pick a gesture budget, e.g.:

* **Tap**: focus + place cursor.
* **Tap+drag**: selection.
* **Long-press (600ms)**: open your own context menu (Copy / Paste / Select All / Clear).

Track `touchstart` timestamp and see if it lasts longer than threshold without moving too far, then pop up your menu at that position.

---

## 8. Links and tap behavior

xterm has a link provider API and a link handling guide; on desktop they recommend requiring a modifier key for click-to-open to avoid accidental URL opens. ([xtermjs.org][10])

On touch you obviously don’t have Ctrl-click, so:

* Register a link provider to mark URLs in the buffer.
* On **single tap** on a link range: open URL (after showing a confirmation sheet).
* On **long-press**: offer “Copy link” / “Open” options.

That’s all done in your code; the link provider just gives you ranges & metadata. ([xtermjs.org][10])

---

## 9. Renderer & perf considerations for mobile

There are 3 rendering modes in practice:

* **DOM renderer** (default on some setups, or when WebGL isn’t available)
* **Canvas renderer**
* **WebGL renderer** via `@xterm/addon-webgl` ([xtermjs.org][11])

On mobile:

* WebGL can give you better perf (less CPU, smoother scroll) on decent GPUs, at the cost of more GPU memory. ([Cloudsmith][12])
* DOM renderer plays better with accessibility and sometimes with browser pinch-zoom, but you’re mostly running your own zoom anyway.

Typical setup:

```ts
import { WebglAddon } from '@xterm/addon-webgl';

const webgl = new WebglAddon();
term.loadAddon(webgl);
```

If you see glitches or GPU driver weirdness, just skip WebGL and let xterm fall back.

Also worth noting: there’s an official guide about using Intersection Observer with xterm to suspend work when the terminal is off-screen, which is nice if your terminal lives inside a tabbed UI. ([Growing With The Web][13])

---

## 10. Summary of concrete knobs to turn

**Config / options**

* `fontSize`, `lineHeight`, `letterSpacing` tuned for finger-distance readability.
* `scrollback` increased, `smoothScrollDuration` ~100–150ms, `scrollSensitivity` tuned. ([xtermjs.org][5])
* High-contrast `theme`.

**CSS / layout**

* Full-height container, `overscroll-behavior: contain`, `touch-action: none` or `pan-y`.
* No nested scroll containers inside the terminal area.

**Touch / gestures**

* 1-finger drag → scrollback (either `scrollLines` or synthetic `WheelEvent`).
* Optional: map touch → mouse to reuse xterm’s selection engine.
* Double-tap → word-select; long-press → context menu.
* 2-finger pinch → change `fontSize`.

**Clipboard and keyboard**

* Explicit Copy/Paste buttons wired to `getSelection()` / `paste()`.
* Tap/Keyboard button calls `term.focus()` to bring up OSK.
* `attachCustomKeyEventHandler` for hardware keyboards and “Ctrl+C vs Copy” behavior.

**Optional**

* Link provider + touch-friendly link semantics.
* WebGL renderer for smoother scroll if GPU can handle it.

If you want, next step I can drill this down into a single “mobile-xterm wrapper” module that you can drop into your current app, but this is the full menu of things you can realistically do to make xterm.js as touch-friendly as it’s going to get right now.

[1]: https://github.com/xtermjs/xterm.js/issues/5377 "Limited touch support on mobile devices impacts terminal usability · Issue #5377 · xtermjs/xterm.js · GitHub"
[2]: https://github.com/xtermjs/xterm.js/issues/3727?utm_source=chatgpt.com "Copy and paste do not work on touch devices · Issue #3727"
[3]: https://xtermjs.org/docs/api/terminal/classes/terminal/ "Terminal"
[4]: https://tbodt.com/2017/11/05/hterm-xterm.html?utm_source=chatgpt.com "hterm vs xterm.js"
[5]: https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/ "ITerminalOptions"
[6]: https://medium.com/%40yev-/how-to-prevent-scroll-touch-move-on-mobile-web-parent-elements-while-allowing-it-on-children-f7acb793c621?utm_source=chatgpt.com "How to Prevent Scroll (& Touch Move) On Mobile Web ..."
[7]: https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/?utm_source=chatgpt.com "ITerminalOptions"
[8]: https://stackoverflow.com/questions/46453714/disable-touch-scrolling-in-xterm-js?utm_source=chatgpt.com "Disable touch scrolling in xterm.js"
[9]: https://stackoverflow.com/questions/58443764/how-to-select-with-touch-event-ipad-on-xtermjs?utm_source=chatgpt.com "How to select with touch event (iPad) on xtermjs"
[10]: https://xtermjs.org/docs/guides/link-handling/?utm_source=chatgpt.com "Link Handling"
[11]: https://xtermjs.org/docs/guides/using-addons/?utm_source=chatgpt.com "Using addons"
[12]: https://cloudsmith.com/navigator/npm/xterm-addon-webgl?utm_source=chatgpt.com "xterm-addon-webgl (0.16.0) - npm Package Quality"
[13]: https://www.growingwiththeweb.com/p/explore.html?utm_source=chatgpt.com "Explore"
