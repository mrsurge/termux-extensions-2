export function bindSaveKeyCommand(ed, monacoRef, uiIpcSocket) {
  if (!ed || !monacoRef) return;
  ed.addCommand(monacoRef.KeyMod.CtrlCmd | monacoRef.KeyCode.KeyS, function() {
    if (uiIpcSocket) uiIpcSocket.emit('ui_event', { type: 'save' });
  });
}
