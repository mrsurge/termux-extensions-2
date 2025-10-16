# Fixing Explorer Hydration & Assistant Collapse (before/after audit)

This guide explains **why the Explorer drawer stopped hydrating** and **why the Assistant panel doesn’t collapse**, based on the **before/after** files you shared. It includes targeted diffs/snippets and a test checklist.

---

## 1) Root cause: script boot order changed → hydration never runs

**Before:** the page loaded the hydrator with a **static `defer` script**:

- `fullpage.html` ends with
```html
<script src="/apps/code_oss/static/js/ide_fullpage.js" defer></script>
```
This guarantees the script runs **before** `DOMContentLoaded`, so any `document.addEventListener('DOMContentLoaded', …)` inside your hydrator will fire. fileciteturn9file3

**After:** the page injects the script **dynamically**:
```html
<script>
  (function() {
    const script = document.createElement('script');
    script.src = `/apps/code_oss/static/js/ide_fullpage.js?v=${Date.now()}`;
    script.defer = true; // ❌ ignored for dynamically-inserted scripts
    document.body.appendChild(script);
  })();
</script>
```
For dynamically-added scripts the `defer` attribute is **not honored**. If your hydrator attaches a `DOMContentLoaded` listener after the event has already fired, **init never runs**, so the Explorer drawer stays “Loading workspace…”. (This change appears in `fullpage.after.html`.) fileciteturn9file0

### Fix (pick one)
**A) Revert to static `defer` include** (simplest & robust):
```diff
- <script>
-   (function(){
-     const script = document.createElement('script');
-     script.src = `/apps/code_oss/static/js/ide_fullpage.js?v=${Date.now()}`;
-     script.defer = true;
-     document.body.appendChild(script);
-   })();
- </script>
+ <script src="/apps/code_oss/static/js/ide_fullpage.js" defer></script>
```

**B) Keep dynamic load, add a readyState guard inside `ide_fullpage.js`:**
```ts
function boot() { try { initIdeHydration(); } catch (e) { console.error(e); } }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  // DOM already parsed → run immediately
  boot();
}
```
This ensures hydration runs even if the script is appended **after** `DOMContentLoaded`.

---

## 2) Assistant panel doesn’t collapse → missing JS toggle + minor CSS oversights

Your new CSS introduces an **`assistant-collapsed`** state and a **footer toggle button**:
- New footer & toggle button exist only in **after** HTML (`#ide-footer`, `#btn-toggle-assistant`). fileciteturn9file0
- New rules in **after** CSS move the chat off-screen when `#ide-root.assistant-collapsed` is present. fileciteturn9file1

But nothing wires the button to toggle the class, so it never collapses.

### Add the click handler (in your page boot JS)
```ts
const root = document.getElementById('ide-root');
const btn = document.getElementById('btn-toggle-assistant');
if (root && btn) {
  btn.addEventListener('click', () => {
    const collapsed = root.classList.toggle('assistant-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
  });
}
```

### Make desktop collapse reserve space if desired (optional)
In **after** CSS, mobile already reserves space with `#ide-root:not(.assistant-collapsed) { padding-bottom: var(--chat-height); }` under the 768px media query. Desktop uses a fixed footer height and overlays the chat. If you want desktop to **also** reserve space when expanded, add:
```css
/* Outside media queries */
#ide-root:not(.assistant-collapsed) { padding-bottom: var(--chat-height); }
```
Otherwise the overlay is intentional and fine.

### Clean up a confusing mobile rule (optional)
This rule moves the footer when collapsed and can look jumpy:
```css
#ide-root.assistant-collapsed #ide-footer {
  bottom: var(--chat-height);
  transform: translateY(calc(100% - 58px));
}
```
If you don’t need that animation, remove it, or replace with a simple opacity/translate that doesn’t offset position.

---

## 3) Explorer hydration selectors: confirm nothing else changed

The **container IDs** for hydration are intact in both before/after:
- `#ide-drawer`, `#explorer-content`, `.drawer-body` exist in both HTMLs. (No ID rename here.) fileciteturn9file3 fileciteturn9file0
So the failure is almost certainly **boot timing**, not a selector mismatch.

---

## 4) Style changes that won’t block hydration (but worth noting)

- **Body overflow** is `hidden` in after CSS — OK for mobile, but it prevents page scroll. Ensure internal scroll containers (drawer, chat) have `overflow: auto`. They do (`.drawer-body { overflow-y: auto; }`). fileciteturn9file1
- Z-indexes: drawer `z-index:30`, chat `z-index:15`, topbar/footer `z-index:20`. Drawer will correctly appear above the chat, so no pointer-event masking. fileciteturn9file1

---

## 5) Sanity test checklist

1. Re-run with **Fix A** (static defer) or **Fix B** (readyState guard). Hydration should populate `#explorer-content`.
2. In DevTools → **Network**, confirm `/state` polls and explorer tree payloads flow.
3. Click the **assistant toggle** → `assistant-collapsed` class flips on `#ide-root`, chat panel animates off-screen.
4. Open/close drawer → backdrop appears and disappears (`#drawer-backdrop`).
5. Resize to mobile widths → padding & transforms behave (no overlap on critical UI).

---

## 6) Minimal patch set (TL;DR)
- **HTML:** revert to static `defer` for `/apps/code_oss/static/js/ide_fullpage.js` (or add readyState guard inside it).
- **JS:** add click handler for `#btn-toggle-assistant` to toggle `assistant-collapsed`.
- **CSS (optional):** add desktop `padding-bottom` reservation if you don’t want the chat to overlay content.

That’s it—hydration should return, and the assistant panel will collapse/expand properly.

