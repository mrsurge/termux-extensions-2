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
  const toggleBtn = document.getElementById('terminal-toggle');
  const closeBtn = document.getElementById('terminal-close');
  const collapseBtn = document.getElementById('terminal-collapse');
  const fullscreenBtn = document.getElementById('terminal-fullscreen');

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
            shellHistoryPrimed = false;
          }
          lastShellId = receivedShellId;

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
      // Only resize on header span, not buttons
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

  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      await destroy();  // ✅ Properly await async function
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', close);
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
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
    isOpen: () => isOpen,
  };
}
