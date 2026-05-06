// Host console drawer module (vConsole-based observability UI)
//
// Connects to the framework-owned TE2 console Socket.IO namespace as a
// "drawer" role,
// receives console:log events from all workers, and renders them
// via vConsole's built-in log panel.
//
interface ConsoleDrawerOptions {
  containerId?: string;
  socketPath?: string;
  namespace?: string;
}

interface SocketLike {
  connected?: boolean;
  emit?(event: string, payload?: Record<string, unknown>): void;
  on?(event: string, handler: (payload: unknown) => void): void;
  off?(event: string, handler: (payload: unknown) => void): void;
  disconnect?(): void;
}

interface VConsoleModel {
  evalCommand(cmd: string): void;
  addLog(log: { type: string; origData: unknown[] }, options: { cmdType: string; noOrig?: boolean }): void;
}

interface VConsoleLogPlugin {
  clear?(): void;
  model?: VConsoleModel;
  [method: string]: unknown;
}

interface VConsoleInstance {
  log?: VConsoleLogPlugin;
  pluginList?: Record<string, { model?: VConsoleModel }>;
  hideSwitch(): void;
  show(): void;
  destroy(): void;
}

type VConsoleConstructor = new (options: Record<string, unknown>) => VConsoleInstance;

type HostConsoleWindow = Window & {
  VConsole?: VConsoleConstructor;
  io?: (namespace: string, options?: Record<string, unknown>) => SocketLike;
};

interface ConsoleLogMessage {
  workerId?: string;
  level?: string;
  args?: unknown[];
}

interface EvalResultMessage {
  reqId?: string;
  ok?: boolean;
  value?: unknown;
  error?: unknown;
}

export interface ConsoleDrawerController {
  show(): Promise<void>;
  hide(): void;
  toggle(): void;
  destroy(): void;
  evalInWorker(targetWorkerId: string | null | undefined, code: string): Promise<unknown>;
  readonly isVisible: boolean;
}

function hostWindow(): HostConsoleWindow {
  return window as HostConsoleWindow;
}

function getSocketIoFactory(): ((namespace: string, options?: Record<string, unknown>) => SocketLike) | undefined {
  return hostWindow().io as ((namespace: string, options?: Record<string, unknown>) => SocketLike) | undefined;
}

