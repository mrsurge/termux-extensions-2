export function bindFocusRelay(ed, getSocket) {
  if (!ed) return null;
  var disposables = [];
  disposables.push(ed.onDidFocusEditorWidget(function() {
    var sock = typeof getSocket === 'function' ? getSocket() : getSocket;
    console.log('[focus_relay] onDidFocusEditorWidget fired, socket=' +
      (sock ? (sock.connected ? 'connected' : 'disconnected') : 'null'));
    if (sock) sock.emit('ui_event', { type: 'focus' });
  }));
  disposables.push(ed.onDidBlurEditorWidget(function() {
    var sock = typeof getSocket === 'function' ? getSocket() : getSocket;
    console.log('[focus_relay] onDidBlurEditorWidget fired, socket=' +
      (sock ? (sock.connected ? 'connected' : 'disconnected') : 'null'));
    if (sock) sock.emit('ui_event', { type: 'blur' });
  }));
  return { dispose: function() { disposables.forEach(function(d) { d.dispose(); }); } };
}
