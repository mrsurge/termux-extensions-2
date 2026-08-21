// console_bridge.js — Agnostic console monkey-patcher + Socket.IO bridge
//
// Patches console.log/info/warn/error/debug to emit events on the TE2 console
// Socket.IO namespace with a "console:" prefix.  Also captures uncaught
// errors and unhandled rejections.
//
// Usage (standalone — creates its own socket):
//   import { initConsoleBridge } from './console_bridge.js';
//   initConsoleBridge({ workerLabel: 'my_app', uniquePerWindow: true });
//
// Usage (shared socket — reuse an existing TE2 console connection):
//   import { initConsoleBridge } from './console_bridge.js';
//   initConsoleBridge({ socket: existingTe2ConsoleSocket, workerLabel: 'my_app', uniquePerWindow: true });
//
// For multi-client/frontends that may be open in multiple windows, tabs, or iframes:
// - use workerLabel as the human-readable grouping label
// - use uniquePerWindow: true to derive a stable exact workerId per window
// - do not reuse one fixed workerId across every instance unless that is truly intended
//
// The bridge is idempotent — calling initConsoleBridge() twice is safe.

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
let _bridgeActive = false;
let _bridgeSocket = null;
let _workerId = null;
let _workerLabel = null;
let _originals = {};
let _pendingEvals = new Map();
let _ownsSocket = false;
let _socketHandlers = {};
let _windowHandlers = {};

export function getConsoleBridgeStatus() {
  return {
    active: _bridgeActive,
    connected: !!(_bridgeSocket && _bridgeSocket.connected),
    workerId: _workerId,
    workerLabel: _workerLabel,
  };
}

function _emitBridgeStatus() {
  try {
    window.dispatchEvent(new CustomEvent('te2:console-bridge-status', {
      detail: getConsoleBridgeStatus(),
    }));
  } catch (_) {}
}

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
  if (a === undefined) return null;
  try { return JSON.parse(_safeSerialize(a)); }
  catch { return String(a); }
}

function _randomWorkerSuffix(length = 8) {
  const size = Math.max(1, Math.min(32, Number(length) || 8));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = crypto.getRandomValues(new Uint8Array(size));
    return Array.from(values, value => alphabet[value % alphabet.length]).join('');
  }
  let suffix = '';
  while (suffix.length < size) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return suffix;
}

function _sanitizeWorkerLabel(value) {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-zA-Z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'worker';
}

function _socketEndpoint(baseUrl, namespace) {
  const normalizedNamespace = String(namespace || '/te2_console').startsWith('/')
    ? String(namespace || '/te2_console')
    : `/${String(namespace || '/te2_console')}`;
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  return normalizedBase ? `${normalizedBase}${normalizedNamespace}` : normalizedNamespace;
}

