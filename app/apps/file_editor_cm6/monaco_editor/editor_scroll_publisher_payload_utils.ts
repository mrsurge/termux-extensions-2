export function buildScrollStatePayload(
  editor: MonacoRuntimeEditorLike | null | unknown,
  currentPath: string | null,
): { path: string | null; line: number; column: number; cursorLine: number } | null {
  const editorInstance = editor as MonacoRuntimeEditorLike | null;
  let pos: MonacoRuntimePositionLike | null = null;
  try { pos = editorInstance && editorInstance.getPosition ? editorInstance.getPosition() : null; } catch (_) { pos = null; }
  const line = pos && pos.lineNumber ? pos.lineNumber : null;
  const col = pos && pos.column ? pos.column : null;
  if (!line) return null;
  return { path: currentPath, line, column: col || 1, cursorLine: line };
}
