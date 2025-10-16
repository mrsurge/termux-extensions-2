# CODE_OSS — Mobile UI Cleanup & Refactor Plan (Focused)

> Scope: **UI/UX only**. Implement the changes described in `CODE_OSS_APP_STATUS.md`, keep hydration intact, and make the **code‑server iframe invisible in Document view** so the bridge extension runs in the background. No security/compat topics.

---

## A) Edge‑to‑Edge Monaco (mobile)

**Files:** `app/apps/code_oss/static/css/ide_fullpage.css`, `app/apps/code_oss/static/js/ide_fullpage.js`, `app/apps/code_oss/templates/fullpage.html`

### 1) CSS — full‑bleed layout on narrow screens
```diff
/* ide_fullpage.css */
+ /* Mobile: Monaco fills available viewport under headers */
+ @media (max-width: 900px) {
+   #ide-root.mode-document {
+     --subheader-h: 48px;  /* adjust if your subheader is taller */
+     --footer-h: 0px;      /* toggled by assistant state in JS */
+   }
+
+   #ide-root.mode-document .ide-main {
+     padding: 0 !important;
+     margin: 0 !important;
+     border: 0 !important;
+     background: transparent !important;
+   }
+
+   /* Container that holds Monaco in Document view */
+   #ide-root.mode-document #document-view .doc-monaco-container {
+     position: relative;
+     inset: 0;
+     width: 100vw;
+     height: calc(100vh - var(--subheader-h) - var(--footer-h));
+     overflow: hidden; /* Monaco handles its own scroll */
+     border: 0 !important;
+     background: transparent !important;
+   }
+ }
```

### 2) JS — compute exact height (header/footer aware)
```diff
/* ide_fullpage.js */
+ function layoutDocumentView() {
+   const root = document.getElementById('ide-root');
+   if (!root || !root.classList.contains('mode-document')) return;
+   const sub = document.getElementById('ide-subheader'); // your subheader element id
+   const footer = document.getElementById('ide-footer'); // assistant footer (may be hidden)
+   const monacoWrap = document.querySelector('#document-view .doc-monaco-container');
+   if (!monacoWrap) return;
+   const subH = sub ? sub.getBoundingClientRect().height : 0;
+   const footerH = (footer && footer.offsetParent !== null) ? footer.getBoundingClientRect().height : 0;
+   root.style.setProperty('--subheader-h', `${Math.round(subH)}px`);
+   root.style.setProperty('--footer-h', `${Math.round(footerH)}px`);
+ }
+
+ ['resize', 'orientationchange'].forEach(ev => window.addEventListener(ev, layoutDocumentView));
+ document.addEventListener('DOMContentLoaded', layoutDocumentView, { once: true });
```

> Call `layoutDocumentView()` after any UI change that affects header/footer (see sections below).

---

## B) Make the code‑server iframe invisible in **Document** view (still running)

**Files:** `app/apps/code_oss/static/css/ide_fullpage.css`

```diff
/* ide_fullpage.css */
+ /* Keep iframe attached but invisible in Document mode */
+ #ide-root.mode-document #ide-frame {
+   position: absolute !important;
+   width: 0 !important;
+   height: 0 !important;
+   opacity: 0 !important;
+   pointer-events: none !important;
+   clip-path: inset(50%) !important;
+   border: 0 !important;
+ }
+ #ide-root.mode-document #ide-frame-shell {
+   position: absolute !important;
+   width: 0 !important;
+   height: 0 !important;
+   overflow: hidden !important;
+ }
```

> Do **not** use `display:none` on the iframe; keeping it attached avoids lazy‑init surprises and ensures the bridge loads.

---

## C) Collapsible Assistant Panel (stateful)

**Files:** `app/apps/code_oss/templates/fullpage.html`, `app/apps/code_oss/static/css/ide_fullpage.css`, `app/apps/code_oss/static/js/ide_fullpage.js`

### 1) HTML — footer with toggle
```diff
<!-- fullpage.html (within main layout) -->
+ <footer id="ide-footer" class="ide-footer">
+   <button id="btn-toggle-assistant" aria-expanded="true" class="btn-assistant">Assistant</button>
+ </footer>
```

### 2) CSS — slide panel fully off‑screen when collapsed
```diff
/* ide_fullpage.css */
+ .ide-footer { position: fixed; left: 0; right: 0; bottom: 0; height: 58px; z-index: 20; }
+ .ide-chat  { position: fixed; left: 0; right: 0; bottom: 58px; height: 260px; z-index: 15; transition: transform .18s ease; }
+ #ide-root.assistant-collapsed .ide-chat { transform: translateY(100%); }
+ #ide-root.assistant-collapsed .ide-footer { /* footer remains visible */ }
```

