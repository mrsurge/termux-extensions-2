interface MonacoModelLike {}

interface MonacoEditorLike {
  setModel?(model: MonacoModelLike | null): void;
}

export function initOpenModel(
  createFileModelFn: (content: string, lang: string, absPath: string) => MonacoModelLike,
  editor: MonacoEditorLike,
  content: string,
  lang: string,
  absPath: string,
  afterAttachFn?: ((model: MonacoModelLike, lang: string, absPath: string) => void) | null,
): MonacoModelLike {
  const model = createFileModelFn(content || '', lang, absPath);
  editor.setModel?.(model);
  if (typeof afterAttachFn === 'function') afterAttachFn(model, lang, absPath);
  return model;
}
