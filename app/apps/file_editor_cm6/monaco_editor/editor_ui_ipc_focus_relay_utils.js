export function bindFocusRelay(ed, uiIpcSocket) {
  if (!ed) return null;
  return ed.onDidFocusEditorWidget(function() {
    console.log('[focus_relay] onDidFocusEditorWidget fired, socket=' +
      (uiIpcSocket ? (uiIpcSocket.connected ? 'connected' : 'disconnected') : 'null'));
    if (uiIpcSocket) uiIpcSocket.emit('ui_event', { type: 'focus' });
  });
}
