export function clearDraftDiffDecorationsState(opts) {
  var o = opts || {};
  try {
    if (typeof o.clearZonesFn === 'function') o.clearZonesFn();
    if (o.draftDecoCollection && o.draftDecoCollection.clear) {
      o.draftDecoCollection.clear();
    } else if (o.editor && o.editor.deltaDecorations) {
      o.draftDecoIds = o.editor.deltaDecorations(o.draftDecoIds || [], []);
    }
  } catch (_) {}
  if (typeof o.setDebugDraftFn === 'function') o.setDebugDraftFn(null);
  return {
    draftDecoIds: o.draftDecoIds || [],
    lastDraftZones: null,
  };
}
