import { createSocketIoJsonRpcClient, type IoFactory, type JsonObject } from '../../rpc/transport.ts';
import {
  UI_IPC_RPC_METHODS,
  UI_IPC_RPC_NAMESPACE,
  parseUiIpcRpcNotification,
  type UiIpcRpcMethod,
  type UiIpcRpcNotificationMethod,
} from '../../ui_ipc/rpc_contract.ts';

export interface CreateUiIpcRpcConnectionOptions {
  ensureSocketIoLoaded: () => Promise<IoFactory | null | undefined>;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onConnectError?: (error: unknown) => void;
  onNotification: (method: UiIpcRpcNotificationMethod, params: JsonObject) => void;
}

export function createUiIpcRpcConnection(options: CreateUiIpcRpcConnectionOptions) {
  const client = createSocketIoJsonRpcClient({
    namespace: UI_IPC_RPC_NAMESPACE,
    path: '/ui_ipc_ws/socket.io',
    query: { app_id: 'file_editor_cm6', source: 'main_page' },
    requestIdPrefix: 'ui_ipc',
    ensureSocketIoLoaded: options.ensureSocketIoLoaded,
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    onConnectError: options.onConnectError,
    onNotification: (notification) => {
      const parsedNotification = parseUiIpcRpcNotification(notification);
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
    notify(method: UiIpcRpcNotificationMethod, params: JsonObject = {}): void {
      client.notify(method, params);
    },
    request<TResult = JsonObject>(
      method: UiIpcRpcMethod,
      params: JsonObject = {},
      timeoutMs = 8000,
    ): Promise<TResult> {
      return client.request<TResult>(method, params, timeoutMs);
    },
    methods: UI_IPC_RPC_METHODS,
  };
}
