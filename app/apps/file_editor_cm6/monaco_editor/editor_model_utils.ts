interface MonacoEditorNamespaceLike {
  editor?: {
    createModel?(value: string, language: string, uri?: unknown): unknown;
  };
}

export function createFileModel(
  monacoObj: MonacoEditorNamespaceLike | null | undefined,
  fileUriFactory: (absPath: string | null | undefined) => unknown,
  content: string | null | undefined,
  lang: string | null | undefined,
  absPath: string | null | undefined,
  onAfterCreate?: (() => void) | null,
): unknown {
  let model: unknown;
  try {
    const uri = fileUriFactory(absPath);
    if (uri && monacoObj?.editor?.createModel) {
      model = monacoObj.editor.createModel(content || '', lang || 'plaintext', uri);
    }
  } catch (_) {}
  if (!model && monacoObj?.editor?.createModel) {
    model = monacoObj.editor.createModel(content || '', lang || 'plaintext');
  }
  try {
    onAfterCreate?.();
  } catch (_) {}
  return model;
}
