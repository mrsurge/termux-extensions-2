// app/apps/file_editor_cm6/static/js/terminal.js

/**
 * Terminal drawer for the code editor.
 * Embeds xterm.js with WebSocket PTY streaming.
 * 
 * Lifecycle:
 *   - Drawer close: Terminal stays alive, just hidden
 *   - X button click: Destroys the terminal shell permanently
 *   - Drawer reopen: Reconnects to existing shell or creates new one
 */

export function createTerminalDrawer(options = {}) {
  const {
    onReady = () => {},
    getCurrentProjectPath = () => null,
  } = options;

  let term = null;
  let ws = null;
  let shellId = null;
  let fitAddon = null;
  let isOpen = false;
  let isFullscreen = false;
  let lastShellId = null;
  let shellHistoryPrimed = false;
  let desiredShellId = 'auto';
  let socketRegistered = false;
  let pendingInput = [];
  let pendingOutput = [];
  let lastResizeSent = null;
  let fitRaf = null;
  let fitFramesRemaining = 0;
  let viewportHandlersInstalled = false;
  let resizeObserver = null;
  let startupSizing = false;
  let startupFitTimer = null;

  const drawer = document.getElementById('terminal-drawer');
  const container = document.getElementById('terminal-container');
  const header = drawer?.querySelector('.terminal-header');
  const shellToggle = drawer?.querySelector('#terminal-shell-toggle');
  const shellMenu = drawer?.querySelector('#terminal-shell-menu');
  const toggleBtn = document.getElementById('terminal-toggle');
  const collapseBtn = document.getElementById('terminal-collapse');
  const fullscreenBtn = document.getElementById('terminal-fullscreen');
  const newBtn = document.getElementById('terminal-new');
  const zoomOutBtn = document.getElementById('terminal-zoom-out');
  const zoomInBtn = document.getElementById('terminal-zoom-in');
  const copyBtn = document.getElementById('terminal-copy');

  let shellMenuOpen = false;
  let touchHandlersInstalled = false;

  const FONT_SIZE_MIN = 10;
  const FONT_SIZE_MAX = 28;
  const FONT_SIZE_STEP = 1;
  const HELPER_BASE_URL = '/apps/file_editor_cm6/vendor/android-terminalapp-assets-js';
  let vendoredCtrlTerm = null;

  function formatShellLabel(id) {
    if (!id) return 'Terminal';
    return `Terminal ${String(id).slice(-4)}`;
  }

  function formatShellDisplayLabel(shell) {
    if (!shell) return 'Terminal';
    if (shell.display_label) return String(shell.display_label);
    if (shell.title) return `${String(shell.title).trim()}/${String(shell.id || '').slice(-4)}`;
    if (shell.id) return `Terminal/${String(shell.id).slice(-4)}`;
    return 'Terminal';
  }

  function isShellExited(shell) {
    const status = String(shell?.status || '').trim().toLowerCase();
    return !!(status && status !== 'live');
  }

  function setShellToggleShell(activeShell, activeIdFallback) {
    if (!shellToggle) return;
    if (activeShell) {
      shellToggle.textContent = formatShellDisplayLabel(activeShell);
      shellToggle.classList.toggle('terminal-shell-toggle-exited', isShellExited(activeShell));
      return;
    }
    if (activeIdFallback) {
      shellToggle.textContent = `Terminal/${String(activeIdFallback).slice(-4)}`;
      shellToggle.classList.remove('terminal-shell-toggle-exited');
      return;
    }
    shellToggle.textContent = 'Terminal';
    shellToggle.classList.remove('terminal-shell-toggle-exited');
  }

  function getCurrentFontSize() {
    try {
      const size = term?.options?.fontSize;
      if (typeof size === 'number' && Number.isFinite(size)) return size;
    } catch (_) {}
    return 14;
  }

  function applyFontSize(size) {
    if (!term) return;
    const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)));
    try {
      term.options.fontSize = clamped;
    } catch (err) {
      try {
        term.setOption?.('fontSize', clamped);
      } catch (_) {}
    }

    if (zoomOutBtn) zoomOutBtn.title = `Zoom out (${clamped}px)`;
    if (zoomInBtn) zoomInBtn.title = `Zoom in (${clamped}px)`;

    requestFit(6);
  }

  function getTerminalCols() {
    return Math.max(1, Number(term?.cols) || 0);
  }

  function getTerminalRows() {
    return Math.max(1, Number(term?.rows) || 0);
  }

  function syncTerminalSize(force = false) {
    if (!hasBoundShell() || !term) return;
    if (startupSizing && !force) return;
    const cols = getTerminalCols();
    const rows = getTerminalRows();
    if (!cols || !rows) return;
    const key = `${shellId}:${cols}x${rows}`;
    if (!force && lastResizeSent === key) return;
    lastResizeSent = key;
    ws.emit('terminal:resize', { cols, rows });
  }

  function requestFit(frames = 8) {
    if (!term || !fitAddon || !isOpen || startupSizing) return;
    fitFramesRemaining = Math.max(fitFramesRemaining, Math.max(1, Number(frames) || 1));
    if (fitRaf !== null) return;

    const step = () => {
      fitRaf = null;
      if (!term || !fitAddon || !isOpen) return;
      try {
        fitAddon.fit();
      } catch (_) {
        return;
      }
      syncTerminalSize();
      fitFramesRemaining = Math.max(0, fitFramesRemaining - 1);
      if (fitFramesRemaining > 0) {
        fitRaf = requestAnimationFrame(step);
      }
    };

    fitRaf = requestAnimationFrame(step);
  }

  function installViewportHandlers() {
    if (viewportHandlersInstalled) return;
    viewportHandlersInstalled = true;
    window.addEventListener('resize', () => requestFit(8), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => requestFit(10), { passive: true });
      window.visualViewport.addEventListener('scroll', () => requestFit(4), { passive: true });
    }
  }

  function clearStartupFitTimer() {
    if (startupFitTimer !== null) {
      clearTimeout(startupFitTimer);
      startupFitTimer = null;
    }
  }

  function getDrawerHeightTransitionMs() {
    if (!drawer || typeof window.getComputedStyle !== 'function') return 0;
    try {
      const style = window.getComputedStyle(drawer);
      const props = String(style.transitionProperty || '').split(',').map((part) => part.trim());
      const durations = String(style.transitionDuration || '').split(',').map((part) => part.trim());
      const delays = String(style.transitionDelay || '').split(',').map((part) => part.trim());

      const parseMs = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return 0;
        if (raw.endsWith('ms')) return Number.parseFloat(raw.slice(0, -2)) || 0;
        if (raw.endsWith('s')) return (Number.parseFloat(raw.slice(0, -1)) || 0) * 1000;
        return Number.parseFloat(raw) || 0;
      };

      let maxMs = 0;
      const count = Math.max(props.length, durations.length, delays.length);
      for (let index = 0; index < count; index += 1) {
        const prop = props[index] ?? props[props.length - 1] ?? '';
        if (prop && prop !== 'all' && prop !== 'height') continue;
        const durationMs = parseMs(durations[index] ?? durations[durations.length - 1] ?? 0);
        const delayMs = parseMs(delays[index] ?? delays[delays.length - 1] ?? 0);
        maxMs = Math.max(maxMs, durationMs + delayMs);
      }
      return Math.max(0, Math.round(maxMs));
    } catch (_) {
      return 0;
    }
  }

  function scheduleStartupResizeSync(reason = 'open') {
    if (!term || !fitAddon || !isOpen) return;
    startupSizing = true;
    clearStartupFitTimer();

    const settleMs = getDrawerHeightTransitionMs();
    const waitMs = Math.max(0, settleMs + 34);

    startupFitTimer = setTimeout(() => {
      startupFitTimer = null;
      if (!term || !fitAddon || !isOpen) {
        startupSizing = false;
        return;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!term || !fitAddon || !isOpen) {
            startupSizing = false;
            return;
          }
          try {
            fitAddon.fit();
          } catch (_) {
            startupSizing = false;
            return;
          }
          lastResizeSent = null;
          startupSizing = false;
          syncTerminalSize(true);
          console.log(`Terminal startup resize synced after ${reason}`);
        });
      });
    }, waitMs);
  }

  function flushPendingOutput() {
    if (!term || !pendingOutput.length) return;
    const chunk = pendingOutput.join('');
    pendingOutput = [];
    if (chunk) {
      term.write(chunk);
    }
  }

  function trimPrimedOverlap(historyText, liveText) {
    const history = typeof historyText === 'string' ? historyText : '';
    const live = typeof liveText === 'string' ? liveText : '';
    if (!history || !live) return live;

    const maxOverlap = Math.min(history.length, live.length, 8192);
    for (let len = maxOverlap; len > 0; len -= 1) {
      if (history.slice(-len) === live.slice(0, len)) {
        return live.slice(len);
      }
    }
    return live;
  }

  function updateCopyButtonState() {
    if (!copyBtn) return;
    let hasSelection = false;
    try { hasSelection = !!(term && term.hasSelection && term.hasSelection()); } catch (_) {}
    copyBtn.disabled = !hasSelection;
  }

  async function copySelection() {
    if (!term) return;
    let text = '';
    try { text = term.getSelection?.() || ''; } catch (_) {}
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      updateCopyButtonState();
      if (copyBtn) {
        const original = copyBtn.title;
        copyBtn.title = 'Copied';
        setTimeout(() => { copyBtn.title = original || 'Copy selection'; }, 700);
      }
    } catch (err) {
      console.warn('Failed to copy selection:', err);
    }
  }

  async function fetchShellList() {
    try {
      const res = await fetch('/api/app/file_editor_cm6/terminal/shells', { cache: 'no-store' });
      const json = await res.json();
      if (json && json.ok && json.data) return json.data;
    } catch (err) {
      console.warn('Failed to fetch terminal shells:', err);
    }
    return { active_shell_id: null, shells: [] };
  }

  function setShellMenuOpen(open) {
    shellMenuOpen = !!open;
    if (shellMenu) {
      shellMenu.classList.toggle('open', shellMenuOpen);
    }
    if (shellToggle) {
      shellToggle.setAttribute('aria-expanded', shellMenuOpen ? 'true' : 'false');
    }
  }

  function renderShellMenu(shells, activeId) {
    if (!shellMenu) return;
    shellMenu.innerHTML = '';

    (shells || []).forEach((s) => {
      const row = document.createElement('div');
      row.className = 'terminal-shell-item' + (s.id === activeId ? ' active' : '');
      row.dataset.id = s.id;
      row.classList.toggle('terminal-shell-item-exited', isShellExited(s));

      const label = document.createElement('span');
      label.className = 'terminal-shell-item-label';
      label.textContent = formatShellDisplayLabel(s);

      const edit = document.createElement('button');
      edit.className = 'terminal-shell-item-edit';
      edit.type = 'button';
      edit.dataset.id = s.id;
      edit.textContent = '✏️';
      edit.title = 'Set terminal title';

      const close = document.createElement('button');
      close.className = 'terminal-shell-item-close';
      close.type = 'button';
      close.dataset.id = s.id;
      close.textContent = '✕';
      close.title = 'Close terminal';

      row.appendChild(edit);
      row.appendChild(label);
      row.appendChild(close);

      // Activate on label/row click (ignore close button clicks).
      row.addEventListener('click', async (ev) => {
        if (ev.target === close) return;
        try {
          await fetch(`/api/app/file_editor_cm6/terminal/shells/${encodeURIComponent(s.id)}/activate`, { method: 'POST' });
        } catch (err) {
          console.warn('Failed to activate terminal shell:', err);
        } finally {
          setShellMenuOpen(false);
        }
      });

      close.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const closingActive = s.id === activeId;
        try {
          await fetch(`/api/app/file_editor_cm6/terminal/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
        } catch (err) {
          console.warn('Failed to close terminal shell:', err);
        } finally {
          // If there are still live shells, keep the drawer open and ensure
          // backend "active" points to a live shell so reconnect doesn't spawn
          // a new one. If no live shells remain, close the drawer and prevent
          // auto-reconnect from creating a new shell.
          const data = await fetchShellList();
          const shells = data?.shells || [];
          const liveShells = shells.filter((sh) => !isShellExited(sh));

          if (liveShells.length === 0) {
            try {
              closeAndDisconnect();
            } catch (_) {}
            return;
          }

          const backendActive = data?.active_shell_id || null;
          const backendActiveIsLive = !!(backendActive && liveShells.some((sh) => sh.id === backendActive));
          const nextLiveId = backendActiveIsLive ? backendActive : (liveShells[0]?.id || null);

          if (nextLiveId && (closingActive || !backendActiveIsLive)) {
            try {
              await fetch(`/api/app/file_editor_cm6/terminal/shells/${encodeURIComponent(nextLiveId)}/activate`, { method: 'POST' });
            } catch (err) {
              console.warn('Failed to activate fallback terminal shell:', err);
            }
          }

          await refreshShellMenu();
        }
      });

      edit.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const current = (s.title || '').trim();
        const next = prompt('Terminal title (max 16 chars). Leave blank to clear.', current);
        if (next === null) return;
        const trimmed = String(next).trim();
        if (trimmed && trimmed.length > 16) {
          alert('Title must be 16 characters or less.');
          return;
        }
        try {
          await fetch(`/api/app/file_editor_cm6/terminal/shells/${encodeURIComponent(s.id)}/title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: trimmed }),
          });
        } catch (err) {
          console.warn('Failed to set terminal title:', err);
        } finally {
          await refreshShellMenu();
        }
      });

      shellMenu.appendChild(row);
    });
  }

  async function refreshShellMenu() {
    const data = await fetchShellList();
    const activeId = data.active_shell_id || shellId;
    renderShellMenu(data.shells, activeId);
    const activeShell = (data.shells || []).find((s) => s.id === activeId);
    setShellToggleShell(activeShell || null, activeId);
  }

  if (shellToggle) {
    shellToggle.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const nextOpen = !shellMenuOpen;
      if (nextOpen) {
        try { await refreshShellMenu(); } catch (_) {}
      }
      setShellMenuOpen(nextOpen);
    });
  }

  // Close menu on outside clicks.
  document.addEventListener('click', (ev) => {
    if (!shellMenuOpen) return;
    if (header && header.contains(ev.target)) return;
    setShellMenuOpen(false);
  });

  function closeAndDisconnect() {
    // Close UI (do NOT destroy shells). Used for project hot-switches.
    try {
      close();
    } catch (_) {}

    setShellMenuOpen(false);

    // Drop the socket so a future open() establishes a fresh bind.
    if (ws) {
      try { ws.disconnect(); } catch (_) {}
      ws = null;
    }

    // Force fresh history priming on next shell_id message.
    shellId = null;
    lastShellId = null;
    shellHistoryPrimed = false;
    desiredShellId = 'auto';
    socketRegistered = false;
    pendingInput = [];

    if (shellToggle) {
      shellToggle.textContent = 'Terminal';
    }
  }

  /**
   * Load xterm.js dynamically
   */
  async function loadXterm() {
    if (window.Terminal) {
      return window.Terminal;
    }

    await Promise.all([
      loadScript('/static/vendor/xterm/xterm.js'),
      loadStylesheet('/static/vendor/xterm/xterm.css'),
    ]);

    // Load FitAddon after Terminal is loaded
    await loadScript('/static/vendor/xterm/addon-fit.js');

    return window.Terminal;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadHelperScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = (event) => {
        script.remove();
        reject(event);
      };
      document.head.appendChild(script);
    });
  }

  function helperUrl(name, fresh = false) {
    const url = `${HELPER_BASE_URL}/${name}`;
    if (!fresh) return url;
    return `${url}?ts=${Date.now()}`;
  }

  function getRuntimeWindow() {
    return window;
  }

  async function ensureDrawerTouchToMouseHelper() {
    const runtimeWindow = getRuntimeWindow();
    if (runtimeWindow.__fileEditorCm6DrawerTouchToMouseLoaded) return;
    runtimeWindow.__fileEditorCm6TerminalHelpersActive = false;
    await loadHelperScript(helperUrl('touch_to_mouse_handler.js'));
    runtimeWindow.__fileEditorCm6DrawerTouchToMouseLoaded = true;
  }

  function sendTerminalInput(data) {
    if (hasBoundShell()) {
      ws.emit('terminal:input', { data });
    } else if (socketConnected()) {
      pendingInput.push(data);
      if (pendingInput.length > 64) {
        pendingInput = pendingInput.slice(-64);
      }
    }
  }

  async function bindDrawerVendoredCtrlHandler(currentTerm) {
    if (!currentTerm) return;
    const runtimeWindow = getRuntimeWindow();
    currentTerm.input = sendTerminalInput;
    runtimeWindow.term = currentTerm;
    runtimeWindow.ctrl = !!runtimeWindow.ctrl;
    if (vendoredCtrlTerm === currentTerm) return;
    vendoredCtrlTerm = currentTerm;
    await loadHelperScript(helperUrl('ctrl_key_handler.js', true));
  }

  function setDrawerHelperFocusActive(active) {
    const runtimeWindow = getRuntimeWindow();
    runtimeWindow.__fileEditorCm6TerminalHelpersActive = !!active;
    if (active && term) {
      runtimeWindow.term = term;
      void bindDrawerVendoredCtrlHandler(term).catch((err) => {
        console.warn('Failed to bind vendored ctrl helper:', err);
      });
    }
  }

  function loadStylesheet(href) {
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      document.head.appendChild(link);
    });
  }

  async function ensureSocketIoClient() {
    if (window.io) return window.io;
    await loadScript('/static/vendor/socket.io.min.js');
    if (window.io) return window.io;
    throw new Error('Failed to load Socket.IO client');
  }

  /**
   * Get or create terminal shell - backend handles everything.
   * Just connect to the WebSocket and let the server manage persistence.
   */
  async function getOrCreateShell() {
    // Don't set shellId yet - wait for WebSocket to tell us the real ID
    // Return null so caller knows to use 'auto' for WebSocket URL
    return null;
  }

  /**
   * Destroy the terminal shell permanently
   */
  async function destroyShell() {
    if (!shellId) return;

    const currentShellId = shellId;
    shellId = null;
    lastShellId = null;
    shellHistoryPrimed = false;
    desiredShellId = null;
    socketRegistered = false;
    pendingInput = [];

    try {
      await fetch(`/api/app/file_editor_cm6/terminal/${encodeURIComponent(currentShellId)}`, {
        method: 'DELETE',
      });
      console.log('Destroyed shell:', currentShellId);
    } catch (err) {
      console.error('Failed to destroy terminal shell:', err);
    }
  }

  function socketConnected() {
    return !!(ws && ws.connected);
  }

  function hasBoundShell() {
    return !!(socketConnected() && shellId && desiredShellId && shellId === desiredShellId);
  }

  function flushPendingInput() {
    if (!hasBoundShell() || !pendingInput.length) return;
    const queued = pendingInput;
    pendingInput = [];
    queued.forEach((data) => {
      if (typeof data === 'string' && data) {
        ws.emit('terminal:input', { data });
      }
    });
  }

  function emitTerminalRegister(requestedShellId = 'auto') {
    desiredShellId = String(requestedShellId || 'auto').trim() || 'auto';
    if (!socketConnected()) {
      socketRegistered = false;
      return;
    }
    ws.emit('terminal:register', {
      shellId: desiredShellId,
      client_id: 'terminal-drawer',
    });
    socketRegistered = false;
  }

  async function ensureTerminalSocket() {
    if (ws) {
      if (ws.connected) return ws;
      try { ws.connect(); } catch (_) {}
      return ws;
    }

    const io = await ensureSocketIoClient();
    const socket = io('/terminal', {
      path: '/terminal_ws/socket.io',
      transports: ['websocket'],
      query: {
        app_id: 'file_editor_cm6',
        source: 'terminal_drawer',
      },
    });

    socket.on('connect', () => {
      console.log('Terminal Socket.IO connected');
      socketRegistered = false;
      if (desiredShellId) {
        emitTerminalRegister(desiredShellId);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('Terminal Socket.IO disconnected', reason);
      socketRegistered = false;
      pendingInput = [];
    });

    socket.on('terminal:shell_id', async (msg) => {
      const receivedShellId = msg?.shell_id;
      if (!receivedShellId) return;
      const isNewShell = receivedShellId !== lastShellId;
      shellId = receivedShellId;
      desiredShellId = receivedShellId;
      socketRegistered = true;
      lastResizeSent = null;
      console.log('Received shell ID from server:', shellId);

      if (isNewShell) {
        try {
          term?.reset();
        } catch (_) {
          try { term?.clear(); } catch (_) {}
        }
        shellHistoryPrimed = false;
        pendingOutput = [];
      }
      lastShellId = receivedShellId;

      try {
        await refreshShellMenu();
      } catch (_) {}

      if (term && !shellHistoryPrimed) {
        let primed = false;
        try {
          let priming = '';
          const res = await fetch(`/api/app/file_editor_cm6/terminal/${shellId}/history?tail=2000`);
          const result = await res.json();
          if (result.ok && typeof result.data?.stdout_text === 'string') {
            priming = result.data.stdout_text;
            if (priming) {
              term.write(priming);
              console.log('Preloaded terminal history');
            }
          }
          if (pendingOutput.length) {
            const liveChunk = pendingOutput.join('');
            const deduped = trimPrimedOverlap(priming, liveChunk);
            pendingOutput = deduped ? [deduped] : [];
          }
          primed = true;
        } catch (err) {
          console.warn('Failed to preload terminal history:', err);
        }

        if (primed) {
          shellHistoryPrimed = true;
          flushPendingOutput();
          flushPendingInput();
          scheduleStartupResizeSync('history-prime');
        }
      }

      if (shellHistoryPrimed) {
        flushPendingOutput();
        flushPendingInput();
        scheduleStartupResizeSync('shell-bind');
      }
    });

    socket.on('terminal:shell_list', (msg) => {
      try {
        renderShellMenu(msg?.shells || [], msg?.active_shell_id || shellId);
        const activeShellId = msg?.active_shell_id || shellId;
        const activeShell = (msg?.shells || []).find((s) => s.id === activeShellId);
        setShellToggleShell(activeShell || null, activeShellId);
      } catch (_) {}
    });

    socket.on('terminal:output', (msg) => {
      if (!term) return;
      const data = typeof msg?.data === 'string' ? msg.data : '';
      if (data) {
        if (!shellHistoryPrimed) {
          pendingOutput.push(data);
          if (pendingOutput.length > 256) {
            pendingOutput = pendingOutput.slice(-256);
          }
          return;
        }
        term.write(data);
      }
    });

    socket.on('terminal:closed', async (msg) => {
      console.warn('Terminal closed:', msg);
      if (msg?.shell_id && msg.shell_id === shellId) {
        shellId = null;
        shellHistoryPrimed = false;
        desiredShellId = null;
        socketRegistered = false;
        lastResizeSent = null;
        pendingInput = [];
        pendingOutput = [];
      } else if (!msg?.shell_id) {
        socketRegistered = false;
        pendingInput = [];
      }
      try {
        await refreshShellMenu();
      } catch (_) {}
    });

    socket.on('terminal:rebind_required', () => {
      shellId = null;
      shellHistoryPrimed = false;
      socketRegistered = false;
      lastResizeSent = null;
      pendingInput = [];
      pendingOutput = [];
      emitTerminalRegister('auto');
    });

    socket.on('terminal:error', (msg) => {
      console.error('Terminal error:', msg?.message || msg);
    });

    ws = socket;
    return socket;
  }

  /**
   * Initialize xterm.js instance
   */
  async function initTerminal() {
    const Terminal = await loadXterm();

    // FitAddon might be nested in exports object or directly on window
    const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;
    if (!FitAddon) {
      console.error('Available on window:', Object.keys(window).filter(k => k.includes('Fit')));
      throw new Error('FitAddon not loaded');
    }

    term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: '#0b0f1a',
        foreground: '#e5e7eb',
      },
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    installViewportHandlers();
    await ensureDrawerTouchToMouseHelper();
    await bindDrawerVendoredCtrlHandler(term);

    container.addEventListener('pointerdown', () => {
      setDrawerHelperFocusActive(true);
      try { term.focus(); } catch (_) {}
    }, { passive: true });

    // Send user input to PTY
    term.onData((data) => {
      sendTerminalInput(data);
    });

    // Selection-driven UI affordances.
    term.onSelectionChange(() => {
      updateCopyButtonState();
    });
    updateCopyButtonState();

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      console.log('Terminal resized:', cols, 'x', rows, 'shellId:', shellId);
      if (startupSizing) return;
      if (hasBoundShell()) {
        syncTerminalSize();
      } else {
        console.warn('No shellId yet, skipping resize');
      }
    });

    // Fit terminal when drawer size changes
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      requestFit(8);
    });
    resizeObserver.observe(container);

    return term;
  }

  function installTouchHandlers() {
    if (touchHandlersInstalled) return;
    const el = term?.element;
    if (!el) return;

    // Only enable gesture semantics on touch-first devices.
    const isTouchFirst = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (!isTouchFirst) return;

    touchHandlersInstalled = true;

    const LONG_PRESS_MS = 450;
    const MOVE_CANCEL_PX = 8;
    const DOUBLE_TAP_MS = 280;
    const DOUBLE_TAP_PX = 24;

    let mode = null; // 'scroll' | 'select' | null
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let longPressTimer = null;
    let scrollRemainder = 0;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    function clearLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function synthMouse(type, touch) {
      try {
        const evt = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
        });
        el.dispatchEvent(evt);
      } catch (_) {}
    }

    function scrollByPixels(deltaY) {
      if (!term) return;
      const pxPerLine = Math.max(14, getCurrentFontSize() * 1.35);
      scrollRemainder += (-deltaY) / pxPerLine;
      const whole = scrollRemainder > 0 ? Math.floor(scrollRemainder) : Math.ceil(scrollRemainder);
      if (whole) {
        try { term.scrollLines(whole); } catch (_) {}
        scrollRemainder -= whole;
      }
    }

    el.addEventListener('touchstart', (e) => {
      if (!term) return;
      if (e.touches.length !== 1) return;

      const t = e.touches[0];
      mode = null;
      startX = t.clientX;
      startY = t.clientY;
      lastY = t.clientY;
      scrollRemainder = 0;

      clearLongPress();
      longPressTimer = setTimeout(() => {
        mode = 'select';
        synthMouse('mousedown', t);
      }, LONG_PRESS_MS);
    }, { passive: false });

    el.addEventListener('touchmove', (e) => {
      if (!term) return;
      if (e.touches.length !== 1) {
        clearLongPress();
        return;
      }

      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dyFromStart = t.clientY - startY;
      const moved = Math.hypot(dx, dyFromStart) > MOVE_CANCEL_PX;

      if (mode !== 'select' && moved) {
        // Movement means "scroll" unless selection mode has already been entered.
        clearLongPress();
        mode = 'scroll';
      }

      if (mode === 'select') {
        synthMouse('mousemove', t);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (mode === 'scroll') {
        const deltaY = t.clientY - lastY;
        lastY = t.clientY;
        scrollByPixels(deltaY);
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
      if (!term) return;
      clearLongPress();

      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;

      if (mode === 'select') {
        synthMouse('mouseup', t);
        updateCopyButtonState();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Tap-to-focus + optional double-tap word select (synthetic dblclick).
      const now = Date.now();
      const isDoubleTap = (now - lastTapTime) < DOUBLE_TAP_MS
        && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < DOUBLE_TAP_PX;

      if (isDoubleTap) {
        synthMouse('dblclick', t);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = t.clientX;
        lastTapY = t.clientY;
      }

      try { term.focus(); } catch (_) {}
    }, { passive: false });

    el.addEventListener('touchcancel', () => {
      clearLongPress();
      mode = null;
    }, { passive: false });
  }

  /**
   * Open the terminal drawer
   */
  async function open() {
    if (isOpen) return;

    drawer.classList.add('open');
    isOpen = true;
    setDrawerHelperFocusActive(true);
    startupSizing = true;

    // Create terminal instance if first time
    if (!term) {
      await initTerminal();
    }

    // Refresh shell selector from backend (project-agnostic, backend-owned).
    await refreshShellMenu();

    // Create shell if doesn't exist (getOrCreateShell returns null now)
    if (!shellId) {
      await getOrCreateShell();  // This just prepares, doesn't return ID
      console.log('Shell will be managed by backend via WebSocket');
    }

    await ensureTerminalSocket();
    emitTerminalRegister(shellId || 'auto');
  }

  /**
   * Close the terminal drawer (terminal stays alive)
   */
  function close() {
    if (!isOpen) return;

    drawer.classList.remove('open');
    isOpen = false;
    setDrawerHelperFocusActive(false);
    startupSizing = false;
    clearStartupFitTimer();
    lastResizeSent = null;
    // Note: Terminal shell and WebSocket stay alive!
  }

  /**
   * Permanently destroy the terminal
   */
  async function destroy() {
    console.log('Terminal destroy() called');
    
    // Send destroy command to backend FIRST (before UI cleanup)
    await destroyShell();
    
    // Close drawer UI
    close();
    
    // Close WebSocket (backend already terminated shell)
    if (ws) {
      try { ws.disconnect(); } catch (_) {}
      ws = null;
    }
    
    // Dispose xterm instance
    if (term) {
      term.dispose();
      term = null;
    }
    vendoredCtrlTerm = null;
    const runtimeWindow = getRuntimeWindow();
    runtimeWindow.term = null;
    runtimeWindow.ctrl = false;
    setDrawerHelperFocusActive(false);
    resizeObserver?.disconnect();
    resizeObserver = null;
    clearStartupFitTimer();
    startupSizing = false;
    if (fitRaf !== null) {
      cancelAnimationFrame(fitRaf);
      fitRaf = null;
    }
    fitFramesRemaining = 0;
    
    container.innerHTML = '';
    console.log('Terminal destroy() complete');
  }

  /**
   * Toggle drawer open/closed
   */
  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  /**
   * Toggle fullscreen mode
   */
  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    drawer.classList.toggle('fullscreen', isFullscreen);
    
    // Update button icon
    if (fullscreenBtn) {
      fullscreenBtn.textContent = isFullscreen ? '⛶' : '⛶';
      fullscreenBtn.title = isFullscreen ? 'Exit fullscreen' : 'Toggle fullscreen';
    }
    
    // Refit terminal after resize
    if (fitAddon && isOpen) {
      lastResizeSent = null;
      scheduleStartupResizeSync('fullscreen');
    }
  }

  /**
   * Enable manual resize by dragging header
   */
  function enableManualResize() {
    if (!header || !drawer) return;

    let startY = 0;
    let startHeight = 0;
    let isResizing = false;

    header.addEventListener('mousedown', (e) => {
      // Only resize on header background, not interactive controls
      if (e.target.closest('.terminal-shell-dropdown')) return;
      if (e.target.tagName === 'BUTTON') return;
      
      isResizing = true;
      startY = e.clientY;
      startHeight = drawer.offsetHeight;
      
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const deltaY = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight - 40, startHeight + deltaY));
      
      drawer.style.height = `${newHeight}px`;
      
      // Refit terminal during resize
      if (fitAddon && isOpen) {
        try { fitAddon.fit(); } catch (_) {}
        syncTerminalSize();
      }
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      
      isResizing = false;
      document.body.style.cursor = '';
      
      // Send final size to backend
      lastResizeSent = null;
      requestFit(6);
      syncTerminalSize(true);
    });
  }

  // Wire up UI events
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggle);
  }

  if (newBtn) {
    newBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await fetch('/api/app/file_editor_cm6/terminal/shells', { method: 'POST' });
      } catch (err) {
        console.warn('Failed to create new terminal shell:', err);
      } finally {
        await refreshShellMenu();
        emitTerminalRegister('auto');
      }
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', close);
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      applyFontSize(getCurrentFontSize() - FONT_SIZE_STEP);
    });
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      applyFontSize(getCurrentFontSize() + FONT_SIZE_STEP);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await copySelection();
    });
  }

  // Enable draggable resize
  enableManualResize();

  // Notify ready
  onReady();

  return {
    open,
    close,
    toggle,
    destroy,
    closeAndDisconnect,
    isOpen: () => isOpen,
  };
}
