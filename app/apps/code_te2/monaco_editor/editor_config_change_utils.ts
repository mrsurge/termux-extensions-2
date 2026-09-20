interface EditorConfigChangeOptions {
  syncReadOnlyInputModeFn?: (editor: MonacoRuntimeEditorLike | unknown) => void;
  lastKnownReadOnly: boolean | null;
  setLastKnownReadOnlyFn?: (readOnly: boolean) => void;
  monacoRef?: MonacoRuntimeGlobal | null;
  updatePreference(payload: Record<string, unknown>): Promise<unknown>;
}

export function onEditorConfigChanged(
  ed: MonacoRuntimeEditorLike | unknown,
  opts: EditorConfigChangeOptions | null | undefined,
): void {
  const editor = ed as MonacoRuntimeEditorLike | null;
  if (!opts) throw new Error("Editor preference RPC is required");
  const options = opts;
  if (typeof options.syncReadOnlyInputModeFn === 'function') options.syncReadOnlyInputModeFn(editor);
  try {
    if (!editor || !editor.getOption) return;
    const readOnlyOption = options.monacoRef && options.monacoRef.editor && options.monacoRef.editor.EditorOption
      ? options.monacoRef.editor.EditorOption.readOnly
      : undefined;
    const readOnly = editor.getOption(readOnlyOption);
    if (typeof readOnly !== 'boolean') return;
    if (options.lastKnownReadOnly !== null && readOnly !== options.lastKnownReadOnly) {
      options.updatePreference({ key: 'readOnly', value: readOnly }).catch((error: unknown) => { console.warn('[Monaco] readOnly pref save failed', error); });
    }
    if (typeof options.setLastKnownReadOnlyFn === 'function') options.setLastKnownReadOnlyFn(readOnly);
  } catch (_) {}
}
