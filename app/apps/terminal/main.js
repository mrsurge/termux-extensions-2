// Terminal App frontend logic using xterm.js and WebSocket PTY streaming
// Exports default(contentEl, api, host)

export default function initTerminalApp(root, api, host) {
  const ui = {
    list: root.querySelector('#ta-shell-list'),
    listContainer: root.querySelector('#ta-list-container'),
    terminalContainer: root.querySelector('#ta-terminal-container'),
    drawerOverlay: root.querySelector('#ta-drawer-overlay'),
    btnMenu: root.querySelector('#ta-btn-menu'),
    btnNew: root.querySelector('#ta-btn-new'),
    btnRefresh: root.querySelector('#ta-btn-refresh'),
    btnStop: root.querySelector('#ta-btn-stop'),
    btnKill: root.querySelector('#ta-btn-kill'),
    btnRemove: root.querySelector('#ta-btn-remove'),
    zoomOut: root.querySelector('#ta-zoom-out'),
    zoomIn: root.querySelector('#ta-zoom-in'),
    title: root.querySelector('#ta-shell-title'),
    status: root.querySelector('#ta-shell-status'),
    termContainer: root.querySelector('#ta-term'),
    keyCtrl: root.querySelector('#k-ctrl'),
    keyTab: root.querySelector('#k-tab'),
    keyEsc: root.querySelector('#k-esc'),
    keyLeft: root.querySelector('#k-left'),
    keyUp: root.querySelector('#k-up'),
    keyDown: root.querySelector('#k-down'),
    keyRight: root.querySelector('#k-right'),
  };

  const state = {
    shells: [],
    activeId: null,
    ws: null,
    term: null,
    fitAddon: null,
    doFit: null,
    resizeObserver: null,
    mode: 'list',
    ctrlActive: false,
  };

  const INITIAL_TAIL = 2000; // lines to preload from persisted log on (re)select
  const FONT_SIZE_MIN = 10;
  const FONT_SIZE_MAX = 28;
  const FONT_SIZE_STEP = 1;
  const FONT_SIZE_STORAGE_KEY = 'te2_terminal_app_font_size';

  function getStoredFontSize() {
    try {
      const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    } catch (_) {}
    return 12;
  }

  function getCurrentFontSize() {
    try {
      const size = state.term?.options?.fontSize;
      if (typeof size === 'number' && Number.isFinite(size)) return size;
    } catch (_) {}
    return getStoredFontSize();
  }

  function applyFontSize(size) {
    if (!state.term) return;
    const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)));

    try {
      state.term.options.fontSize = clamped;
    } catch (err) {
      try {
        state.term.setOption?.('fontSize', clamped);
      } catch (_) {}
    }

    try { localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clamped)); } catch (_) {}

    if (ui.zoomOut) ui.zoomOut.title = `Zoom out (${clamped}px)`;
    if (ui.zoomIn) ui.zoomIn.title = `Zoom in (${clamped}px)`;

    if (state.doFit) {
      setTimeout(() => {
        try { state.doFit && state.doFit(); } catch (_) {}
      }, 0);
    }
  }

  function setMode(mode) {
    state.mode = mode;
    root.classList.remove('mode-list', 'mode-terminal', 'drawer-open');
    root.classList.add(mode === 'terminal' ? 'mode-terminal' : 'mode-list');
  }

  function openDrawer() {
    root.classList.add('drawer-open');
  }
  function closeDrawer() {
    root.classList.remove('drawer-open');
  }

  function shortId(id) {
    return String(id || '').slice(-8);
  }

  function findRec(id) {
    return state.shells.find(s => s.id === id) || null;
  }

  function sendSeq(seq) {
    if (!seq) return;
    const ws = state.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(seq);
    }
  }

  function refocusTerm() {
    try { state.term && state.term.focus(); } catch (_) {}
  }

  function softKey(handler) {
    return (ev) => {
      // On mobile, <button> taps can steal focus and collapse the virtual keyboard.
      // Prevent default + refocus xterm to keep the keyboard up.
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (_) {}
      try { handler(); } catch (_) {}
      refocusTerm();
    };
  }

  function toggleCtrl() {
    state.ctrlActive = !state.ctrlActive;
    if (ui.keyCtrl) ui.keyCtrl.classList.toggle('toggle', state.ctrlActive);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  function ensureXtermCSS() {
    const href = '/static/vendor/xterm/xterm.css';
    const existing = Array.from(document.styleSheets).some(s => s.href && s.href.endsWith('xterm.css'));
    if (!existing) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  }

  async function ensureXterm() {
    if (window.Terminal) return window.Terminal;
    ensureXtermCSS();
    await loadScript('/static/vendor/xterm/xterm.js');
    if (window.Terminal) return window.Terminal;
    throw new Error('Failed to load local xterm');
  }

  async function ensureFitAddon() {
    if (window.FitAddon) return window.FitAddon.FitAddon ? window.FitAddon.FitAddon : window.FitAddon;
    await loadScript('/static/vendor/xterm/addon-fit.js');
    if (window.FitAddon) return window.FitAddon.FitAddon ? window.FitAddon.FitAddon : window.FitAddon;
    throw new Error('Failed to load xterm fit addon');
  }

  function wsUrlFor(id) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws/app/terminal/terminal/${id}`;
  }

  function disposeSession() {
    try { state.ws && state.ws.close(); } catch (_) {}
    state.ws = null;
    try { state.term && state.term.dispose(); } catch (_) {}
    state.term = null;
    state.fitAddon = null;
    state.doFit = null;
    try { state.resizeObserver && state.resizeObserver.disconnect(); } catch (_) {}
    state.resizeObserver = null;
    ui.termContainer.innerHTML = '';
  }

  async function listShells() {
    const data = await api.get('shells');
    state.shells = data;
    renderShellList();
  }

  function formatUptime(seconds) {
    if (!seconds || seconds < 1) return 'new';
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60), mm = m % 60;
    return `${h}h ${mm}m`;
  }

  function renderShellList() {
    ui.list.innerHTML = '';
    if (!state.shells.length) {
      ui.list.innerHTML = '<div style="color:var(--muted-foreground);">No terminals yet.</div>';
      return;
    }
    state.shells.forEach((rec) => {
      const alive = !!(rec.stats && rec.stats.alive);
      const uptime = rec.stats && rec.stats.uptime ? formatUptime(rec.stats.uptime) : '';
      const shortId = String(rec.id || '').slice(-8);

      const el = document.createElement('div');
      el.className = 'ta-shell-item' + (state.activeId === rec.id ? ' active' : '');
      el.innerHTML = `
        <div class="ta-status-dot ${alive ? 'ta-dot-alive' : 'ta-dot-dead'}"></div>
        <div class="ta-shell-main">
          <div class="ta-shell-title">${rec.label || 'terminal'} · <span style="color:var(--muted-foreground);">${shortId}</span></div>
          <div class="ta-shell-meta">
            <span class="ta-badge">${rec.status || (alive ? 'running' : 'exited')}</span>
            ${rec.cwd ? `<span>${rec.cwd}</span>` : ''}
            ${uptime ? `<span>uptime ${uptime}</span>` : ''}
          </div>
        </div>
      `;
      el.addEventListener('click', () => {
        selectShell(rec.id);
        // update selection highlight immediately
        Array.from(ui.list.children).forEach(child => child.classList.remove('active'));
        el.classList.add('active');
      });
      ui.list.appendChild(el);
    });
  }

  async function selectShell(id) {
    state.activeId = id;
    const rec = findRec(id);
    ui.title.textContent = `${(rec && rec.label) ? rec.label : 'terminal'} · ${shortId(id)}`;
    ui.status.textContent = '';
    setMode('terminal');
    closeDrawer();
    disposeSession();

    // Create xterm
    const TerminalCtor = await ensureXterm();
    const term = new TerminalCtor({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: getStoredFontSize(),
      theme: { background: '#0b1020' }
    });
    term.open(ui.termContainer);
    term.focus();
    state.term = term;
    // If the user taps anywhere in the terminal container, always re-focus the terminal
    // (helps keep mobile keyboard open after interacting with other UI).
    if (ui.termContainer) {
      ui.termContainer.addEventListener('pointerdown', () => refocusTerm(), { passive: true });
    }

    // Load and apply fit addon
    try {
      const FitCtor = await ensureFitAddon();
      const fitAddon = new FitCtor();
      term.loadAddon(fitAddon);
      const doFit = () => { try { fitAddon.fit(); } catch (_) {} };
      state.fitAddon = fitAddon;
      state.doFit = doFit;
      doFit();
      window.addEventListener('resize', doFit);
      // re-fit after initial log priming and after drawer transitions
      setTimeout(doFit, 50);
      setTimeout(doFit, 250);

      // Fonts can load after xterm initializes (JetBrains Mono in particular).
      // If fit ran before font metrics were correct, xterm will compute too few cols,
      // leading to a "narrow" terminal with unused space on the right.
      try {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => { try { doFit(); } catch (_) {} });
        }
      } catch (_) {}

      // Also fit whenever the terminal container is resized (keyboard open, orientation change, etc).
      try {
        if (typeof ResizeObserver !== 'undefined' && ui.termContainer) {
          state.resizeObserver = new ResizeObserver(() => {
            try { doFit(); } catch (_) {}
          });
          state.resizeObserver.observe(ui.termContainer);
        }
      } catch (_) {}
    } catch (e) {
      console.warn('Fit addon unavailable:', e);
    }

    // Keep backend PTY size in sync with viewport changes and font changes.
    term.onResize(({ cols, rows }) => {
      api.post(`shells/${id}/resize`, { cols, rows }).catch(() => {});
    });

    // Seed zoom tooltips based on current/stored font size.
    applyFontSize(getCurrentFontSize());


    // Preload persisted log tail so history survives refresh/reopen
    try {
      const detail = await api.get(`shells/${id}?logs=true&tail=${INITIAL_TAIL}`);
      if (detail && detail.logs && Array.isArray(detail.logs.stdout_tail)) {
        const priming = detail.logs.stdout_tail.join('');
        if (priming) term.write(priming);
      }
    } catch (_) {}

    // Connect WebSocket
    const ws = new WebSocket(wsUrlFor(id));
    state.ws = ws;

    ws.onopen = () => {
      host.toast && host.toast('Connected');
    };
    ws.onclose = () => {
      host.toast && host.toast('Disconnected');
    };
    ws.onerror = () => {
      host.toast && host.toast('WebSocket error');
    };
    ws.onmessage = (evt) => {
      const data = typeof evt.data === 'string' ? evt.data : '';
      // Normalize newlines so prompts/output return to column 0.
      // (dtach/PTY streams sometimes contain bare LF without CR.)
      const normalized = data.replace(/\r?\n/g, '\r\n');
      term.write(normalized);
    };

    term.onData((data) => {
      let payload = data;
      if (state.ctrlActive && typeof data === 'string' && data.length === 1) {
        const ch = data;
        const code = ch.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) { // a-z
          payload = String.fromCharCode(code - 96); // Ctrl-A .. Ctrl-Z
          state.ctrlActive = false;
          if (ui.keyCtrl) ui.keyCtrl.classList.remove('toggle');
        }
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });

    // Send an initial resize based on fitted dimensions (if available).
    try {
      if (term?.cols && term?.rows) {
        await api.post(`shells/${id}/resize`, { cols: term.cols, rows: term.rows });
      }
    } catch (_) {}
  }

  async function doAction(action) {
    if (!state.activeId) return;
    try {
      await api.post(`shells/${state.activeId}/action`, { action });
      await listShells();
    } catch (e) {
      console.error(e);
      alert(`Action failed: ${e.message || e}`);
    }
  }

  async function removeShell() {
    if (!state.activeId) return;
    if (!confirm('Remove this shell? It will be killed if running.')) return;
    try {
      await api.delete(`shells/${state.activeId}`);
      disposeSession();
      state.activeId = null;
      ui.title.textContent = 'No shell selected';
      ui.status.textContent = '';
      await listShells();
    } catch (e) {
      console.error(e);
      alert(`Remove failed: ${e.message || e}`);
    }
  }

  // Wire up events
  ui.btnNew.addEventListener('click', async () => {
    try {
      const data = await api.post('shells', { cwd: '~' });
      await listShells();
      await selectShell(data.id);
      host.toast && host.toast('New terminal started');
    } catch (e) {
      console.error(e);
      alert(`Failed to start terminal: ${e.message || e}`);
    }
  });
  ui.btnRefresh.addEventListener('click', listShells);
  ui.btnStop.addEventListener('click', () => doAction('stop'));
  ui.btnKill.addEventListener('click', () => doAction('kill'));
  ui.btnRemove.addEventListener('click', removeShell);
  if (ui.btnMenu) ui.btnMenu.addEventListener('click', openDrawer);
  if (ui.drawerOverlay) ui.drawerOverlay.addEventListener('click', closeDrawer);

  // Zoom controls (use pointerdown to avoid stealing focus on mobile).
  if (ui.zoomOut) ui.zoomOut.addEventListener('pointerdown', softKey(() => applyFontSize(getCurrentFontSize() - FONT_SIZE_STEP)), { passive: false });
  if (ui.zoomIn) ui.zoomIn.addEventListener('pointerdown', softKey(() => applyFontSize(getCurrentFontSize() + FONT_SIZE_STEP)), { passive: false });

  // Soft-keys events
  // Use pointerdown (not click) to reduce focus churn on mobile browsers.
  if (ui.keyCtrl) ui.keyCtrl.addEventListener('pointerdown', softKey(toggleCtrl), { passive: false });
  if (ui.keyTab) ui.keyTab.addEventListener('pointerdown', softKey(() => sendSeq('\t')), { passive: false });
  if (ui.keyEsc) ui.keyEsc.addEventListener('pointerdown', softKey(() => sendSeq('\x1b')), { passive: false });
  if (ui.keyLeft) ui.keyLeft.addEventListener('pointerdown', softKey(() => sendSeq('\x1b[D')), { passive: false });
  if (ui.keyRight) ui.keyRight.addEventListener('pointerdown', softKey(() => sendSeq('\x1b[C')), { passive: false });
  if (ui.keyUp) ui.keyUp.addEventListener('pointerdown', softKey(() => sendSeq('\x1b[A')), { passive: false });
  if (ui.keyDown) ui.keyDown.addEventListener('pointerdown', softKey(() => sendSeq('\x1b[B')), { passive: false });

  // Initial load: show list view only
  setMode('list');
  listShells();
}