function _perWindowWorkerId(label, prefix = '', ownerLength = 8) {
  const configuredPrefix = String(prefix || '').trim();
  const base = _sanitizeWorkerLabel(configuredPrefix || label);
  const size = Math.max(1, Math.min(32, Number(ownerLength) || 8));
  const separator = configuredPrefix ? '-' : ':';
  const storageKey = configuredPrefix
    ? `te2.consoleBridge.workerId:${base}:${size}`
    : `te2.consoleBridge.workerId:${base}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing && typeof existing === 'string' && existing.trim()) {
      return existing.trim();
    }
    const created = `${base}${separator}${_randomWorkerSuffix(size)}`;
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `${base}${separator}${_randomWorkerSuffix(size)}`;
  }
}

function _emitLog(level, rawArgs) {
  if (!_bridgeSocket || !_bridgeSocket.connected) return;
  const emitter = _bridgeSocket.volatile && typeof _bridgeSocket.volatile.emit === 'function'
    ? _bridgeSocket.volatile
    : _bridgeSocket;
  emitter.emit('console:log', {
    workerId: _workerId,
    workerLabel: _workerLabel,
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
  _windowHandlers.error = (e) => {
    _emitLog('error', [e.message, e.filename, e.lineno, e.colno, e.error || null]);
  };
  _windowHandlers.unhandledrejection = (e) => {
    _emitLog('error', ['UnhandledRejection', e.reason]);
  };
  window.addEventListener('error', _windowHandlers.error);
  window.addEventListener('unhandledrejection', _windowHandlers.unhandledrejection);
}

function _cleanupEval(reqId) {
  const pending = _pendingEvals.get(reqId);
  if (pending) {
    clearTimeout(pending.timeoutHandle);
    _pendingEvals.delete(reqId);
  }
}

function _hookEval() {
  if (!_bridgeSocket) return;
  _socketHandlers.eval = async ({ reqId, code, timeoutSeconds }) => {
    const timeoutMs = (timeoutSeconds || 20) * 1000 + 2000;
    let timeoutHandle;
    let rejectTimeout;
    const timeoutPromise = new Promise((_, reject) => {
      rejectTimeout = reject;
      timeoutHandle = setTimeout(
        () => reject(new Error('eval_timeout')),
        timeoutMs,
      );
    });
    _pendingEvals.set(reqId, { timeoutHandle, reject: rejectTimeout });
    try {
      let result;
      try { result = (0, eval)(code); }
      catch (synErr) {
        if (synErr instanceof SyntaxError) result = (0, eval)('(' + code + ')');
        else throw synErr;
      }
      const value = await Promise.race([Promise.resolve(result), timeoutPromise]);
      _cleanupEval(reqId);
      _bridgeSocket.emit('console:evalResult', {
        workerId: _workerId,
        reqId,
        ok: true,
        value: _serializeArg(value),
      });
    } catch (err) {
      _cleanupEval(reqId);
      const errorType = err?.message === 'eval_timeout' ? 'eval_timeout'
        : err?.message === 'eval_cancelled' ? 'eval_cancelled'
        : undefined;
      _bridgeSocket.emit('console:evalResult', {
        workerId: _workerId,
        reqId,
        ok: false,
        error: _serializeArg(err),
        ...(errorType ? { errorType } : {}),
      });
    }
  };
  _socketHandlers.evalCancel = ({ reqId }) => {
    const pending = _pendingEvals.get(reqId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      _pendingEvals.delete(reqId);
      pending.reject(new Error('eval_cancelled'));
    }
  };
  _bridgeSocket.on('console:eval', _socketHandlers.eval);
  _bridgeSocket.on('console:evalCancel', _socketHandlers.evalCancel);
}

/**
 * Initialize the console bridge.
 *
 * @param {object} [opts]
 * @param {object} [opts.socket]   Existing TE2 console Socket.IO instance to reuse.
 * @param {string} [opts.workerId] Exact identifier for this frontend. Prefer this only when you intentionally want a fixed ID.
 * @param {string} [opts.workerLabel] Human-readable label/grouping for this frontend.
 * @param {boolean} [opts.uniquePerWindow] Generate a stable unique ID per browser window/tab from workerLabel. Recommended for multi-client hosted frontends.
 * @param {string} [opts.workerIdPrefix] Optional short prefix for a per-window worker ID. Does not replace workerLabel.
 * @param {number} [opts.workerOwnerLength] Random owner suffix length when workerIdPrefix is provided (default 8).
 * @param {string} [opts.baseUrl] Explicit framework origin for cross-origin hosted pages.
 * @param {string} [opts.socketPath] Socket.IO path (default '/te2_console_ws/socket.io').
 * @param {string} [opts.namespace] Socket.IO namespace (default '/te2_console').
 * @returns {{ socket, workerId, destroy }}
 */
export function initConsoleBridge(opts = {}) {
  if (_bridgeActive) return { socket: _bridgeSocket, workerId: _workerId, destroy: destroyConsoleBridge };

  _workerLabel = _sanitizeWorkerLabel(opts.workerLabel || opts.workerId || 'worker');
  if (opts.uniquePerWindow) {
    _workerId = _perWindowWorkerId(
      _workerLabel,
      opts.workerIdPrefix,
      opts.workerOwnerLength,
    );
  } else if (typeof opts.workerId === 'string' && opts.workerId.trim()) {
    _workerId = opts.workerId.trim();
  } else if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    _workerId = crypto.randomUUID();
  } else {
    _workerId = `w_${Math.random().toString(36).slice(2, 10)}`;
  }

  if (opts.socket) {
    _bridgeSocket = opts.socket;
    _ownsSocket = false;
  } else {
    const io = window.io;
    if (!io) {
      console.warn('[console_bridge] window.io not available — bridge not started');
      return null;
    }
    _bridgeSocket = io(_socketEndpoint(opts.baseUrl, opts.namespace), {
      path: opts.socketPath || '/te2_console_ws/socket.io',
      transports: ['websocket'],
      query: {
        app_id: 'code_te2',
        source: 'console_bridge',
        workerId: _workerId,
        workerLabel: _workerLabel,
      },
    });
    _ownsSocket = true;
  }

  // Tell the server this is a console-producing worker
  _socketHandlers.connect = () => {
    _bridgeSocket.emit('console:register', { workerId: _workerId, workerLabel: _workerLabel, role: 'worker' });
    _emitBridgeStatus();
  };
  _bridgeSocket.on('connect', _socketHandlers.connect);
  if (typeof _bridgeSocket.on === 'function') {
    _socketHandlers.disconnect = () => {
      for (const [reqId, pending] of _pendingEvals) {
        clearTimeout(pending.timeoutHandle);
        pending.reject(new Error('socket_disconnected'));
      }
      _pendingEvals.clear();
      _emitBridgeStatus();
    };
    _bridgeSocket.on('disconnect', _socketHandlers.disconnect);
  }
  // If already connected, register immediately
  if (_bridgeSocket.connected) {
    _bridgeSocket.emit('console:register', { workerId: _workerId, workerLabel: _workerLabel, role: 'worker' });
  }

  _patchConsole();
  _hookErrors();
  _hookEval();
  _bridgeActive = true;
  _emitBridgeStatus();

  return { socket: _bridgeSocket, workerId: _workerId, destroy: destroyConsoleBridge };
}

/**
 * Tear down the bridge — restore original console methods.
 */
export function destroyConsoleBridge() {
  if (!_bridgeActive) return;
  for (const [reqId, pending] of _pendingEvals) {
    clearTimeout(pending.timeoutHandle);
    pending.reject(new Error('bridge_destroyed'));
  }
  _pendingEvals.clear();
  for (const level of LEVELS) {
    if (_originals[level]) console[level] = _originals[level];
  }
  if (_bridgeSocket && typeof _bridgeSocket.off === 'function') {
    if (_socketHandlers.connect) _bridgeSocket.off('connect', _socketHandlers.connect);
    if (_socketHandlers.disconnect) _bridgeSocket.off('disconnect', _socketHandlers.disconnect);
    if (_socketHandlers.eval) _bridgeSocket.off('console:eval', _socketHandlers.eval);
    if (_socketHandlers.evalCancel) _bridgeSocket.off('console:evalCancel', _socketHandlers.evalCancel);
  }
  if (_ownsSocket && _bridgeSocket && typeof _bridgeSocket.disconnect === 'function') {
    try { _bridgeSocket.disconnect(); } catch (_) {}
  }
  if (_windowHandlers.error) window.removeEventListener?.('error', _windowHandlers.error);
  if (_windowHandlers.unhandledrejection) {
    window.removeEventListener?.('unhandledrejection', _windowHandlers.unhandledrejection);
  }
  _originals = {};
  _socketHandlers = {};
  _windowHandlers = {};
  _bridgeSocket = null;
  _ownsSocket = false;
  _bridgeActive = false;
  _workerId = null;
  _workerLabel = null;
  _emitBridgeStatus();
}