### 3) JS — toggle + persist to `window.teState`
```diff
/* ide_fullpage.js */
+ function getStateAPI(){ try { return window.teState || null; } catch { return null; } }
+
+ function restoreAssistantState(){
+   const st = getStateAPI();
+   const root = document.getElementById('ide-root');
+   const btn  = document.getElementById('btn-toggle-assistant');
+   if (!root || !btn) return;
+   const collapsed = !!(st && st.get && st.get('assistantCollapsed'));
+   root.classList.toggle('assistant-collapsed', collapsed);
+   btn.setAttribute('aria-expanded', String(!collapsed));
+   layoutDocumentView();
+ }
+
+ function wireAssistantToggle(){
+   const st = getStateAPI();
+   const root = document.getElementById('ide-root');
+   const btn  = document.getElementById('btn-toggle-assistant');
+   if (!root || !btn) return;
+   btn.addEventListener('click', () => {
+     const collapsed = root.classList.toggle('assistant-collapsed');
+     btn.setAttribute('aria-expanded', String(!collapsed));
+     if (st && st.set) st.set('assistantCollapsed', collapsed);
+     layoutDocumentView(); // footer height changed
+   });
+ }
+
+ document.addEventListener('DOMContentLoaded', restoreAssistantState, { once: true });
+ document.addEventListener('DOMContentLoaded', wireAssistantToggle, { once: true });
```

---

## D) Header Text — compact titles for mobile

**Files:** `app/apps/code_oss/static/js/ide_fullpage.js`

```diff
/* ide_fullpage.js */
+ function baseName(p){
+   if (!p) return '';
+   try { p = p.replace(/\\/g,'/'); } catch {}
+   const q = p.split('/').filter(Boolean);
+   return q[q.length-1] || p;
+ }
+
+ function updateSubtitle(projectPath, openFilePath){
+   const hTop = document.getElementById('ide-title');        // top header title (project)
+   const hSub = document.getElementById('ide-subtitle');     // sub-header (active file)
+   if (hTop) hTop.textContent = baseName(projectPath);
+   if (hSub) hSub.textContent = baseName(openFilePath);
+ }
+
+ // If you use a placeholder element where Monaco mounts, keep it short, too:
+ function updateDocPlaceholder(openFilePath){
+   const el = document.getElementById('doc-placeholder');
+   if (el) el.textContent = baseName(openFilePath) || 'Document';
+ }
```

> Call `updateSubtitle(projectPath, filePath)` whenever the active folder/file changes (e.g., after hydration events).

---

## E) Tabs — mode switch (Document ↔ Full IDE)

**Files:** `app/apps/code_oss/static/js/ide_fullpage.js`

```diff
/* ide_fullpage.js */
+ function setMode(which) {
+   const root = document.getElementById('ide-root');
+   const paneDoc  = document.getElementById('document-view');
+   const paneFull = document.getElementById('full-ide-view');
+   const docMode = (which === 'document');
+   root.classList.toggle('mode-document', docMode);
+   root.classList.toggle('mode-full', !docMode);
+   paneDoc?.classList.toggle('is-active', docMode);
+   paneFull?.classList.toggle('is-active', !docMode);
+   layoutDocumentView();
+ }
+
+ document.getElementById('tab-document')?.addEventListener('click', () => setMode('document'));
+ document.getElementById('tab-full')?.addEventListener('click', () => setMode('full'));
+ document.addEventListener('DOMContentLoaded', () => setMode('document'), { once:true });
```

---

## F) Hydration sanity (unchanged logic, quick validation)

**Elements required:**
- `#explorer-content` (drawer list container)
- `#bridge-status` (text/state: checking → installed/ready)
- `#ide-frame` & `#ide-frame-shell` (keep attached; iframe is invisible in Document mode only)

**Quick test:**
1. Load page → status shows **checking** then **ready**; drawer populates when opened.
2. Default is **Document** mode → Monaco occupies full width/height (no borders).
3. Toggle Assistant → panel slides fully off; state persists on reload.
4. Switch to **Full IDE** → iframe visible; switch back → iframe invisible.

---

## G) (For later) Bi‑Directional Sync hooks (names only; implement separately)

- Listen for incoming `doc_changes` (bridge → Monaco mirror) and apply to model.
- Listen to Monaco model edits and POST them to a framework endpoint that pipes into the code‑server buffer.
- Use version counters to resync on skew. *(All transport/logic is out of scope for this UI pass.)*
