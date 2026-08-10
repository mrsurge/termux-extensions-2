interface MonacoModelLike {
  getFullModelRange?(): unknown;
  applyEdits?(edits: Array<{ range: unknown; text: string }>): void;
}

export function applyMirrorContentToModel(
  model: MonacoModelLike,
  content: unknown,
  setApplyingRemoteFn?: ((value: boolean) => void) | null,
): void {
  if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(true);
  try {
    const fullRange = model.getFullModelRange ? model.getFullModelRange() : null;
    if (fullRange && typeof model.applyEdits === 'function') {
      model.applyEdits([{ range: fullRange, text: String(content || '') }]);
    }
  } finally {
    if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(false);
  }
}
