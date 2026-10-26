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

import { objectValue } from './ui/settings-contracts.ts';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
interface BridgeSocket {
  connected?: boolean;
  emit(event: string, payload: Record<string, unknown>): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off?(event: string, handler: (payload: unknown) => void): void;
  disconnect?(): void;
  volatile?: { emit(event: string, payload: Record<string, unknown>): void };
}
interface BridgeOptions {
  socket?: BridgeSocket;
  workerId?: string;
  workerLabel?: string;
  uniquePerWindow?: boolean;
  workerIdPrefix?: string;
  workerOwnerLength?: number;
  baseUrl?: string;
  socketPath?: string;
  namespace?: string;
  forwardLogs?: boolean;
  qualifiedIdentity?: boolean;
  clientInstanceId?: string;
  prepare?: () => Promise<unknown>;
}
interface BridgeHandle {
  socket: BridgeSocket | null;
  workerId: string | null;
  destroy: () => void;
}
declare global {
  interface Window {
    __te2BuiltinConsoleEnabled?: boolean;
    te2DebugConsole?: {
      enable(): Promise<BridgeHandle | null>;
      disable(): void;
      status: typeof getConsoleBridgeStatus;
    };
  }
}
const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
let _bridgeActive = false;
let _bridgeSocket: BridgeSocket | null = null;
let _workerId: string | null = null;
let _workerLabel: string | null = null;
let _originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};
const _pendingEvals = new Map<string, { timeoutHandle: ReturnType<typeof setTimeout>; reject: (reason: Error) => void }>();
let _ownsSocket = false;
let _socketHandlers: Partial<Record<'eval' | 'evalCancel' | 'registered' | 'connect' | 'disconnect', (payload: unknown) => void>> = {};
let _windowHandlers: { error?: (event: ErrorEvent) => void; unhandledrejection?: (event: PromiseRejectionEvent) => void } = {};
let _logsForwarded = false;

export function getConsoleBridgeStatus() {
  return {
    active: _bridgeActive,
    connected: !!(_bridgeSocket && _bridgeSocket.connected),
    workerId: _workerId,
    workerLabel: _workerLabel,
    forwarding: _logsForwarded,
  };
}

function _emitBridgeStatus() {
  try {
    window.dispatchEvent(new CustomEvent('te2:console-bridge-status', {
      detail: getConsoleBridgeStatus(),
    }));
  } catch (_) {}
}

function _safeSerialize(x: unknown) {
  const seen = new WeakSet();
  return JSON.stringify(x, (_k: string, v: unknown) => {
    if (typeof v === 'bigint') return `BigInt(${v.toString()})`;
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  });
}

