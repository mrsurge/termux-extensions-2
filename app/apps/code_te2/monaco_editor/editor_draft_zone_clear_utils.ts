export function clearDraftDiffZonesState(
  editor: unknown,
  draftZoneIds: unknown[] | null | undefined,
): unknown[] {
  try {
    const editorInstance = editor as { changeViewZones?(callback: (accessor: MonacoRuntimeViewZoneAccessorLike) => void): void } | null;
    if (!editorInstance || !editorInstance.changeViewZones) return [];
    if (!draftZoneIds || !draftZoneIds.length) return [];
    editorInstance.changeViewZones((accessor: MonacoRuntimeViewZoneAccessorLike) => {
      for (let index = 0; index < draftZoneIds.length; index += 1) {
        const zoneId = draftZoneIds[index];
        if (typeof zoneId !== 'string' && typeof zoneId !== 'number') continue;
        try { accessor.removeZone && accessor.removeZone(zoneId); } catch (_) {}
      }
    });
  } catch (_) {}
  return [];
}
