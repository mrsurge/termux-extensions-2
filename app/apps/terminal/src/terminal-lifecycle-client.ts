import { decode as decodeMessagePack, encode as encodeMessagePack } from '@msgpack/msgpack';


export const TERMINAL_LIFECYCLE_NAMESPACE = '/terminal';
export const TERMINAL_LIFECYCLE_PATH = '/api/app/terminal/socket.io';
export const TERMINAL_LIFECYCLE_CODEC = 'msgpack-v1';
export const TERMINAL_LIFECYCLE_REQUEST_EVENT = 'terminal_request';
export const TERMINAL_LIFECYCLE_SNAPSHOT_EVENT = 'terminal_snapshot';

export interface TerminalShellStats {
  alive?: boolean;
  uptime?: number;
}

export interface TerminalShellRecord {
  id: string;
  label?: string;
  status?: string;
  cwd?: string;
  stats?: TerminalShellStats;
}

export interface TerminalShellSnapshot {
  type: 'shells.snapshot';
  generation: string;
  revision: number;
  ready: boolean;
  shells: TerminalShellRecord[];
}

export interface TerminalLifecycleSocket {
  connected?: boolean;
  sendBuffer?: unknown[];
  connect(): void;
  disconnect?(): void;
  emit(event: string, payload: Uint8Array, ack: (payload: unknown) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

interface PendingRequest {
  reject(error: Error): void;
  timer: number;
}

interface LifecycleResponse<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function decodeObject(value: unknown): Record<string, unknown> {
  const bytes = asBytes(value);
  if (!bytes) throw new Error('Terminal lifecycle payload was not binary MessagePack');
  const decoded: unknown = decodeMessagePack(bytes);
  if (!isRecord(decoded)) throw new Error('Terminal lifecycle payload was not an object');
  return decoded;
}

function parseSnapshot(value: unknown): TerminalShellSnapshot {
  const payload = decodeObject(value);
  if (
    payload.type !== 'shells.snapshot'
    || typeof payload.generation !== 'string'
    || !payload.generation
    || typeof payload.revision !== 'number'
    || typeof payload.ready !== 'boolean'
    || !Array.isArray(payload.shells)
  ) {
    throw new Error('Invalid Terminal shell snapshot');
  }
  const shells: TerminalShellRecord[] = [];
  for (const item of payload.shells) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) {
      throw new Error('Invalid Terminal shell record');
    }
    shells.push(item as unknown as TerminalShellRecord);
  }
  return {
    type: 'shells.snapshot',
    generation: payload.generation,
    revision: payload.revision,
    ready: payload.ready,
    shells,
  };
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class TerminalLifecycleClient {
  private readonly pending = new Map<string, PendingRequest>();
  private started = false;

  private readonly handleConnect = (): void => {
    this.onConnectionChange(true);
  };

  private readonly handleDisconnect = (reason: unknown): void => {
    const message = typeof reason === 'string' && reason ? reason : 'disconnect';
    this.rejectPending(`Terminal lifecycle socket disconnected: ${message}`);
    if (this.socket.sendBuffer) this.socket.sendBuffer.length = 0;
    this.onConnectionChange(false);
  };

  private readonly handleConnectError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error || 'connection failed');
    this.onError(new Error(`Terminal lifecycle socket unavailable: ${message}`));
  };

  private readonly handleSnapshot = (payload: unknown): void => {
    try {
      this.onSnapshot(parseSnapshot(payload));
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  constructor(
    private readonly socket: TerminalLifecycleSocket,
    private readonly onSnapshot: (snapshot: TerminalShellSnapshot) => void,
    private readonly onConnectionChange: (connected: boolean) => void,
    private readonly onError: (error: Error) => void,
  ) {}

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('connect_error', this.handleConnectError);
    this.socket.on(TERMINAL_LIFECYCLE_SNAPSHOT_EVENT, this.handleSnapshot);
    this.socket.connect();
  }

  public request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
    if (!this.socket.connected) {
      return Promise.reject(new Error('Terminal lifecycle socket is disconnected'));
    }
    const id = requestId();
    const payload = encodeMessagePack({ id, method, params }, { ignoreUndefined: true });
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Terminal lifecycle request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { reject, timer });
      this.socket.emit(TERMINAL_LIFECYCLE_REQUEST_EVENT, payload, (rawResponse) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        this.pending.delete(id);
        try {
          const decoded = decodeObject(rawResponse) as unknown as LifecycleResponse<T>;
          if (decoded.id !== id) throw new Error('Terminal lifecycle response id mismatch');
          if (!decoded.ok) throw new Error(decoded.error || `Terminal lifecycle request failed: ${method}`);
          resolve(decoded.result as T);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  public dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.rejectPending('Terminal lifecycle client disposed');
    this.socket.off?.('connect', this.handleConnect);
    this.socket.off?.('disconnect', this.handleDisconnect);
    this.socket.off?.('connect_error', this.handleConnectError);
    this.socket.off?.(TERMINAL_LIFECYCLE_SNAPSHOT_EVENT, this.handleSnapshot);
    this.socket.disconnect?.();
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

export function decodeTerminalShellSnapshot(payload: unknown): TerminalShellSnapshot {
  return parseSnapshot(payload);
}
