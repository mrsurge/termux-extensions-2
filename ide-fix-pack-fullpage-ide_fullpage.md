# Explorer Hydration & Assistant Collapse — Fix Pack

**Files in scope:** `fullpage.html`, `ide_fullpage.js`, `ide_fullpage.css`

This doc pinpoints why the **Explorer drawer stopped hydrating** and why the **Assistant panel won’t collapse**, and includes drop‑in patches (with file‑name references) for the current iteration.

---

## 1) What’s broken & why (quick summary)
- **Explorer hydration**: your hydrator now loads correctly via a static `defer` tag in `fullpage.html`, so remaining failures come from **`ide_fullpage.js` boot logic** (init not called, selectors not found, or race with DOM). 
- **Assistant panel**: CSS & markup expect `#ide-root.assistant-collapsed`, but `ide_fullpage.js` **doesn’t toggle** that class, so the panel never moves.

---

## 2) Verified observations in the latest files
- `fullpage.html` includes:
  ```html
  <script src="/apps/code_oss/static/js/ide_fullpage.js" defer></script>
  ```
  Good: avoids the dynamic‑injection race.
- `ide_fullpage.css` contains rules that:
  - Slide the assistant panel when `#ide-root.assistant-collapsed` is present.
  - Overlay vs reserve space depending on viewport.
- Drawer/explorer markup and IDs look stable: `#ide-drawer`, `#explorer-content`, `#drawer-backdrop`, `#btn-menu`, `.drawer-close`.

---

## 3) Required patches for `ide_fullpage.js`
> Place these near the **top** of `ide_fullpage.js`. They’re idempotent and guard against timing issues.

### A) Robust bootstrap guard (prevents race & double init)
```diff
+ (function bootstrapIDE() {
+   if (window.__ide_booted) return;
+   window.__ide_booted = true;
+
+   function boot() {
+     try { initIDE(); } catch (e) { console.error('[ide_fullpage] init failed:', e); }
+   }
+   if (document.readyState === 'loading') {
+     document.addEventListener('DOMContentLoaded', boot, { once: true });
+   } else {
+     boot();
+   }
+ })();
```

### B) Wire the **Assistant collapse** toggle (JS ↔ CSS ↔ HTML)
```diff
+ function wireAssistantToggle() {
+   const root = document.getElementById('ide-root');
+   const btn = document.getElementById('btn-toggle-assistant');
+   if (!root || !btn) return console.warn('[ide_fullpage] assistant toggle elements missing');
+   btn.addEventListener('click', () => {
+     const collapsed = root.classList.toggle('assistant-collapsed');
+     btn.setAttribute('aria-expanded', String(!collapsed));
+   });
+ }
```

### C) Wire the **Explorer drawer** open/close
```diff
+ function wireDrawer() {
+   const root = document.getElementById('ide-root');
+   const btnMenu = document.getElementById('btn-menu');
+   const btnClose = document.querySelector('.drawer-close');
+   const backdrop = document.getElementById('drawer-backdrop');
+   if (!root) return;
+   const open  = () => root.classList.add('drawer-open');
+   const close = () => root.classList.remove('drawer-open');
+   btnMenu?.addEventListener('click', open);
+   btnClose?.addEventListener('click', close);
+   backdrop?.addEventListener('click', close);
+ }
```

### D) Tabs & iframe shell placement (Document ↔ Full IDE)
```diff
+ function wireTabs() {
+   const tabDoc  = document.getElementById('tab-document');
+   const tabFull = document.getElementById('tab-full');
+   const paneDoc = document.getElementById('document-view');
+   const paneFull= document.getElementById('full-ide-view');
+   const tgtDoc  = document.getElementById('document-frame-target');
+   const tgtFull = document.getElementById('full-frame-target');
+   const shell   = document.getElementById('ide-frame-shell');
+   if (!tabDoc || !tabFull || !paneDoc || !paneFull || !tgtDoc || !tgtFull || !shell) {
+     return console.warn('[ide_fullpage] tabs: missing elements');
+   }
+   function activate(which) {
+     const docMode = which === 'doc';
+     tabDoc.classList.toggle('is-active', docMode);
+     tabFull.classList.toggle('is-active', !docMode);
+     paneDoc.classList.toggle('is-active', docMode);
+     paneFull.classList.toggle('is-active', !docMode);
+     shell.style.display = '';
+     (docMode ? tgtDoc : tgtFull).appendChild(shell);
+     const root = document.getElementById('ide-root');
+     root?.classList.toggle('mode-document', docMode);
+     root?.classList.toggle('mode-full', !docMode);
+   }
+   tabDoc.addEventListener('click', () => activate('doc'));
+   tabFull.addEventListener('click', () => activate('full'));
+   activate('doc'); // default
+ }
```

### E) Explorer hydration entry (DOM side)
```diff
+ function wireExplorerHydration() {
+   const container = document.getElementById('explorer-content');
+   const statusEl  = document.getElementById('bridge-status');
+   if (!container) return console.warn('[ide_fullpage] explorer container missing');
+   // TODO: start your real hydration → consume bridge/endpoint events
+   // renderExplorer(container, initialTree);
+   statusEl?.setAttribute('data-state', 'installed');
+   if (statusEl) statusEl.textContent = 'Bridge: ready';
+ }
```

### F) Call all wiring from `initIDE` (single place)
```diff
- function initIDE(){ /* agent’s version */ }
+ function initIDE(){
+   wireAssistantToggle();
+   wireDrawer();
+   wireTabs();
+   wireExplorerHydration();
+   document.getElementById('ide-root')?.classList.add('doc-ready');
+   console.log('[ide_fullpage] init complete');
+ }
```

---

## 4) Optional CSS tweak in `ide_fullpage.css`
If you want **desktop** to reserve space (not overlay) when the assistant is expanded:
```css
/* Place outside media queries */
#ide-root:not(.assistant-collapsed) { padding-bottom: var(--chat-height); }
```
If overlay is intentional, skip this.

---

## 5) Sanity tests
1. **Script runs**: add `console.log('[ide_fullpage] loaded')` at top; confirm in DevTools.
2. **Assistant**: click the toggle → `assistant-collapsed` flips on `#ide-root`; panel slides.
3. **Drawer**: click ☰ → `drawer-open` toggles; backdrop closes it.
4. **Tabs**: Document/Full IDE → `#ide-frame-shell` moves between targets; `mode-document`/`mode-full` classes flip.
5. **Explorer**: hydration stub runs (status shows ready); real tree appears when bridge events/polling feed data.
```
