interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
  setValue?(value: string): void;
}

interface MonacoEditorLike {
  setValue?(value: string): void;
}

export function shouldRecreateOpenModel(
  monacoRef: unknown,
  monacoFileUriFn: (monacoRef: unknown, absPath: string) => MonacoUriLike | null,
  model: MonacoModelLike | null | undefined,
  absPath: string,
): boolean {
  try {
    const want = monacoFileUriFn(monacoRef, absPath);
    return !!(want && model && model.uri && String(model.uri.toString()) !== String(want.toString()));
  } catch (_) {
    return false;
  }
}

export function applyOpenModelTextSafely(
  model: MonacoModelLike,
  editor: MonacoEditorLike,
  content: string,
  setApplyingRemoteFn?: ((value: boolean) => void) | null,
): void {
  try {
    if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(true);
    model.setValue?.(content || '');
  } catch (_) {
    editor.setValue?.(content || '');
  } finally {
    if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(false);
  }
}
