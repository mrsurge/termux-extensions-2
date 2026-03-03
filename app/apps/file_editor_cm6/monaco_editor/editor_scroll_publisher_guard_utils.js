export function canInstallScrollPublisher(editor, installedFlag) {
  if (!editor || !editor.onDidScrollChange || !editor.onDidChangeCursorPosition) return false;
  if (installedFlag) return false;
  return true;
}
