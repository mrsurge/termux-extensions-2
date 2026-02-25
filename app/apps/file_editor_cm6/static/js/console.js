// console.js — Console drawer module (vConsole-based observability UI)
//
// Connects to the ui_ipc Socket.IO namespace as a "drawer" role,
// receives console:log events from all workers, and renders them
// via vConsole's built-in log panel.
//
// Usage (from main.js):
//   import { createConsoleDrawer } from './static/js/console.js';
//   const consoleDrawer = createConsoleDrawer();

export function createConsoleDrawer(options = {}) {
  const {
    containerId = 'console-container',
    socketPath = '/ui_ipc_ws/socket.io',
    namespace = '/ui_ipc',
  } = options;

  let vConsoleInstance = null;
  let socket = null;
  let isVisible = false;
  let activeFilter = 'all'; // 'all' or a specific workerId
  const knownWorkers = new Set();

  const container = document.getElementById(containerId);
  const originToggle = document.getElementById('console-origin-toggle');
  const originDropdown = document.getElementById('console-origin-dd');
  const consoleHeader = document.getElementById('console-header');

  // ─── vConsole initialization ──────────────────────────────

  function _ensureVConsole() {
    if (vConsoleInstance) return Promise.resolve(vConsoleInstance);

    // Load vConsole dynamically (template innerHTML doesn't execute script tags)
    const load = typeof window.VConsole !== 'undefined'
      ? Promise.resolve(window.VConsole)
      : new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js';
          script.async = true;
          script.onload = () => resolve(window.VConsole);
          script.onerror = () => reject(new Error('Failed to load vConsole'));
          document.head.appendChild(script);
        });

    return load.then((VC) => {
      if (vConsoleInstance) return vConsoleInstance;

      // Save console methods BEFORE vConsole patches them.
      // At this point they are our bridge wrappers — restoring after
      // vConsole init prevents vConsole's own capture layer so logs
      // only arrive through the socket round-trip (no duplicates).
      const saved = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
      };

      vConsoleInstance = new VC({
        target: container,
        theme: 'dark',
        log: {
          maxLogNumber: 5000,
          showTimestamps: true,
        },
        defaultPlugins: ['system'],
      });

      // Restore bridge wrappers — removes vConsole's capture layer
      console.log = saved.log;
      console.info = saved.info;
      console.warn = saved.warn;
      console.error = saved.error;
      console.debug = saved.debug;

      vConsoleInstance.hideSwitch();
      vConsoleInstance.show();

      // Monkey-patch vConsole's evalCommand to route through our socket
      // instead of doing local eval. This makes the command bar target
      // whichever worker is selected in the origin dropdown.
      _patchEvalCommand();

      return vConsoleInstance;
    }).catch((err) => {
      console.warn('[console] failed to load vConsole:', err);
      return null;
    });
  }

  function _patchEvalCommand() {
    // Try multiple paths to find the log model singleton
    let model = null;

    // Path 1: pluginList dict
    const logPlugin = vConsoleInstance && vConsoleInstance.pluginList &&
      vConsoleInstance.pluginList['default'];
    if (logPlugin && logPlugin.model) {
      model = logPlugin.model;
    }

    // Path 2: vConsole.log exporter has a .model ref
    if (!model && vConsoleInstance && vConsoleInstance.log && vConsoleInstance.log.model) {
      model = vConsoleInstance.log.model;
    }

    if (!model || typeof model.evalCommand !== 'function') {
      console.warn('[console] could not patch evalCommand — remote eval unavailable');
      return;
    }

    const origEval = model.evalCommand.bind(model);

    model.evalCommand = function(cmd) {
      const target = activeFilter === 'all' ? 'main_page' : activeFilter;

      // Show the input in the log panel
      model.addLog({ type: 'log', origData: [cmd] }, { cmdType: 'input' });

      if (!socket || !socket.connected) {
        // Fallback to local eval if no socket
        origEval(cmd);
        return;
      }

      const reqId = crypto.randomUUID();
      socket.emit('console:eval', { targetWorkerId: target, reqId, code: cmd });

      // Listen for the result
      const handler = (res) => {
        if (!res || res.reqId !== reqId) return;
        socket.off('console:evalResult', handler);
        clearTimeout(timeout);
        if (res.ok) {
          model.addLog({ type: 'log', origData: [res.value] }, { cmdType: 'output' });
        } else {
          model.addLog({ type: 'error', origData: [res.error] }, { cmdType: 'output' });
        }
      };
      const timeout = setTimeout(() => {
        socket.off('console:evalResult', handler);
        model.addLog({ type: 'error', origData: ['eval timeout (10s)'] }, { cmdType: 'output' });
      }, 10000);
      socket.on('console:evalResult', handler);
    };
  }

  // ─── Origin dropdown ───────────────────────────────────────

  function _rebuildOriginDropdown() {
    if (!originDropdown) return;
    originDropdown.innerHTML = '';
    const items = ['all', ...Array.from(knownWorkers).sort()];
    for (const id of items) {
      const el = document.createElement('div');
      el.className = 'fe-dd-item';
      el.dataset.checkable = 'true';
      el.dataset.value = id;
      el.textContent = id === 'all' ? 'All' : id;
      if (id === activeFilter) el.classList.add('fe-menu-item-checked');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const prev = activeFilter;
        activeFilter = id;
        if (originToggle) originToggle.textContent = id === 'all' ? 'All' : id;
        originDropdown.classList.remove('show');
        originDropdown.querySelectorAll('.fe-dd-item').forEach(item => {
          item.classList.toggle('fe-menu-item-checked', item.dataset.value === id);
        });
        // Re-request full transcript so filter applies to history
        if (prev !== id) _replayFromDisk();
      });
      originDropdown.appendChild(el);
    }
  }

  function _replayFromDisk() {
    // Clear current display, then ask server to re-stream the log
    if (vConsoleInstance && vConsoleInstance.log) {
      vConsoleInstance.log.clear();
    }
    if (socket && socket.connected) {
      socket.emit('console:replay', {});
    }
  }

  function _trackWorker(workerId) {
    if (!workerId || knownWorkers.has(workerId)) return;
    knownWorkers.add(workerId);
    _rebuildOriginDropdown();
  }

  // Wire origin toggle button
  if (originToggle && originDropdown) {
    originToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = originDropdown.classList.contains('show');
      document.querySelectorAll('.fe-dropdown.show').forEach(d => d.classList.remove('show'));
      if (!isOpen) {
        _rebuildOriginDropdown();
        originDropdown.classList.add('show');
      }
    });
    // Close on any outside click
    document.addEventListener('click', (e) => {
      if (!originDropdown.contains(e.target) && e.target !== originToggle) {
        originDropdown.classList.remove('show');
      }
    });
  }

  // ─── Socket.IO connection ─────────────────────────────────

  function _connectSocket() {
    const io = window.io;
    if (!io) {
      console.warn('[console] window.io not available');
      return;
    }
    socket = io(namespace, {
      path: socketPath,
      transports: ['websocket'],
      query: { app_id: 'file_editor_cm6', source: 'console_drawer' },
    });

    socket.on('connect', () => {
      socket.emit('console:register', { role: 'drawer' });
    });

    socket.on('console:log', _handleLog);
    socket.on('console:evalResult', _handleEvalResult);

    // Server pushes the worker list on register changes
    socket.on('console:workers', (workers) => {
      if (!Array.isArray(workers)) return;
      for (const w of workers) _trackWorker(w);
    });
  }

  // ─── Log rendering via vConsole plugin API ────────────────

  const LEVEL_METHOD = { log: 'log', info: 'info', warn: 'warn', error: 'error', debug: 'debug' };

  function _handleLog(msg) {
    if (!msg || !Array.isArray(msg.args)) return;
    if (!vConsoleInstance) return;

    const workerId = msg.workerId || '?';
    _trackWorker(workerId);

    // Filter by selected origin
    if (activeFilter !== 'all' && workerId !== activeFilter) return;

    const level = LEVEL_METHOD[msg.level] || 'log';
    const prefix = `[${workerId}]`;

    // Use vConsole.log.<level>() to render into the Log panel
    // without echoing back to browser console (avoids infinite loops)
    const logPlugin = vConsoleInstance.log;
    if (logPlugin && typeof logPlugin[level] === 'function') {
      logPlugin[level](prefix, ...msg.args);
    }
  }

  // ─── Eval support ─────────────────────────────────────────

  const _evalCallbacks = new Map();

  function _handleEvalResult(msg) {
    if (!msg || !msg.reqId) return;
    const cb = _evalCallbacks.get(msg.reqId);
    if (cb) {
      _evalCallbacks.delete(msg.reqId);
      cb(msg);
    }
  }

  function evalInWorker(targetWorkerId, code) {
    if (!socket || !socket.connected) return Promise.reject(new Error('not connected'));
    // Default to main_page when no specific target or "all" selected
    const target = targetWorkerId || (activeFilter === 'all' ? 'main_page' : activeFilter);
    const reqId = crypto.randomUUID();
    socket.emit('console:eval', { targetWorkerId: target, reqId, code });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        _evalCallbacks.delete(reqId);
        reject(new Error('eval timeout'));
      }, 10000);
      _evalCallbacks.set(reqId, (res) => {
        clearTimeout(timeout);
        res.ok ? resolve(res.value) : reject(res.error);
      });
    });
  }

  // ─── Visibility / lifecycle ───────────────────────────────

  async function show() {
    if (!container) return;
    container.style.display = 'block';
    if (consoleHeader) consoleHeader.style.display = 'flex';
    if (!vConsoleInstance) await _ensureVConsole();
    if (!socket) _connectSocket();
    if (vConsoleInstance) {
      vConsoleInstance.show();
      vConsoleInstance.hideSwitch();
    }
    isVisible = true;
  }

  function hide() {
    if (!container) return;
    container.style.display = 'none';
    if (consoleHeader) consoleHeader.style.display = 'none';
    isVisible = false;
  }

  function toggle() {
    isVisible ? hide() : show();
  }

  function destroy() {
    if (vConsoleInstance) {
      try { vConsoleInstance.destroy(); } catch (_) {}
      vConsoleInstance = null;
    }
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    isVisible = false;
  }

  // Start hidden
  if (container) container.style.display = 'none';

  return {
    show,
    hide,
    toggle,
    destroy,
    evalInWorker,
    get isVisible() { return isVisible; },
  };
}
