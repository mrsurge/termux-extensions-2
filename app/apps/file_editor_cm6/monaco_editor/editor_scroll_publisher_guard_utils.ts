export function canInstallScrollPublisher(
  editor: MonacoRuntimeEditorLike | null | unknown,
  installedFlag: boolean,
): boolean {
  const editorInstance = editor as MonacoRuntimeEditorLike | null;
  if (!editorInstance || !editorInstance.onDidScrollChange || !editorInstance.onDidChangeCursorPosition) return false;
  if (installedFlag) return false;
  return true;
}
