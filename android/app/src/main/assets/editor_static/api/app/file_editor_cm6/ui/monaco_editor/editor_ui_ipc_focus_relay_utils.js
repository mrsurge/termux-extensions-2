export function bindFocusRelay(ed, uiIpcSocket) {
  if (!ed) return null;
  var disposables = [];
  disposables.push(ed.onDidFocusEditorWidget(function() {
    console.log('[focus_relay] onDidFocusEditorWidget fired, socket=' +
      (uiIpcSocket ? (uiIpcSocket.connected ? 'connected' : 'disconnected') : 'null'));
    if (uiIpcSocket) uiIpcSocket.emit('ui_event', { type: 'focus' });
  }));
  disposables.push(ed.onDidBlurEditorWidget(function() {
    console.log('[focus_relay] onDidBlurEditorWidget fired');
    if (uiIpcSocket) uiIpcSocket.emit('ui_event', { type: 'blur' });
  }));
  return { dispose: function() { disposables.forEach(function(d) { d.dispose(); }); } };
}
