export function connectUiIpcSocket(
  ioRef: MonacoSocketIoLike | null | undefined,
): MonacoRuntimeSocketLike | null {
  if (!ioRef) return null;
  return ioRef('/ui_ipc', {
    path: '/ui_ipc_ws/socket.io',
    transports: ['websocket'],
    query: { app_id: 'file_editor_cm6', source: 'editor_iframe' },
  });
}

export function connectTe2ConsoleSocket(
  ioRef: MonacoSocketIoLike | null | undefined,
  workerId: string,
): MonacoRuntimeSocketLike | null {
  if (!ioRef) return null;
  return ioRef('/te2_console', {
    path: '/te2_console_ws/socket.io',
    transports: ['websocket'],
    query: {
      app_id: 'file_editor_cm6',
      source: 'editor_iframe_console',
      workerId,
    },
  });
}
