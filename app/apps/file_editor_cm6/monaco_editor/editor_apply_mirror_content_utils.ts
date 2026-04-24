interface MirrorModelLike {
  getFullModelRange?(): unknown;
  applyEdits?(edits: Array<{ range: unknown; text: string }>): void;
  setValue?(value: string): void;
}

interface MirrorEditorLike {
  setValue?(value: string): void;
}

export function applyMirrorContent(
  model: MirrorModelLike | null | undefined,
  editor: MirrorEditorLike | null | undefined,
  content: string,
): void {
  if (model && model.getFullModelRange && model.applyEdits) {
    const range = model.getFullModelRange();
    model.applyEdits([{ range, text: content }]);
  } else if (model && model.setValue) {
    model.setValue(content);
  } else {
    editor?.setValue?.(content);
  }
}
