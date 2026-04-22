interface MonacoModelLike {
  getValue?(): string;
  getLanguageId?(): string;
}

interface MonacoEditorLike {
  saveViewState?(): unknown;
  restoreViewState?(state: unknown): void;
}

interface DiffModelLike {
  original?: unknown;
  modified?: unknown;
  modifiedBaseline?: unknown;
  te2AutosaveMode?: unknown;
  te2FreezeProjection?: unknown;
}

interface DiffEditorLike {
  getModel?(): DiffModelLike | null;
  setModel?(model: Record<string, unknown>): void;
  getModifiedEditor?(): MonacoEditorLike | null;
}

interface MonacoEditorNamespaceLike {
  createModel?(value: string, language: string): unknown;
}

interface MonacoLike {
  editor?: MonacoEditorNamespaceLike;
}

export function resnapshotDraftBaseline(
  diffEditor: unknown,
  monacoRef: unknown,
  model: unknown,
): void {
  const typedDiffEditor = diffEditor != null && typeof diffEditor === 'object' && !Array.isArray(diffEditor)
    ? diffEditor as DiffEditorLike
    : null;
  const typedMonaco = monacoRef != null && typeof monacoRef === 'object' && !Array.isArray(monacoRef)
    ? monacoRef as MonacoLike
    : null;
  const typedModel = model != null && typeof model === 'object' && !Array.isArray(model)
    ? model as MonacoModelLike
    : null;
  if (!typedDiffEditor || typeof typedDiffEditor.getModel !== 'function' || typeof typedDiffEditor.setModel !== 'function') return;
  try {
    const diffModel = typedDiffEditor.getModel();
    if (!(diffModel && diffModel.te2FreezeProjection && diffModel.modifiedBaseline)) return;
    let modifiedViewState: unknown = null;
    try {
      const modifiedEditor = typedDiffEditor.getModifiedEditor ? typedDiffEditor.getModifiedEditor() : null;
      if (modifiedEditor && typeof modifiedEditor.saveViewState === 'function') modifiedViewState = modifiedEditor.saveViewState();
    } catch (_) {}
    const freshContent = typedModel && typeof typedModel.getValue === 'function' ? typedModel.getValue() : '';
    const freshLang = typedModel && typeof typedModel.getLanguageId === 'function' ? typedModel.getLanguageId() : 'plaintext';
    const freshBaseline = typedMonaco?.editor?.createModel ? typedMonaco.editor.createModel(freshContent, freshLang) : null;
    if (!freshBaseline) return;
    typedDiffEditor.setModel({
      original: diffModel.original,
      modified: diffModel.modified,
      modifiedBaseline: freshBaseline,
      te2AutosaveMode: false,
      te2FreezeProjection: true,
    });
    try {
      if (modifiedViewState) {
        const modifiedEditor = typedDiffEditor.getModifiedEditor ? typedDiffEditor.getModifiedEditor() : null;
        if (modifiedEditor && typeof modifiedEditor.restoreViewState === 'function') modifiedEditor.restoreViewState(modifiedViewState);
      }
    } catch (_) {}
    console.log('[GitBaselines] draft save: re-snapshotted modifiedBaseline');
  } catch (error) {
    console.warn('[GitBaselines] draft save baseline re-snapshot failed', error);
  }
}
