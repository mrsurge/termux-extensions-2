// console_bridge.js — Agnostic console monkey-patcher + Socket.IO bridge
//
// Patches console.log/info/warn/error/debug to emit events on the ui_ipc
// Socket.IO namespace with a "console:" prefix.  Also captures uncaught
// errors and unhandled rejections.
//
// Usage (standalone — creates its own socket):
//   import { initConsoleBridge } from './console_bridge.js';
//   initConsoleBridge();
//
// Usage (shared socket — reuse an existing ui_ipc connection):
//   import { initConsoleBridge } from './console_bridge.js';
//   initConsoleBridge({ socket: existingUiIpcSocket });
//
// The bridge is idempotent — calling initConsoleBridge() twice is safe.

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
let _bridgeActive = false;
let _bridgeSocket = null;
let _workerId = null;
let _originals = {};

function _safeSerialize(x) {
  const seen = new WeakSet();
  return JSON.stringify(x, (_k, v) => {
    if (typeof v === 'bigint') return `BigInt(${v.toString()})`;
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  });
}

function _serializeArg(a) {
  try { return JSON.parse(_safeSerialize(a)); }
  catch { return String(a); }
}

function _emitLog(level, rawArgs) {
  if (!_bridgeSocket || !_bridgeSocket.connected) return;
  _bridgeSocket.emit('console:log', {
    workerId: _workerId,
    level,
    ts: Date.now(),
    args: rawArgs.map(_serializeArg),
  });
}

function _patchConsole() {
  for (const level of LEVELS) {
    _originals[level] = console[level].bind(console);
    console[level] = (...args) => {
      try { _emitLog(level, args); } catch (_) { /* never break caller */ }
      return _originals[level](...args);
    };
  }
}

function _hookErrors() {
  window.addEventListener('error', (e) => {
    _emitLog('error', [e.message, e.filename, e.lineno, e.colno, e.error || null]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    _emitLog('error', ['UnhandledRejection', e.reason]);
  });
}

function _hookEval() {
  if (!_bridgeSocket) return;
  _bridgeSocket.on('console:eval', async ({ reqId, code }) => {
    try {
      const result = (0, eval)(code);
      const value = await Promise.resolve(result);
      _bridgeSocket.emit('console:evalResult', {
        workerId: _workerId,
        reqId,
        ok: true,
        value: _serializeArg(value),
      });
    } catch (err) {
      _bridgeSocket.emit('console:evalResult', {
        workerId: _workerId,
        reqId,
        ok: false,
        error: _serializeArg(err),
      });
    }
  });
}

/**
 * Initialize the console bridge.
 *
 * @param {object} [opts]
 * @param {object} [opts.socket]   Existing ui_ipc Socket.IO instance to reuse.
 * @param {string} [opts.workerId] Identifier for this frontend (defaults to auto-generated).
 * @param {string} [opts.socketPath] Socket.IO path (default '/ui_ipc_ws/socket.io').
 * @param {string} [opts.namespace] Socket.IO namespace (default '/ui_ipc').
 * @returns {{ socket, workerId, destroy }}
 */
export function initConsoleBridge(opts = {}) {
  if (_bridgeActive) return { socket: _bridgeSocket, workerId: _workerId, destroy: destroyConsoleBridge };

  _workerId = opts.workerId || (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'w_' + Math.random().toString(36).slice(2, 10));

  if (opts.socket) {
    _bridgeSocket = opts.socket;
  } else {
    const io = window.io;
    if (!io) {
      console.warn('[console_bridge] window.io not available — bridge not started');
      return null;
    }
    _bridgeSocket = io(opts.namespace || '/ui_ipc', {
      path: opts.socketPath || '/ui_ipc_ws/socket.io',
      transports: ['websocket'],
      query: { app_id: 'file_editor_cm6', source: 'console_bridge', workerId: _workerId },
    });
  }

  // Tell the server this is a console-producing worker
  _bridgeSocket.on('connect', () => {
    _bridgeSocket.emit('console:register', { workerId: _workerId, role: 'worker' });
  });
  // If already connected, register immediately
  if (_bridgeSocket.connected) {
    _bridgeSocket.emit('console:register', { workerId: _workerId, role: 'worker' });
  }

  _patchConsole();
  _hookErrors();
  _hookEval();
  _bridgeActive = true;

  return { socket: _bridgeSocket, workerId: _workerId, destroy: destroyConsoleBridge };
}

/**
 * Tear down the bridge — restore original console methods.
 */
export function destroyConsoleBridge() {
  if (!_bridgeActive) return;
  for (const level of LEVELS) {
    if (_originals[level]) console[level] = _originals[level];
  }
  _originals = {};
  _bridgeActive = false;
}
