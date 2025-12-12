// app/apps/file_editor_cm6/static/js/terminal.js

import ReconnectingWebSocket from './reconnecting_websocket.js';

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

    if (fitAddon && isOpen) {
      // Let the layout settle before fitting, then backend resize is handled by onResize.
      setTimeout(() => {
        try { fitAddon.fit(); } catch (_) {}
      }, 0);
    }
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
        try {
          await fetch(`/api/app/file_editor_cm6/terminal/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
        } catch (err) {
          console.warn('Failed to close terminal shell:', err);
        } finally {
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

    // Stop reconnect attempts and drop the socket so a future open()
    // will establish a fresh /ws/.../auto connection for the new project.
    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }

    // Force fresh history priming on next shell_id message.
    shellId = null;
    lastShellId = null;
    shellHistoryPrimed = false;

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

  function loadStylesheet(href) {
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      document.head.appendChild(link);
    });
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
    shellId = null;  // Clear immediately to prevent reconnection
    lastShellId = null;
    shellHistoryPrimed = false;

    // Send destroy command through WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: 'destroy' }));
        console.log('Sent destroy command for shell:', currentShellId);
        
        // Wait briefly for backend to process
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error('Failed to send destroy command:', err);
      }
    }
  }

  /**
   * Connect WebSocket to PTY and preload history
   */
  async function connectWebSocket(id) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/app/file_editor_cm6/terminal/${id}`;

    const socket = new ReconnectingWebSocket(url, {
      maxRetries: 15,
      reconnectInterval: 500,
      maxReconnectInterval: 5000,
      debug: true
    });

    socket.onopen = () => {
      console.log('Terminal WebSocket connected');
    };

    socket.onmessage = async (event) => {
      // Handle JSON messages from server
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'shell_id') {
          const receivedShellId = msg.shell_id;
          const isNewShell = receivedShellId !== lastShellId;
          shellId = receivedShellId;
          console.log('Received shell ID from server:', shellId);
          
          if (isNewShell) {
            // Backend switched us to a different shell (e.g., project change).
            // Clear the in-browser buffer so the next history load is unambiguous.
            try {
              term?.reset();
            } catch (err) {
              // reset() may not exist on older xterm versions; fallback to clear.
              try { term?.clear(); } catch (_) {}
            }
            shellHistoryPrimed = false;
          }
          lastShellId = receivedShellId;

          // Sync dropdown to backend active shell.
          try {
            await refreshShellMenu();
          } catch (_) {}

          // Now fetch logs with the real shell ID (only once per shell)
          if (term && !shellHistoryPrimed) {
            let primed = false;
            try {
              const res = await fetch(`/api/app/file_editor_cm6/terminal/${shellId}?logs=true&tail=2000`);
              const result = await res.json();
              
              if (result.ok && result.data.logs && Array.isArray(result.data.logs.stdout_tail)) {
                const priming = result.data.logs.stdout_tail.join('');
                if (priming) {
                  term.write(priming);
                  console.log('Preloaded terminal history:', result.data.logs.stdout_tail.length, 'lines');
                }
              }
              primed = true;
            } catch (err) {
              console.warn('Failed to preload terminal history:', err);
            }

            if (primed) {
              shellHistoryPrimed = true;
            }
          }
          return;
        } else if (msg.type === 'shell_list') {
          try {
            renderShellMenu(msg.shells || [], msg.active_shell_id || shellId);
            const activeShellId = msg.active_shell_id || shellId;
            const activeShell = (msg.shells || []).find((s) => s.id === activeShellId);
            setShellToggleShell(activeShell || null, activeShellId);
          } catch (_) {}
          return;
        } else if (msg.type === 'error') {
          console.error('Terminal error:', msg.message);
          return;
        }
      } catch (e) {
        // Not JSON, treat as terminal output
      }
      
      // Regular terminal output
      if (term) {
        term.write(event.data);
      }
    };

    socket.onerror = (err) => {
      console.error('Terminal WebSocket error:', err);
    };

    socket.onclose = (event) => {
      console.log('Terminal WebSocket closed', event?.code);
      // Only drop reference if we intentionally closed the socket
      if (socket.forcedClose && ws === socket) {
        ws = null;
      }
    };

    socket.onreconnect = (attempt) => {
      if (term) {
        term.writeln(`\r\nReconnecting (attempt ${attempt})...`);
      }
    };

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
      cursorBlink: true,
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
    // Don't fit here - we'll fit after shell is created in open()

    // Touch UX: install handlers once after open() creates the terminal element.
    installTouchHandlers();

    // Send user input to PTY
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Selection-driven UI affordances.
    term.onSelectionChange(() => {
      updateCopyButtonState();
    });
    updateCopyButtonState();

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      console.log('Terminal resized:', cols, 'x', rows, 'shellId:', shellId);
      if (shellId) {
        fetch(`/api/app/file_editor_cm6/terminal/${shellId}/resize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols, rows }),
        }).catch(console.error);
      } else {
        console.warn('No shellId yet, skipping resize');
      }
    });

    // Fit terminal when drawer size changes
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon && isOpen) {
        fitAddon.fit();
      }
    });
    resizeObserver.observe(drawer);

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

    // Connect WebSocket - use 'auto' to let backend manage shell ID
    if (!ws) {
      ws = await connectWebSocket('auto');
    } else if (ws.readyState === WebSocket.CLOSED && ws.forcedClose) {
      ws = await connectWebSocket('auto');
    } else if (ws.readyState === WebSocket.CLOSED) {
      ws.reconnect();
    }

    // Fit terminal to drawer size and manually send initial resize
    if (fitAddon && term) {
      setTimeout(() => {
        fitAddon.fit();
        // Manually send resize since shellId is now available
        const cols = term.cols;
        const rows = term.rows;
        console.log('Sending initial resize:', cols, 'x', rows, 'to shell:', shellId);
        if (shellId && cols && rows) {
          fetch(`/api/app/file_editor_cm6/terminal/${shellId}/resize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cols, rows }),
          }).then(() => console.log('Resize sent successfully'))
            .catch(console.error);
        }
      }, 150);
    }
  }

  /**
   * Close the terminal drawer (terminal stays alive)
   */
  function close() {
    if (!isOpen) return;

    drawer.classList.remove('open');
    isOpen = false;
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
      ws.close();
      ws = null;
    }
    
    // Dispose xterm instance
    if (term) {
      term.dispose();
      term = null;
    }
    
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
      setTimeout(() => {
        fitAddon.fit();
        if (shellId && term) {
          fetch(`/api/app/file_editor_cm6/terminal/${shellId}/resize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cols: term.cols, rows: term.rows }),
          }).catch(console.error);
        }
      }, 350);
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
      if (fitAddon) {
        fitAddon.fit();
      }
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      
      isResizing = false;
      document.body.style.cursor = '';
      
      // Send final size to backend
      if (shellId && term) {
        fetch(`/api/app/file_editor_cm6/terminal/${shellId}/resize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: term.cols, rows: term.rows }),
        }).catch(console.error);
      }
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
