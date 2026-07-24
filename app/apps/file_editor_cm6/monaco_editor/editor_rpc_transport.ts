import {
  EDITOR_RPC_EVENT,
  EditorRpcMethodName,
  EditorRpcNotificationName,
  JsonRpcId,
  buildEditorRpcNotificationEnvelope,
  buildEditorRpcRequestEnvelope,
  isJsonRpcErrorEnvelope,
  isJsonRpcNotificationEnvelope,
  isJsonRpcSuccessEnvelope,
} from './editor_rpc_contract.ts';
import { messagePackRpcWireCodec } from '../src/rpc/codec.ts';

interface EditorRpcSocketLike {
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

interface EditorRpcTransportDeps {
  getSocket(): EditorRpcSocketLike | null;
  setTimeoutFn(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
  onProtocolError?(error: unknown): void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function idKey(id: JsonRpcId): string {
  return String(id);
}

function clearSocketReplayBuffer(socket: EditorRpcSocketLike | null | undefined): void {
  if (Array.isArray(socket?.sendBuffer)) socket.sendBuffer.length = 0;
}

export function createEditorRpcTransport(deps: EditorRpcTransportDeps): {
  attachSocket(socket: EditorRpcSocketLike): void;
  isConnected(): boolean;
  call(method: EditorRpcMethodName, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  notify(method: EditorRpcMethodName | EditorRpcNotificationName, params: Record<string, unknown>): boolean;
  onNotification(method: EditorRpcNotificationName, handler: (params: Record<string, unknown>) => void): () => void;
  getPendingRequests(): Map<string, PendingRequestEntry>;
} {
  const pending = new Map<string, PendingRequestEntry>();
  const notificationHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  let nextId = 1;
  let attached = false;

  function rejectAllPending(message: string): void {
    for (const [key, entry] of pending.entries()) {
      deps.clearTimeoutFn(entry.timer);
      pending.delete(key);
      entry.reject(new Error(message));
    }
  }

  function handleEnvelope(message: unknown): void {
    if (isJsonRpcSuccessEnvelope(message)) {
      const key = idKey(message.id);
      const entry = pending.get(key);
      if (!entry) return;
      deps.clearTimeoutFn(entry.timer);
      pending.delete(key);
      entry.resolve(message.result);
      return;
    }

    if (isJsonRpcErrorEnvelope(message)) {
      const key = message.id == null ? '' : idKey(message.id);
      const entry = key ? pending.get(key) : null;
      if (entry) {
        deps.clearTimeoutFn(entry.timer);
        pending.delete(key);
        entry.reject(new Error(message.error.message || 'editor rpc error'));
      }
      return;
    }

    if (isJsonRpcNotificationEnvelope(message)) {
      const handlers = notificationHandlers.get(message.method);
      if (!handlers || !handlers.size) return;
      const params = asRecord(message.params) || {};
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

  function attachSocket(socket: EditorRpcSocketLike): void {
    if (attached || !socket || typeof socket.on !== 'function') return;
    attached = true;
    socket.on(EDITOR_RPC_EVENT, handleMessage);
    socket.on('disconnect', () => {
      clearSocketReplayBuffer(socket);
      rejectAllPending('editor rpc socket disconnected');
    });
    socket.on('connect_error', () => {
      clearSocketReplayBuffer(socket);
      rejectAllPending('editor rpc socket connect error');
    });
  }

  function isConnected(): boolean {
    const socket = deps.getSocket();
    return !!(socket && socket.connected);
  }

  function call(
    method: EditorRpcMethodName,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    const timeoutMs = opts && Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 12000;
    const requestId: JsonRpcId = `editor_rpc_${nextId++}_${Date.now()}`;
    const socket = deps.getSocket();
    const emit = socket && typeof socket.emit === 'function' ? socket.emit.bind(socket) : null;
    if (!socket || !socket.connected || !emit) {
      return Promise.reject(new Error('editor rpc socket not connected'));
    }
    return new Promise((resolve, reject) => {
      const timer = deps.setTimeoutFn(() => {
        const key = idKey(requestId);
        const entry = pending.get(key);
        if (!entry) return;
        pending.delete(key);
        reject(new Error(`editor rpc timeout: ${method}`));
      }, timeoutMs);
      pending.set(idKey(requestId), { timer, resolve, reject, method });
      let wirePayload: unknown;
      try {
        wirePayload = messagePackRpcWireCodec.encode(buildEditorRpcRequestEnvelope(requestId, method, params || {}));
      } catch (error) {
        deps.clearTimeoutFn(timer);
        pending.delete(idKey(requestId));
        deps.onProtocolError?.(error);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      emit(EDITOR_RPC_EVENT, wirePayload);
    });
  }

  function notify(method: EditorRpcMethodName | EditorRpcNotificationName, params: Record<string, unknown>): boolean {
    const socket = deps.getSocket();
    const emit = socket?.volatile && typeof socket.volatile.emit === 'function'
      ? socket.volatile.emit.bind(socket.volatile)
      : null;
    if (!socket || !socket.connected || !emit) return false;
    try {
      emit(EDITOR_RPC_EVENT, messagePackRpcWireCodec.encode(buildEditorRpcNotificationEnvelope(method, params || {})));
    } catch (error) {
      deps.onProtocolError?.(error);
      return false;
    }
    return true;
  }

  function onNotification(method: EditorRpcNotificationName, handler: (params: Record<string, unknown>) => void): () => void {
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
  };
}
