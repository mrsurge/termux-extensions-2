import type { ExplorerRpcMethod } from './contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';

interface ExplorerRpcWindowClient {
  connect(): Promise<void>;
  reconnect(): void;
  isConnected(): boolean;
  notify(method: ExplorerRpcMethod, params?: JsonObject): void;
  request<TResult extends JsonObject = JsonObject>(
    method: ExplorerRpcMethod,
    params?: JsonObject,
    timeoutMs?: number,
  ): Promise<TResult>;
}

function getExplorerRpcClient(): ExplorerRpcWindowClient | null {
  const rpc = window.__explorerRpc as ExplorerRpcWindowClient | undefined;
  if (!rpc) return null;
  if (typeof rpc.notify !== 'function') return null;
  if (typeof rpc.request !== 'function') return null;
  if (typeof rpc.reconnect !== 'function') return null;
  return rpc;
}

function primeExplorerRpcConnection(rpc: ExplorerRpcWindowClient): void {
  if (typeof rpc.isConnected === 'function' && !rpc.isConnected()) {
    rpc.reconnect();
  }
}

export function isExplorerRpcAvailable(): boolean {
  return getExplorerRpcClient() !== null;
}

export function notifyExplorerRpc(
  method: ExplorerRpcMethod,
  params: JsonObject = {},
): boolean {
  const rpc = getExplorerRpcClient();
  if (!rpc) return false;
  primeExplorerRpcConnection(rpc);
  rpc.notify(method, params);
  return true;
}

export function requestExplorerRpc<TResult extends JsonObject = JsonObject>(
  method: ExplorerRpcMethod,
  params: JsonObject = {},
  timeoutMs = 8000,
): Promise<TResult> {
  const rpc = getExplorerRpcClient();
  if (!rpc) {
    return Promise.reject(new Error('Explorer connection unavailable.'));
  }
  primeExplorerRpcConnection(rpc);
  return rpc.request<TResult>(method, params, timeoutMs);
}
