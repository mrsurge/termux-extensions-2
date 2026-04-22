interface DiffModelLike {
  original?: unknown;
  modified?: unknown;
  te2AutosaveMode?: unknown;
}

interface DiffEditorLike {
  getModel?(): DiffModelLike | null;
}

export function shouldSkipAutosaveBaselineRefresh(
  diffEditor: unknown,
  gitHeadModel: unknown,
  model: unknown,
): boolean {
  let skip = false;
  const typedDiffEditor = diffEditor != null && typeof diffEditor === 'object' && !Array.isArray(diffEditor)
    ? diffEditor as DiffEditorLike
    : null;
  if (typedDiffEditor && typeof typedDiffEditor.getModel === 'function') {
    const diffModel = typedDiffEditor.getModel();
    if (diffModel && diffModel.original === gitHeadModel && diffModel.modified === model && !!diffModel.te2AutosaveMode) {
      skip = true;
    }
  } else {
    skip = true;
  }
  return skip;
}
