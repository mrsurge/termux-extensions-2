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
   * Get or create a terminal shell session
   */
  async function getOrCreateShell() {
    // Try to restore previous shell from app's history store
    try {
      const stateRes = await fetch('/api/app/file_editor_cm6/terminal/shell-id');
      const stateResult = await stateRes.json();
      
      if (stateResult.ok && stateResult.data.shell_id) {
        const savedShellId = stateResult.data.shell_id;
        
        // Check if saved shell still exists
        const shellRes = await fetch(`/api/app/file_editor_cm6/terminal/${savedShellId}`);
        const shellResult = await shellRes.json();
        
        if (shellResult.ok && shellResult.data.status === 'running') {
          console.log('Reconnecting to existing shell:', savedShellId);
          return savedShellId;
        } else {
          console.log('Saved shell no longer running, cleaning up state');
          // Clear invalid shell ID from state
          await fetch('/api/app/file_editor_cm6/terminal/shell-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shell_id: null }),
          });
        }
      }
    } catch (err) {
      console.log('No saved shell found:', err);
    }
    
    // Clean up any orphaned code-editor-terminal shells
    await cleanupOrphanedShells();
    
    // Create new shell
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

    const newShellId = result.data.id;
    
    // Save to app's history store
    await fetch('/api/app/file_editor_cm6/terminal/shell-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shell_id: newShellId }),
    });
    
    console.log('Created new shell:', newShellId);
    
    return newShellId;
  }

  /**
   * Clean up orphaned terminal shells
   */
  async function cleanupOrphanedShells() {
    try {
      const res = await fetch('/api/framework_shells');
      const result = await res.json();
      
      if (result.ok) {
        const orphanedShells = result.data.filter(shell => 
          shell.label === 'code-editor-terminal'
        );
        
        console.log(`Found ${orphanedShells.length} orphaned terminal shells, cleaning up...`);
        
        for (const shell of orphanedShells) {
          await fetch(`/api/app/file_editor_cm6/terminal/${shell.id}`, {
            method: 'DELETE',
          }).catch(err => console.error('Failed to cleanup shell:', shell.id, err));
        }
      }
    } catch (err) {
      console.error('Failed to cleanup orphaned shells:', err);
    }
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
      
      // Clear from app's history store
      await fetch('/api/app/file_editor_cm6/terminal/shell-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shell_id: null }),
      });
    } catch (err) {
      console.error('Failed to destroy terminal shell:', err);
    }

    shellId = null;
  }

  /**
   * Connect WebSocket to PTY and preload history
   */
  async function connectWebSocket(id) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/app/file_editor_cm6/terminal/${id}`;

    // Preload persisted log tail so history survives refresh/reopen
    if (term) {
      try {
        const res = await fetch(`/api/app/file_editor_cm6/terminal/${id}?logs=true&tail=2000`);
        const result = await res.json();
        
        if (result.ok && result.data.logs && Array.isArray(result.data.logs.stdout_tail)) {
          const priming = result.data.logs.stdout_tail.join('');
          if (priming) {
            term.write(priming);
            console.log('Preloaded terminal history:', result.data.logs.stdout_tail.length, 'lines');
          }
        }
      } catch (err) {
        console.warn('Failed to preload terminal history:', err);
      }
    }

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
      shellId = await getOrCreateShell();
      console.log('Shell created:', shellId);
    }

    // Connect WebSocket if not connected (preload history first)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws = await connectWebSocket(shellId);
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
    closeBtn.addEventListener('click', destroy);
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
