interface EditorConfigChangeOptions {
  syncReadOnlyInputModeFn?: (editor: MonacoRuntimeEditorLike | unknown) => void;
  lastKnownReadOnly: boolean | null;
  setLastKnownReadOnlyFn?: (readOnly: boolean) => void;
  monacoRef?: MonacoRuntimeGlobal | null;
  fetchFn(input: string, init?: RequestInit): Promise<unknown>;
}

export function onEditorConfigChanged(
  ed: MonacoRuntimeEditorLike | unknown,
  opts: EditorConfigChangeOptions | null | undefined,
): void {
  const editor = ed as MonacoRuntimeEditorLike | null;
  const options = opts || { lastKnownReadOnly: null, fetchFn: async () => undefined };
  if (typeof options.syncReadOnlyInputModeFn === 'function') options.syncReadOnlyInputModeFn(editor);
  try {
    if (!editor || !editor.getOption) return;
    const readOnlyOption = options.monacoRef && options.monacoRef.editor && options.monacoRef.editor.EditorOption
      ? options.monacoRef.editor.EditorOption.readOnly
      : undefined;
    const readOnly = editor.getOption(readOnlyOption);
    if (typeof readOnly !== 'boolean') return;
    if (options.lastKnownReadOnly !== null && readOnly !== options.lastKnownReadOnly) {
      options.fetchFn('/api/app/file_editor_cm6/editor/update_preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'readOnly', value: readOnly }),
      }).catch((error: unknown) => { console.warn('[Monaco] readOnly pref save failed', error); });
    }
    if (typeof options.setLastKnownReadOnlyFn === 'function') options.setLastKnownReadOnlyFn(readOnly);
  } catch (_) {}
}
