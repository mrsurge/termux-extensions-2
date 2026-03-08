export function clearDraftDiffZonesState(editor, draftZoneIds) {
  try {
    if (!editor || !editor.changeViewZones) {
      return [];
    }
    if (!draftZoneIds || !draftZoneIds.length) return [];
    editor.changeViewZones(function(accessor) {
      for (var i = 0; i < draftZoneIds.length; i++) {
        try { accessor.removeZone(draftZoneIds[i]); } catch (_) {}
      }
    });
  } catch (_) {}
  return [];
}
