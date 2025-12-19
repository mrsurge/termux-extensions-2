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
    wsReconnectTimer: null,
    wsReconnectAttempts: 0,
    wsDesiredId: null,
    term: null,
    fitAddon: null,
    doFit: null,
    fitRaf: null,
    fitFramesRemaining: 0,
    resizeSyncTimer: null,
    lastResizeSent: null,
    resizeObserver: null,
    mode: 'list',
    ctrlActive: false,
  };

  const INITIAL_TAIL = 2000; // lines to preload from persisted log on (re)select
  const FONT_SIZE_MIN = 10;
  const FONT_SIZE_MAX = 28;
  const FONT_SIZE_STEP = 1;
  const FONT_SIZE_STORAGE_KEY = 'te2_terminal_app_font_size';

  function requestFit(frames = 8) {
    if (!state.term || !state.fitAddon || !state.doFit) return;
    state.fitFramesRemaining = Math.max(state.fitFramesRemaining, Math.max(1, Number(frames) || 1));
    if (state.fitRaf) return;

    const step = () => {
      state.fitRaf = null;
      if (!state.term || !state.fitAddon || !state.doFit) return;
      try { state.doFit(); } catch (_) {}
      state.fitFramesRemaining = Math.max(0, state.fitFramesRemaining - 1);
      if (state.fitFramesRemaining > 0) {
        state.fitRaf = requestAnimationFrame(step);
      }
    };

    state.fitRaf = requestAnimationFrame(step);
  }

  async function ensureFontLoaded(fontFamily, timeoutMs = 900) {
    const fam = String(fontFamily || '').trim();
    if (!fam) return;
    if (!document.fonts || typeof document.fonts.load !== 'function') return;

    try {
      await Promise.race([
        document.fonts.load(`12px "${fam}"`),
        new Promise(resolve => setTimeout(resolve, Math.max(0, Number(timeoutMs) || 0))),
      ]);
    } catch (_) {}
  }

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

    requestFit(6);
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

  function clearWsReconnectTimer() {
    if (!state.wsReconnectTimer) return;
    try { clearTimeout(state.wsReconnectTimer); } catch (_) {}
    state.wsReconnectTimer = null;
  }

  function getWsBackoffDelayMs(attempt) {
    const n = Math.max(1, Number(attempt) || 1);
    const base = 450;
    const max = 5000;
    const delay = Math.min(max, Math.round(base * Math.pow(1.45, n - 1)));
    return Math.max(150, delay);
  }

  function scheduleWsReconnect(reason) {
    if (!state.wsDesiredId) return;
    if (state.activeId !== state.wsDesiredId) return;
    if (document.hidden) return; // try again on visibilitychange
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    if (state.wsReconnectTimer) return;

    state.wsReconnectAttempts = Math.max(0, Number(state.wsReconnectAttempts) || 0) + 1;
    const delay = getWsBackoffDelayMs(state.wsReconnectAttempts);

    ui.status.textContent = `reconnecting… (${delay}ms)`;
    state.wsReconnectTimer = setTimeout(() => {
      state.wsReconnectTimer = null;
      if (!state.wsDesiredId || state.activeId !== state.wsDesiredId) return;
      if (document.hidden) return;
      connectWs(state.wsDesiredId);
    }, delay);
  }

  function connectWs(id) {
    const desired = String(id || '').trim();
    if (!desired) return;

    clearWsReconnectTimer();

    const existing = state.ws;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try { existing && existing.close(); } catch (_) {}
    state.ws = null;

    const ws = new WebSocket(wsUrlFor(desired));
    state.ws = ws;

    ws.onopen = () => {
      state.wsReconnectAttempts = 0;
      ui.status.textContent = 'connected';
      host.toast && host.toast('Connected');
      requestFit(6);
      // Ensure the PTY has a winsize after the dtach attach proxy is live.
      try {
        if (state.term?.cols && state.term?.rows) {
          scheduleResizeSync(desired, state.term.cols, state.term.rows, { force: true });
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      if (state.ws === ws) state.ws = null;
      ui.status.textContent = 'disconnected';
      host.toast && host.toast('Disconnected');
      scheduleWsReconnect('close');
    };

    ws.onerror = () => {
      ui.status.textContent = 'socket error';
      host.toast && host.toast('WebSocket error');
    };

    ws.onmessage = (evt) => {
      const data = typeof evt.data === 'string' ? evt.data : '';
      // Let xterm handle CR/LF semantics (convertEol handles bare LF as CRLF).
      state.term && state.term.write(data);
    };
  }

  function disposeSession() {
    state.wsDesiredId = null;
    clearWsReconnectTimer();
    if (state.resizeSyncTimer) {
      try { clearTimeout(state.resizeSyncTimer); } catch (_) {}
      state.resizeSyncTimer = null;
    }
    state.lastResizeSent = null;
    try { state.ws && state.ws.close(); } catch (_) {}
    state.ws = null;
    try { state.term && state.term.dispose(); } catch (_) {}
    state.term = null;
    state.fitAddon = null;
    state.doFit = null;
    if (state.fitRaf) {
      try { cancelAnimationFrame(state.fitRaf); } catch (_) {}
      state.fitRaf = null;
    }
    state.fitFramesRemaining = 0;
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

  function installGlobalViewportHandlers() {
    if (installGlobalViewportHandlers._installed) return;
    installGlobalViewportHandlers._installed = true;

    window.addEventListener('resize', () => requestFit(8), { passive: true });

    // Mobile keyboards/orientation changes often resize the visual viewport without firing a full window resize.
    try {
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => requestFit(10), { passive: true });
        window.visualViewport.addEventListener('scroll', () => requestFit(4), { passive: true });
      }
    } catch (_) {}

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      requestFit(10);
      if (state.wsDesiredId && !state.ws) {
        connectWs(state.wsDesiredId);
      } else if (state.wsDesiredId && state.ws && state.ws.readyState === WebSocket.CLOSED) {
        connectWs(state.wsDesiredId);
      }
    });

    window.addEventListener('online', () => {
      if (!state.wsDesiredId) return;
      connectWs(state.wsDesiredId);
    }, { passive: true });
  }

  async function selectShell(id) {
    state.activeId = id;
    const rec = findRec(id);
    ui.title.textContent = `${(rec && rec.label) ? rec.label : 'terminal'} · ${shortId(id)}`;
    ui.status.textContent = '';
    setMode('terminal');
    closeDrawer();
    disposeSession();

    installGlobalViewportHandlers();

    // Ensure the mono font is available before xterm measures cell size.
    await ensureFontLoaded('JetBrains Mono', 900);

    // Create xterm
    const TerminalCtor = await ensureXterm();
    const term = new TerminalCtor({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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

    function scheduleResizeSync(shellId, cols, rows, opts = {}) {
      if (!shellId) return;
      const c = Math.max(1, Number(cols) || 0);
      const r = Math.max(1, Number(rows) || 0);
      if (!c || !r) return;

      const key = `${shellId}:${c}x${r}`;
      if (!opts.force && state.lastResizeSent === key) return;
      state.lastResizeSent = key;

      if (state.resizeSyncTimer) {
        try { clearTimeout(state.resizeSyncTimer); } catch (_) {}
        state.resizeSyncTimer = null;
      }

      let attempts = 0;
      const tryOnce = async () => {
        attempts += 1;
        try {
          await api.post(`shells/${shellId}/resize`, { cols: c, rows: r });
          return;
        } catch (_) {
          if (attempts >= 12) return;
          // If the dtach attach proxy isn't ready yet, retries usually succeed shortly after.
          const delay = Math.min(1500, 80 * attempts);
          state.resizeSyncTimer = setTimeout(tryOnce, delay);
        }
      };

      void tryOnce();
    }

    // Keep backend PTY size in sync with viewport changes and font changes.
    term.onResize(({ cols, rows }) => {
      scheduleResizeSync(id, cols, rows);
    });

    // Load and apply fit addon
    try {
      const FitCtor = await ensureFitAddon();
      const fitAddon = new FitCtor();
      term.loadAddon(fitAddon);
      const doFit = () => { try { fitAddon.fit(); } catch (_) {} };
      state.fitAddon = fitAddon;
      state.doFit = doFit;
      requestFit(18);

      // Also fit whenever the terminal container is resized (keyboard open, orientation change, etc).
      try {
        if (typeof ResizeObserver !== 'undefined' && ui.termContainer) {
          state.resizeObserver = new ResizeObserver(() => {
            requestFit(8);
          });
          state.resizeObserver.observe(ui.termContainer);
        }
      } catch (_) {}
    } catch (e) {
      console.warn('Fit addon unavailable:', e);
    }

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

    // Connect WebSocket (auto-reconnect when mobile switches apps)
    state.wsDesiredId = id;
    connectWs(id);

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
      const ws = state.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });

    // Send an initial resize based on fitted dimensions (if available).
    try {
      if (term?.cols && term?.rows) {
        scheduleResizeSync(id, term.cols, term.rows, { force: true });
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
