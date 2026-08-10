interface DraftDecorationStateOptions {
  clearZonesFn?: () => void;
  draftDecoCollection?: { clear?(): void } | null;
  editor?: { deltaDecorations?(oldDecorations: unknown[], newDecorations: unknown[]): unknown[] } | null;
  draftDecoIds?: unknown[];
  setDebugDraftFn?: (value: string | null) => void;
}

export function clearDraftDiffDecorationsState(
  opts: DraftDecorationStateOptions | null | undefined,
): { draftDecoIds: unknown[]; lastDraftZones: null } {
  const options = opts || {};
  try {
    if (typeof options.clearZonesFn === 'function') options.clearZonesFn();
    if (options.draftDecoCollection && options.draftDecoCollection.clear) {
      options.draftDecoCollection.clear();
    } else if (options.editor && options.editor.deltaDecorations) {
      options.draftDecoIds = options.editor.deltaDecorations(options.draftDecoIds || [], []);
    }
  } catch (_) {}
  if (typeof options.setDebugDraftFn === 'function') options.setDebugDraftFn(null);
  return {
    draftDecoIds: options.draftDecoIds || [],
    lastDraftZones: null,
  };
}
