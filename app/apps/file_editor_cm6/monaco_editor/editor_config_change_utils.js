export function onEditorConfigChanged(ed, opts) {
  var o = opts || {};
  if (typeof o.syncReadOnlyInputModeFn === 'function') o.syncReadOnlyInputModeFn(ed);
  try {
    if (!ed) return;
    var ro = ed.getOption(o.monacoRef.editor.EditorOption.readOnly);
    if (o.lastKnownReadOnly !== null && ro !== o.lastKnownReadOnly) {
      o.fetchFn('/api/app/file_editor_cm6/editor/update_preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'readOnly', value: ro })
      }).catch(function(e) { console.warn('[Monaco] readOnly pref save failed', e); });
    }
    if (typeof o.setLastKnownReadOnlyFn === 'function') o.setLastKnownReadOnlyFn(ro);
  } catch (_) {}
}
