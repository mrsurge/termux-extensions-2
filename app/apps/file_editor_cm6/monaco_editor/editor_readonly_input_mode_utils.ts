export function syncReadOnlyInputMode(
  ed: MonacoRuntimeEditorLike | null | unknown,
  monacoRef: MonacoRuntimeGlobal | null | undefined,
  docRef: Document,
): void {
  try {
    const editor = ed as MonacoRuntimeEditorLike | null;
    if (!editor || !editor.getDomNode || !editor.getOption) return;
    const dom = editor.getDomNode();
    if (!dom) return;
    const textarea = (dom.querySelector('textarea.inputarea') || dom.querySelector('textarea')) as HTMLTextAreaElement | null;
    if (!textarea) return;
    const readOnlyOption = monacoRef && monacoRef.editor && monacoRef.editor.EditorOption ? monacoRef.editor.EditorOption.readOnly : undefined;
    const readOnly = !!editor.getOption(readOnlyOption);
    textarea.setAttribute('inputmode', readOnly ? 'none' : 'text');
    if (readOnly && textarea === docRef.activeElement) textarea.blur();
  } catch (_) {}
}
