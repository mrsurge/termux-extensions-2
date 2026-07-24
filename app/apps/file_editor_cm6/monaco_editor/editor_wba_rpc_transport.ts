import { messagePackRpcWireCodec } from '../src/rpc/codec.ts';

export const WBA_RPC_EVENT = 'rpc' as const;

export type WbaRpcId = string | number;

interface WbaRpcSuccessEnvelope {
  jsonrpc: '2.0';
  id: WbaRpcId;
  result: unknown;
}

interface WbaRpcErrorEnvelope {
  jsonrpc: '2.0';
  id: WbaRpcId | null;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface WbaRpcNotificationEnvelope {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface WbaRpcSocketLike {
  connected?: boolean;
  sendBuffer?: unknown[];
  emit?(eventName: string, payload: unknown): void;
  on?(eventName: string, handler: (payload: unknown) => void): void;
  readonly volatile?: {
    emit(eventName: string, payload: unknown): void;
  };
}

interface PendingRequestEntry {
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
  method: string;
}

interface ConnectWaiter {
  timer: ReturnType<typeof setTimeout>;
  resolve(socket: WbaRpcSocketLike): void;
  reject(error: Error): void;
}

interface WbaRpcTransportDeps {
  getSocket(): WbaRpcSocketLike | null;
  setTimeoutFn(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
  onProtocolError?(error: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isSuccessEnvelope(value: unknown): value is WbaRpcSuccessEnvelope {
  return isRecord(value) && value.jsonrpc === '2.0' && Object.prototype.hasOwnProperty.call(value, 'id') && Object.prototype.hasOwnProperty.call(value, 'result');
}

function isErrorEnvelope(value: unknown): value is WbaRpcErrorEnvelope {
  return isRecord(value) && value.jsonrpc === '2.0' && Object.prototype.hasOwnProperty.call(value, 'error');
}

function isNotificationEnvelope(value: unknown): value is WbaRpcNotificationEnvelope {
  return isRecord(value) && value.jsonrpc === '2.0' && typeof value.method === 'string' && !Object.prototype.hasOwnProperty.call(value, 'id');
}

function idKey(id: WbaRpcId): string {
  return String(id);
}

function clearSocketReplayBuffer(socket: WbaRpcSocketLike | null | undefined): void {
  if (Array.isArray(socket?.sendBuffer)) socket.sendBuffer.length = 0;
}

function asParamsRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function editorWorkbenchMethodToWbaMethod(method: string): string | null {
  switch (String(method || '')) {
    case 'open_file':
      return 'vscode.openFile';
    case 'hover':
      return 'vscode.hover';
    case 'completions':
      return 'vscode.completions';
    case 'document_colors':
      return 'vscode.documentColors';
    case 'color_presentations':
      return 'vscode.colorPresentations';
    case 'inlay_hints':
      return 'vscode.inlayHints';
    case 'inlay_hints_resolve':
      return 'vscode.inlayHints.resolve';
    case 'inlay_hints_release':
      return 'vscode.inlayHints.release';
    case 'inline_completions':
      return 'vscode.inlineCompletions';
    case 'inline_completions_free':
      return 'vscode.inlineCompletions.free';
    case 'inline_completions_did_show':
      return 'vscode.inlineCompletions.didShow';
    case 'semantic_tokens':
      return 'vscode.semanticTokens';
    case 'semantic_tokens_legend':
      return 'vscode.semanticTokensLegend';
    case 'semantic_tokens_range':
      return 'vscode.semanticTokensRange';
    case 'symbols':
      return 'vscode.documentSymbols';
    case 'folding_ranges':
      return 'vscode.foldingRanges';
    case 'providers':
      return 'adapter.providers';
    case 'did_change':
      return 'vscode.didChange';
    case 'grammars_list':
      return 'vscode.textmate.grammars.list';
    case 'grammars_load':
      return 'vscode.textmate.grammars.load';
    case 'language_catalog':
      return 'te2.language_catalog';
    default:
      return null;
  }
}

export function createEditorWbaRpcTransport(deps: WbaRpcTransportDeps): {
  attachSocket(socket: WbaRpcSocketLike): void;
  isConnected(): boolean;
  call(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  notify(method: string, params: Record<string, unknown>): boolean;
  onNotification(method: string, handler: (params: Record<string, unknown>) => void): () => void;
  getPendingRequests(): Map<string, PendingRequestEntry>;
  rejectPending(reason?: string): void;
} {
  const pending = new Map<string, PendingRequestEntry>();
  const connectWaiters = new Set<ConnectWaiter>();
  const notificationHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  let nextId = 1;
  let attached = false;
  let hasConnected = false;

  function resolveConnectWaiters(): void {
    const socket = deps.getSocket();
    if (!socket?.connected) return;
    for (const waiter of Array.from(connectWaiters)) {
      deps.clearTimeoutFn(waiter.timer);
      connectWaiters.delete(waiter);
      waiter.resolve(socket);
    }
  }

  function rejectConnectWaiters(message: string): void {
    const error = new Error(message);
    for (const waiter of Array.from(connectWaiters)) {
      deps.clearTimeoutFn(waiter.timer);
      connectWaiters.delete(waiter);
      waiter.reject(error);
    }
  }

  function rejectAllPending(message: string): void {
    for (const [key, entry] of pending.entries()) {
      deps.clearTimeoutFn(entry.timer);
      pending.delete(key);
      entry.reject(new Error(message));
    }
  }

  function handleEnvelope(message: unknown): void {
    if (isSuccessEnvelope(message)) {
      const key = idKey(message.id);
      const entry = pending.get(key);
      if (!entry) return;
      deps.clearTimeoutFn(entry.timer);
      pending.delete(key);
      entry.resolve(message.result);
      return;
    }

    if (isErrorEnvelope(message)) {
      const key = message.id == null ? '' : idKey(message.id);
      const entry = key ? pending.get(key) : null;
      if (entry) {
        deps.clearTimeoutFn(entry.timer);
        pending.delete(key);
        entry.reject(new Error(message.error.message || 'wba rpc error'));
      }
      return;
    }

    if (isNotificationEnvelope(message)) {
      const handlers = notificationHandlers.get(message.method);
      if (!handlers || !handlers.size) return;
      const params = asParamsRecord(message.params);
      handlers.forEach((handler) => {
        try {
          handler(params);
        } catch (_) {}
      });
    }
  }

  function handleMessage(payload: unknown): void {
    let decoded: unknown;
    try {
      decoded = messagePackRpcWireCodec.decode(payload);
    } catch (error) {
      deps.onProtocolError?.(error);
      return;
    }
    if (Array.isArray(decoded)) {
      decoded.forEach(handleEnvelope);
      return;
    }
    handleEnvelope(decoded);
  }

  function attachSocket(socket: WbaRpcSocketLike): void {
    if (attached || !socket || typeof socket.on !== 'function') return;
    attached = true;
    socket.on(WBA_RPC_EVENT, handleMessage);
    const handleConnect = () => {
      hasConnected = true;
      resolveConnectWaiters();
    };
    socket.on('connect', handleConnect);
    socket.on('disconnect', () => {
      clearSocketReplayBuffer(socket);
      rejectConnectWaiters('wba rpc socket disconnected');
      rejectAllPending('wba rpc socket disconnected');
    });
    socket.on('connect_error', () => {
      clearSocketReplayBuffer(socket);
      rejectConnectWaiters('wba rpc socket connect error');
      rejectAllPending('wba rpc socket connect error');
    });
    if (socket.connected) handleConnect();
  }

  function isConnected(): boolean {
    const socket = deps.getSocket();
    return !!(socket && socket.connected);
  }

  function waitForConnected(method: string, timeoutMs: number): Promise<WbaRpcSocketLike> {
    const socket = deps.getSocket();
    if (socket?.connected) return Promise.resolve(socket);
    if (hasConnected) {
      return Promise.reject(new Error(`wba rpc socket disconnected: ${method}`));
    }
    return new Promise((resolve, reject) => {
      const waiter: ConnectWaiter = {
        resolve,
        reject,
        timer: deps.setTimeoutFn(() => {
          connectWaiters.delete(waiter);
          reject(new Error(`wba rpc socket not connected: ${method}`));
        }, timeoutMs),
      };
      connectWaiters.add(waiter);
    });
  }

  async function call(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    const timeoutMs = opts && Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 12000;
    const startedAt = Date.now();
    const socket = await waitForConnected(method, timeoutMs);
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      return Promise.reject(new Error(`wba rpc timeout: ${method}`));
    }
    const requestId: WbaRpcId = `wba_rpc_${nextId++}_${Date.now()}`;
    const emit = socket && typeof socket.emit === 'function' ? socket.emit.bind(socket) : null;
    if (!socket.connected || !emit) {
      return Promise.reject(new Error('wba rpc socket not connected'));
    }
    return new Promise((resolve, reject) => {
      const timer = deps.setTimeoutFn(() => {
        const key = idKey(requestId);
        const entry = pending.get(key);
        if (!entry) return;
        pending.delete(key);
        reject(new Error(`wba rpc timeout: ${method}`));
      }, remainingMs);
      pending.set(idKey(requestId), { timer, resolve, reject, method });
      try {
        emit(
          WBA_RPC_EVENT,
          messagePackRpcWireCodec.encode({
            jsonrpc: '2.0',
            id: requestId,
            method,
            params: params || {},
          }),
        );
      } catch (error) {
        deps.clearTimeoutFn(timer);
        pending.delete(idKey(requestId));
        deps.onProtocolError?.(error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function notify(method: string, params: Record<string, unknown>): boolean {
    const socket = deps.getSocket();
    const emit = socket?.volatile && typeof socket.volatile.emit === 'function'
      ? socket.volatile.emit.bind(socket.volatile)
      : null;
    if (!socket || !socket.connected || !emit) return false;
    try {
      emit(
        WBA_RPC_EVENT,
        messagePackRpcWireCodec.encode({
          jsonrpc: '2.0',
          method,
          params: params || {},
        }),
      );
    } catch (error) {
      deps.onProtocolError?.(error);
      return false;
    }
    return true;
  }

  function onNotification(method: string, handler: (params: Record<string, unknown>) => void): () => void {
    let handlers = notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = notificationHandlers.get(method);
      if (!current) return;
      current.delete(handler);
      if (!current.size) notificationHandlers.delete(method);
    };
  }

  return {
    attachSocket,
    isConnected,
    call,
    notify,
    onNotification,
    getPendingRequests: () => pending,
    rejectPending: (reason?: string) => rejectAllPending(String(reason || 'wba rpc pending requests rejected')),
  };
}
