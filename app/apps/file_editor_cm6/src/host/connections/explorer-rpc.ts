import {
  EXPLORER_RPC_NAMESPACE,
  parseExplorerRpcNotification,
  type ExplorerRpcMethod,
  type ExplorerRpcNotificationMethod,
} from '../../explorer/rpc/contract.ts';
import {
  createSocketIoJsonRpcClient,
  type IoFactory,
  type JsonObject,
} from '../../rpc/transport.ts';

export interface CreateExplorerRpcConnectionOptions {
  ensureSocketIoLoaded: () => Promise<IoFactory | null | undefined>;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onConnectError?: (error: unknown) => void;
  onNotification: (method: ExplorerRpcNotificationMethod, params: JsonObject) => void;
}

export function createExplorerRpcConnection(options: CreateExplorerRpcConnectionOptions) {
  const client = createSocketIoJsonRpcClient({
    namespace: EXPLORER_RPC_NAMESPACE,
    path: '/explorer_ws/socket.io',
    query: { app_id: 'file_editor_cm6' },
    requestIdPrefix: 'explorer',
    ensureSocketIoLoaded: options.ensureSocketIoLoaded,
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    onConnectError: options.onConnectError,
    onNotification: (notification) => {
      const parsedNotification = parseExplorerRpcNotification(notification);
      if (!parsedNotification) return;
      options.onNotification(parsedNotification.method, parsedNotification.params);
    },
  });

  return {
    connect(): Promise<void> {
      return client.connect();
    },
    reconnect(): void {
      client.reconnect();
    },
    isConnected(): boolean {
      return client.isConnected();
    },
    notify(method: ExplorerRpcMethod, params: JsonObject = {}): void {
      client.notify(method, params);
    },
    request<TResult extends JsonObject = JsonObject>(
      method: ExplorerRpcMethod,
      params: JsonObject = {},
      timeoutMs = 8000,
    ): Promise<TResult> {
      return client.request<TResult>(method, params, timeoutMs);
    },
  };
}
