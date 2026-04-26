export interface TransportPendingOptions {
  timeoutMs?: number;
  timeoutMessage?: string;
  timeoutResult?: unknown;
  accept?: (message: Record<string, unknown>) => boolean;
}

export interface SentRequestOwnerLike {
  allocReqId: () => number;
  trackSent: (req: number, rpcId: number, method: string) => void;
  createPromise: (req: number, options: {
    timeoutMs: number;
    timeoutMessage: string;
    timeoutResult?: unknown;
    accept?: (message: Record<string, unknown>) => boolean;
  }) => Promise<unknown>;
  rejectAll: (error: Error) => void;
  clear: () => void;
}

export interface TransportRefs {
  extProtocol: { send: (payload: unknown) => void; dispose?: () => void } | null;
  mgmtProtocol: { dispose?: () => void } | null;
  watcherSub: { dispose?: () => void } | null;
  mgmtIpc: { dispose?: () => void } | null;
}

export interface DisconnectState {
  connected: boolean;
  ready: boolean;
  mgmtConnected: boolean;
  extConnected: boolean;
  activePath: string | null;
  activeUri: string | null;
  activeLanguageId: string | null;
  lastOpenTs: number | null;
  docSymbolsProviderHandle: number | null;
  hoverProviderHandle: number | null;
}

export interface TransportRuntime {
  requestOwner: SentRequestOwnerLike;
  refs: TransportRefs;
  state: DisconnectState;
  wrapPayload: (payload: Uint8Array) => unknown;
  encodeJsonRequest: (input: { req: number; rpcId: number; method: string; args?: readonly unknown[] | null; cancellable?: boolean }) => Uint8Array;
  encodeMixedRequest: (input: { req: number; rpcId: number; method: string; args?: readonly unknown[] | null; cancellable?: boolean }) => Uint8Array;
  onEvent: (payload: Record<string, unknown>) => void;
  nowMs: () => number;
  setWatcherSub: (value: { dispose?: () => void } | null) => void;
  setMgmtIpc: (value: { dispose?: () => void } | null) => void;
  setMgmtProtocol: (value: { dispose?: () => void } | null) => void;
  setExtProtocol: (value: { send: (payload: unknown) => void; dispose?: () => void } | null) => void;
  resetHandshake: () => void;
  resetConnecting: () => void;
  clearLanguageCatalogCache: () => void;
}

function isTerminalReply(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  return (type === 7 || type === 8 || type === 9 || type === 10 || type === 11 || type === 12) && type !== 12;
}

export function allocExtReqId(runtime: TransportRuntime): number {
  return runtime.requestOwner.allocReqId();
}

export function trackExtSent(runtime: TransportRuntime, req: number, rpcId: number, method: string): void {
  runtime.requestOwner.trackSent(req, rpcId, method);
}

export function createExtPending(
  runtime: TransportRuntime,
  req: number,
  options: {
    timeoutMs: number;
    timeoutMessage: string;
    timeoutResult?: unknown;
    accept?: (message: Record<string, unknown>) => boolean;
  },
): Promise<unknown> {
  return runtime.requestOwner.createPromise(req, options);
}

export function sendExt(
  runtime: TransportRuntime,
  rpcId: number,
  method: string,
  args: unknown[],
  cancellable = false,
): number {
  const protocol = runtime.refs.extProtocol;
  if (!protocol) throw new Error("not connected");
  const req = allocExtReqId(runtime);
  const payload = runtime.encodeJsonRequest({ req, rpcId, method, args, cancellable });
  protocol.send(runtime.wrapPayload(payload));
  trackExtSent(runtime, req, rpcId, method);
  try {
    runtime.onEvent({ type: "ext/send", ts_ms: runtime.nowMs(), req, rpcId, method });
  } catch {
    // event fanout best effort
  }
  return req;
}

export function sendExtPending(
  runtime: TransportRuntime,
  rpcId: number,
  method: string,
  args: unknown[],
  cancellable = false,
  pendingOptions: TransportPendingOptions = {},
  eventExtra: Record<string, unknown> = {},
): { req: number; promise: Promise<unknown> } {
  const protocol = runtime.refs.extProtocol;
  if (!protocol) throw new Error("not connected");
  const req = allocExtReqId(runtime);
  const payload = runtime.encodeJsonRequest({ req, rpcId, method, args, cancellable });
  const promise = createExtPending(runtime, req, {
    timeoutMs: 15000,
    timeoutMessage: `timed out waiting for ${method} reply`,
    ...pendingOptions,
  });
  protocol.send(runtime.wrapPayload(payload));
  trackExtSent(runtime, req, rpcId, method);
  try {
    runtime.onEvent({ type: "ext/send", ts_ms: runtime.nowMs(), req, rpcId, method, ...eventExtra });
  } catch {
    // event fanout best effort
  }
  return { req, promise };
}

export function sendExtAwaitTerminalReply(
  runtime: TransportRuntime,
  rpcId: number,
  method: string,
  args: unknown[],
  cancellable = false,
  timeoutMs = 3000,
): { req: number; promise: Promise<unknown> } {
  return sendExtPending(runtime, rpcId, method, args, cancellable, {
    timeoutMs: Math.max(1, Number(timeoutMs) || 3000),
    timeoutMessage: `timed out waiting for ${method} ack`,
    accept: (message) => isTerminalReply(message),
  }, { awaitAck: true });
}

export function sendExtMixed(
  runtime: TransportRuntime,
  rpcId: number,
  method: string,
  args: unknown[],
  cancellable = false,
): number {
  const protocol = runtime.refs.extProtocol;
  if (!protocol) throw new Error("not connected");
  const req = allocExtReqId(runtime);
  const payload = runtime.encodeMixedRequest({ req, rpcId, method, args, cancellable });
  protocol.send(runtime.wrapPayload(payload));
  trackExtSent(runtime, req, rpcId, method);
  try {
    runtime.onEvent({ type: "ext/send", ts_ms: runtime.nowMs(), req, rpcId, method, encoding: "mixed" });
  } catch {
    // event fanout best effort
  }
  return req;
}

export function disconnectSession(runtime: TransportRuntime): void {
  try {
    runtime.requestOwner.rejectAll(new Error("disconnected"));
  } catch {
    // best effort
  }
  try {
    runtime.requestOwner.clear();
  } catch {
    // best effort
  }

  try {
    runtime.refs.watcherSub?.dispose?.();
  } catch {
    // best effort
  }
  runtime.setWatcherSub(null);

  try {
    runtime.refs.mgmtIpc?.dispose?.();
  } catch {
    // best effort
  }
  runtime.setMgmtIpc(null);

  try {
    runtime.refs.mgmtProtocol?.dispose?.();
  } catch {
    // best effort
  }
  try {
    runtime.refs.extProtocol?.dispose?.();
  } catch {
    // best effort
  }
  runtime.setMgmtProtocol(null);
  runtime.setExtProtocol(null);

  runtime.state.connected = false;
  runtime.state.ready = false;
  runtime.state.mgmtConnected = false;
  runtime.state.extConnected = false;
  runtime.state.activePath = null;
  runtime.state.activeUri = null;
  runtime.state.activeLanguageId = null;
  runtime.state.lastOpenTs = null;
  runtime.state.docSymbolsProviderHandle = null;
  runtime.state.hoverProviderHandle = null;

  runtime.resetHandshake();
  runtime.resetConnecting();
  runtime.clearLanguageCatalogCache();
}
