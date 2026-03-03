export function connectUiIpcSocket(ioRef) {
  if (!ioRef) return null;
  return ioRef('/ui_ipc', {
    path: '/ui_ipc_ws/socket.io',
    transports: ['websocket'],
    query: { app_id: 'file_editor_cm6', source: 'editor_iframe' },
  });
}
