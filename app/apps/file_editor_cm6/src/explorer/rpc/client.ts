import type { ExplorerRpcMethod } from './contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';

export interface ExplorerRpcClient {
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

let explorerRpcClient: ExplorerRpcClient | null = null;

export function installExplorerRpcClient(client: ExplorerRpcClient): void {
  explorerRpcClient = client;
}

function getExplorerRpcClient(): ExplorerRpcClient | null {
  return explorerRpcClient;
}

function primeExplorerRpcConnection(rpc: ExplorerRpcClient): void {
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