function isEvalResultMessage(value: unknown): value is EvalResultMessage {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createConsoleDrawer(options: ConsoleDrawerOptions = {}): ConsoleDrawerController {
  const {
    containerId = 'console-container',
    socketPath = '/te2_console_ws/socket.io',
    namespace = '/te2_console',
  } = options;

  let vConsoleInstance: VConsoleInstance | null = null;
  let socket: SocketLike | null = null;
  let isVisible = false;
  let activeFilter = 'all'; // 'all' or a specific workerId
  const knownWorkers = new Set<string>();

  const container = document.getElementById(containerId);
  const originToggle = document.getElementById('console-origin-toggle');
  const originDropdown = document.getElementById('console-origin-dd');
  const consoleHeader = document.getElementById('console-header');

  function _resetDrawerState(): void {
    knownWorkers.clear();
    activeFilter = 'all';
    if (originToggle) originToggle.textContent = 'All';
    if (originDropdown) {
      originDropdown.classList.remove('show');
      originDropdown.innerHTML = '';
    }
    if (vConsoleInstance && vConsoleInstance.log && typeof vConsoleInstance.log.clear === 'function') {
      vConsoleInstance.log.clear();
    }
  }

  function _replaceWorkers(workerIds: string[]): void {
    knownWorkers.clear();
    for (const workerId of workerIds) {
      if (!workerId) continue;
      knownWorkers.add(workerId);
    }
    if (activeFilter !== 'all' && !knownWorkers.has(activeFilter)) {
      activeFilter = 'all';
      if (originToggle) originToggle.textContent = 'All';
      if (vConsoleInstance && vConsoleInstance.log && typeof vConsoleInstance.log.clear === 'function') {
        vConsoleInstance.log.clear();
      }
      if (socket && socket.connected && typeof socket.emit === 'function') {
        socket.emit('console:replay', {});
      }
    }
    _rebuildOriginDropdown();
  }

  // ─── vConsole initialization ──────────────────────────────

  function _ensureVConsole(): Promise<VConsoleInstance | null> {
    if (vConsoleInstance) return Promise.resolve(vConsoleInstance);

    // Load vConsole dynamically (template innerHTML doesn't execute script tags)
    const load: Promise<VConsoleConstructor | undefined> = typeof hostWindow().VConsole !== 'undefined'
      ? Promise.resolve(hostWindow().VConsole)
      : new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js';
          script.async = true;
          script.onload = () => resolve(hostWindow().VConsole);
          script.onerror = () => reject(new Error('Failed to load vConsole'));
          document.head.appendChild(script);
        });

    return load.then((VC) => {
      if (!VC) throw new Error('vConsole constructor unavailable');
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
        onClearLog() {
          // Native Clear button was pressed — truncate backend transcript
          if (socket && socket.connected && typeof socket.emit === 'function') {
            socket.emit('console:clear', {});
          }
        },
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

  function _patchEvalCommand(): void {
    const model = _getLogModel();
    if (!model || typeof model.evalCommand !== 'function') {
      console.warn('[console] could not patch evalCommand — remote eval unavailable');
      return;
    }

    const origEval = model.evalCommand.bind(model);

    model.evalCommand = function(cmd: string): void {
      const target = activeFilter === 'all' ? 'main_page' : activeFilter;

      // Show the input in the log panel
      model.addLog({ type: 'log', origData: [cmd] }, { cmdType: 'input', noOrig: true });

      if (!socket || !socket.connected || typeof socket.emit !== 'function') {
        // Fallback to local eval if no socket
        origEval(cmd);
        return;
      }

      const reqId = crypto.randomUUID();
      const activeSocket = socket;
      const emitEval = activeSocket.emit;
      if (typeof emitEval !== 'function') {
        origEval(cmd);
        return;
      }
      emitEval.call(activeSocket, 'console:eval', { targetWorkerId: target, reqId, code: cmd });

      // Listen for the result
      const handler = (res: unknown): void => {
        if (!isEvalResultMessage(res)) return;
        if (!res || res.reqId !== reqId) return;
        activeSocket.off?.('console:evalResult', handler);
        clearTimeout(timeout);
        if (res.ok) {
          model.addLog({ type: 'log', origData: [res.value] }, { cmdType: 'output', noOrig: true });
        } else {
          model.addLog({ type: 'error', origData: [res.error] }, { cmdType: 'output', noOrig: true });
        }
      };
      const timeout = setTimeout(() => {
        activeSocket.off?.('console:evalResult', handler);
        model.addLog({ type: 'error', origData: ['eval timeout (10s)'] }, { cmdType: 'output', noOrig: true });
      }, 10000);
      activeSocket.on?.('console:evalResult', handler);
    };
  }

  // ─── Origin dropdown ───────────────────────────────────────

  function _rebuildOriginDropdown(): void {
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
        originDropdown.querySelectorAll<HTMLElement>('.fe-dd-item').forEach(item => {
          item.classList.toggle('fe-menu-item-checked', item.dataset.value === id);
        });
        // Re-request full transcript so filter applies to history
        if (prev !== id) _replayFromDisk();
      });
      originDropdown.appendChild(el);
    }
  }

  function _replayFromDisk(): void {
    // Clear current display, then ask server to re-stream the log
    if (vConsoleInstance && vConsoleInstance.log && typeof vConsoleInstance.log.clear === 'function') {
      vConsoleInstance.log.clear();
    }
    if (socket && socket.connected && typeof socket.emit === 'function') {
      socket.emit('console:replay', {});
    }
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
      if (e.target instanceof Node && !originDropdown.contains(e.target) && e.target !== originToggle) {
        originDropdown.classList.remove('show');
      }
    });
  }

  // ─── Socket.IO connection ─────────────────────────────────

  function _connectSocket(): void {
    const io = getSocketIoFactory();
    if (!io) {
      console.warn('[console] window.io not available');
      return;
    }
    const nextSocket = io(namespace, {
      path: socketPath,
      transports: ['websocket'],
      query: { app_id: 'file_editor_cm6', source: 'console_drawer' },
    });
    socket = nextSocket;

    nextSocket.on?.('connect', () => {
      nextSocket.emit?.('console:register', { role: 'drawer' });
    });

    nextSocket.on?.('console:log', _handleLog);
    nextSocket.on?.('console:evalResult', _handleEvalResult);

    // Server pushes the worker list on register changes
    nextSocket.on?.('console:workers', (workers: unknown) => {
      if (!Array.isArray(workers)) return;
      _replaceWorkers(workers.filter((worker): worker is string => typeof worker === 'string'));
    });
  }

  // ─── Log rendering via vConsole plugin API ────────────────

  const LEVEL_METHOD: Record<string, string> = { log: 'log', info: 'info', warn: 'warn', error: 'error', debug: 'debug' };

  function _getLogModel(): VConsoleModel | null {
    // Path 1: pluginList dict
    const logPlugin = vConsoleInstance && vConsoleInstance.pluginList &&
      vConsoleInstance.pluginList['default'];
    if (logPlugin && logPlugin.model) {
      return logPlugin.model;
    }

    // Path 2: vConsole.log exporter has a .model ref
    if (vConsoleInstance && vConsoleInstance.log && vConsoleInstance.log.model) {
      return vConsoleInstance.log.model;
    }

    return null;
  }

  function _handleLog(msg: unknown): void {
    const message = msg && typeof msg === 'object' && !Array.isArray(msg)
      ? msg as ConsoleLogMessage
      : null;
    if (!message) return;
    if (!Array.isArray(message.args)) return;
    if (!vConsoleInstance) return;

    const workerId = message.workerId || '?';

    // Filter by selected origin
    if (activeFilter !== 'all' && workerId !== activeFilter) return;

    const level = LEVEL_METHOD[message.level || ''] || 'log';
    const prefix = `[${workerId}]`;

    // Render directly through vConsole's model as UI-only rows. Upstream
    // addLog calls the original console unless noOrig is set; in TE2 the
    // original console is the framework console bridge, so omitting noOrig
    // feeds replayed drawer rows back into the transcript stream.
    const model = _getLogModel();
    if (model && typeof model.addLog === 'function') {
      model.addLog({ type: level, origData: [prefix, ...message.args] }, { cmdType: 'output', noOrig: true });
    }
  }

  // ─── Eval support ─────────────────────────────────────────

  const _evalCallbacks = new Map<string, (message: EvalResultMessage) => void>();

  function _handleEvalResult(msg: unknown): void {
    if (!isEvalResultMessage(msg) || !msg.reqId) return;
    const cb = _evalCallbacks.get(msg.reqId);
    if (cb) {
      _evalCallbacks.delete(msg.reqId);
      cb(msg);
    }
  }

  function evalInWorker(targetWorkerId: string | null | undefined, code: string): Promise<unknown> {
    if (!socket || !socket.connected || typeof socket.emit !== 'function') {
      return Promise.reject(new Error('not connected'));
    }
    // Default to main_page when no specific target or "all" selected
    const target = targetWorkerId || (activeFilter === 'all' ? 'main_page' : activeFilter);
    const reqId = crypto.randomUUID();
    socket.emit('console:eval', { targetWorkerId: target, reqId, code });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        _evalCallbacks.delete(reqId);
        reject(new Error('eval timeout'));
      }, 10000);
      _evalCallbacks.set(reqId, (res: EvalResultMessage) => {
        clearTimeout(timeout);
        res.ok ? resolve(res.value) : reject(res.error);
      });
    });
  }

  // ─── Visibility / lifecycle ───────────────────────────────

  async function show(): Promise<void> {
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

  function hide(): void {
    if (!container) return;
    if (socket) {
      try { socket.emit?.('console:unregister', { role: 'drawer' }); } catch (_) {}
      try { socket.disconnect?.(); } catch (_) {}
      socket = null;
    }
    _resetDrawerState();
    container.style.display = 'none';
    if (consoleHeader) consoleHeader.style.display = 'none';
    isVisible = false;
  }

  function toggle(): void {
    isVisible ? hide() : show();
  }

  function destroy(): void {
    if (vConsoleInstance) {
      try { vConsoleInstance.destroy(); } catch (_) {}
      vConsoleInstance = null;
    }
    if (socket) {
      socket.disconnect?.();
      socket = null;
    }
    _resetDrawerState();
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