function _serializeArg(a: unknown): unknown {
  if (a === undefined) return null;
  try { const encoded = _safeSerialize(a); return encoded === undefined ? String(a) : JSON.parse(encoded) as unknown; }
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

function _sanitizeWorkerLabel(value: string) {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-zA-Z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'worker';
}

function _socketEndpoint(baseUrl?: string, namespace?: string) {
  const normalizedNamespace = String(namespace || '/te2_console').startsWith('/')
    ? String(namespace || '/te2_console')
    : `/${String(namespace || '/te2_console')}`;
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  return normalizedBase ? `${normalizedBase}${normalizedNamespace}` : normalizedNamespace;
}

function _perWindowWorkerId(label: string, prefix = '', ownerLength = 8) {
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

function _emitLog(level: ConsoleLevel, rawArgs: unknown[]) {
  if (!_logsForwarded || !_bridgeSocket || !_bridgeSocket.connected) return;
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
    const original: (...args: unknown[]) => void = console[level].bind(console);
    _originals[level] = original;
    console[level] = (...args: unknown[]) => {
      try { _emitLog(level, args); } catch (_) { /* never break caller */ }
      original(...args);
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

function _cleanupEval(reqId: string) {
  const pending = _pendingEvals.get(reqId);
  if (pending) {
    clearTimeout(pending.timeoutHandle);
    _pendingEvals.delete(reqId);
  }
}

function _hookEval() {
  if (!_bridgeSocket) return;
  _socketHandlers.eval = async (payload: unknown) => {
    const { reqId, code, timeoutSeconds } = objectValue(payload);
    if (typeof reqId !== 'string' || typeof code !== 'string') return;
    const socket = _bridgeSocket;
    if (!socket) return;
    const timeoutMs = (typeof timeoutSeconds === 'number' && timeoutSeconds > 0 ? timeoutSeconds : 20) * 1000 + 2000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutHandle = setTimeout(
        () => reject(new Error('eval_timeout')),
        timeoutMs,
      );
      _pendingEvals.set(reqId, { timeoutHandle, reject });
    });
    try {
      let result: unknown;
      try { result = (0, eval)(code); }
      catch (synErr) {
        if (synErr instanceof SyntaxError) result = (0, eval)('(' + code + ')');
        else throw synErr;
      }
      const value = await Promise.race([Promise.resolve(result), timeoutPromise]);
      _cleanupEval(reqId);
      socket.emit('console:evalResult', {
        workerId: _workerId,
        reqId,
        ok: true,
        value: _serializeArg(value),
      });
    } catch (err) {
      _cleanupEval(reqId);
      const errorType = err instanceof Error && err.message === 'eval_timeout' ? 'eval_timeout'
        : err instanceof Error && err.message === 'eval_cancelled' ? 'eval_cancelled'
        : undefined;
      socket.emit('console:evalResult', {
        workerId: _workerId,
        reqId,
        ok: false,
        error: _serializeArg(err),
        ...(errorType ? { errorType } : {}),
      });
    }
  };
  _socketHandlers.evalCancel = (payload: unknown) => {
    const { reqId } = objectValue(payload);
    if (typeof reqId !== 'string') return;
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
 * Console bridge options (also accepted by the built-in wrapper).
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
 * @param {boolean} [opts.forwardLogs=true] Forward automatic console/errors, independently of registration/eval.
 * @returns {{ socket, workerId, destroy }}
 */
// Built-in callers opt into this policy; the agnostic API below stays unchanged.
// Registration, identity and eval stay connected; only automatic forwarding is
// optional. The explicit logging override is page-lifetime only.
let _builtinOptions: BridgeOptions | null = null;
let _builtinOverride: boolean | null = null;
let _builtinPromise: Promise<BridgeHandle | null> | null = null;

function _builtinEnabled() {
  return _builtinOverride ?? (window.__te2BuiltinConsoleEnabled === true);
}

function _startBuiltinBridge() {
  if (!_builtinOptions) return Promise.resolve(null);
  if (_builtinPromise) return _builtinPromise;
  const pending = Promise.resolve().then(async () => {
    await _builtinOptions?.prepare?.();
    return initConsoleBridge({ ..._builtinOptions, forwardLogs: _builtinEnabled() });
  });
  _builtinPromise = pending;
  // Clear without leaving a second rejected promise unobserved.
  void pending.then(
    () => { if (_builtinPromise === pending) _builtinPromise = null; },
    () => { if (_builtinPromise === pending) _builtinPromise = null; },
  );
  return pending;
}

/**
 * Register a first-party bridge and its optional lazy dependency loader.
 * Native/local DevTools may explicitly await window.te2DebugConsole.enable().
 * disable() stops logging, not registration/eval; reload resets the override.
 * @param {object} [opts]
 * @param {() => Promise<void>} [opts.prepare]
 */
export function initBuiltinConsoleBridge(opts: BridgeOptions = {}) {
  _builtinOptions = opts;
  window.te2DebugConsole = Object.freeze({
    enable() {
      _builtinOverride = true;
      return _startBuiltinBridge();
    },
    disable() {
      _builtinOverride = false;
      _setLogForwarding(false);
    },
    status: getConsoleBridgeStatus,
  });
  return _startBuiltinBridge();
}

export function initConsoleBridge(opts: BridgeOptions = {}): BridgeHandle | null {
  if (_bridgeActive) {
    if (typeof opts.forwardLogs === 'boolean') _setLogForwarding(opts.forwardLogs);
    return { socket: _bridgeSocket, workerId: _workerId, destroy: destroyConsoleBridge };
  }

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
    const candidate = io(_socketEndpoint(opts.baseUrl, opts.namespace), {
      path: opts.socketPath || '/te2_console_ws/socket.io',
      transports: ['websocket'],
      query: {
        app_id: 'code_te2',
        source: 'console_bridge',
        workerId: _workerId,
        workerLabel: _workerLabel,
      },
    });
    if (!candidate || typeof candidate.on !== 'function' || typeof candidate.emit !== 'function') return null;
    _bridgeSocket = {
      get connected() { return candidate.connected; },
      emit: (event, payload) => candidate.emit?.(event, payload),
      on: (event, handler) => candidate.on?.(event, handler),
      off: (event, handler) => candidate.off?.(event, handler),
      disconnect: () => candidate.disconnect?.(),
      volatile: candidate.volatile,
    };
    _ownsSocket = true;
  }

  const query = new URLSearchParams(window.location?.search || '');
  const sidebarWindowId = query.get('sidebarWindowId') || '';
  if (sidebarWindowId) _workerId = sidebarWindowId;
  const requestedWorkerId = _workerId;
  const registration = {
    workerId: requestedWorkerId, workerLabel: _workerLabel, role: 'worker',
    compactIdentity: true,
    qualifiedIdentity: opts.qualifiedIdentity === true || !!sidebarWindowId,
    clientInstanceId: opts.clientInstanceId || query.get('clientInstanceId') || '',
    presentationId: query.get('presentationId') || '',
  };
  _socketHandlers.registered = (payload: unknown) => {
    const data = objectValue(payload);
    if (data?.requestedWorkerId !== requestedWorkerId || typeof data.workerId !== 'string') return;
    _workerId = data.workerId;
    _emitBridgeStatus();
  };
  _bridgeSocket.on('console:registered', _socketHandlers.registered);
  // Reconnect uses the original identity, not a retired runtime handle.
  _socketHandlers.connect = () => {
    _bridgeSocket?.emit('console:register', registration);
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
    _bridgeSocket.emit('console:register', registration);
  }

  _hookEval();
  _setLogForwarding(opts.forwardLogs !== false);
  _bridgeActive = true;
  _emitBridgeStatus();

  return { socket: _bridgeSocket, workerId: _workerId, destroy: destroyConsoleBridge };
}

/**
 * Toggle automatic forwarding without touching registration or eval.
 */
function _setLogForwarding(enabled: boolean) {
  if (enabled === _logsForwarded) return;
  _logsForwarded = enabled;
  if (enabled) {
    _patchConsole();
    _hookErrors();
  } else {
    for (const level of LEVELS) {
      if (_originals[level]) console[level] = _originals[level];
    }
    _originals = {};
    if (_windowHandlers.error) window.removeEventListener('error', _windowHandlers.error);
    if (_windowHandlers.unhandledrejection) window.removeEventListener('unhandledrejection', _windowHandlers.unhandledrejection);
    _windowHandlers = {};
  }
  _emitBridgeStatus();
}

export function destroyConsoleBridge() {
  if (!_bridgeActive) return;
  _logsForwarded = false;
  if (_bridgeSocket?.connected) {
    _bridgeSocket.emit('console:unregister', { role: 'worker', workerId: _workerId });
  }
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
    if (_socketHandlers.registered) _bridgeSocket.off('console:registered', _socketHandlers.registered);
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
