export function resnapshotDraftBaseline(diffEditor, monacoRef, model) {
  if (!(diffEditor && diffEditor.getModel && diffEditor.setModel)) return;
  try {
    var dm = diffEditor.getModel();
    if (!(dm && dm.te2FreezeProjection && dm.modifiedBaseline)) return;
    var mvs = null;
    try {
      var me = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
      if (me) mvs = me.saveViewState();
    } catch (_) {}
    var freshContent = model.getValue ? model.getValue() : '';
    var freshLang = model.getLanguageId ? model.getLanguageId() : 'plaintext';
    var freshBaseline = monacoRef.editor.createModel(freshContent, freshLang);
    diffEditor.setModel({
      original: dm.original,
      modified: dm.modified,
      modifiedBaseline: freshBaseline,
      te2AutosaveMode: false,
      te2FreezeProjection: true,
    });
    try {
      if (mvs) {
        var me2 = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
        if (me2) me2.restoreViewState(mvs);
      }
    } catch (_) {}
    console.log('[GitBaselines] draft save: re-snapshotted modifiedBaseline');
  } catch (e) {
    console.warn('[GitBaselines] draft save baseline re-snapshot failed', e);
  }
}
