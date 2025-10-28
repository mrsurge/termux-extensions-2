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

  const drawer = document.getElementById('terminal-drawer');
  const container = document.getElementById('terminal-container');
  const toggleBtn = document.getElementById('terminal-toggle');
  const closeBtn = document.getElementById('terminal-close');

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
   * Create a new terminal shell session
   */
  async function createShell() {
    const cwd = getCurrentProjectPath();
    const res = await fetch('/api/app/file_editor_cm6/terminal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });

    const result = await res.json();
    if (!result.ok) {
      throw new Error(result.error || 'Failed to create terminal shell');
    }

    return result.data.id;
  }

  /**
   * Destroy the terminal shell permanently
   */
  async function destroyShell() {
    if (!shellId) return;

    try {
      await fetch(`/api/app/file_editor_cm6/terminal/${shellId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('Failed to destroy terminal shell:', err);
    }

    shellId = null;
  }

  /**
   * Connect WebSocket to PTY
   */
  function connectWebSocket(id) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/app/file_editor_cm6/terminal/${id}`;

    const socket = new WebSocket(url);

    socket.onopen = () => {
      console.log('Terminal WebSocket connected');
    };

    socket.onmessage = (event) => {
      if (term) {
        term.write(event.data);
      }
    };

    socket.onerror = (err) => {
      console.error('Terminal WebSocket error:', err);
    };

    socket.onclose = () => {
      console.log('Terminal WebSocket closed');
      ws = null;
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

    // Send user input to PTY
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

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

    // Create shell if doesn't exist
    if (!shellId) {
      shellId = await createShell();
      console.log('Shell created:', shellId);
    }

    // Connect WebSocket if not connected
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws = connectWebSocket(shellId);
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
    // Close drawer
    close();

    // Dispose xterm instance
    if (term) {
      term.dispose();
      term = null;
    }

    // Close WebSocket
    if (ws) {
      ws.close();
      ws = null;
    }

    // Destroy shell on backend
    await destroyShell();

    container.innerHTML = '';
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

  // Wire up UI events
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggle);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', destroy);
  }

  // Notify ready
  onReady();

  return {
    open,
    close,
    toggle,
    destroy,
    isOpen: () => isOpen,
  };
}
