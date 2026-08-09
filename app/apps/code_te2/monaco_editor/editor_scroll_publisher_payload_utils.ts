export function buildScrollStatePayload(
  editor: MonacoRuntimeEditorLike | null | unknown,
  currentPath: string | null,
): {
  path: string;
  line: number;
  top: number | null;
  column: number;
  cursorLine: number;
} | null {
  const editorInstance = editor as MonacoRuntimeEditorLike | null;
  if (!currentPath) return null;

  let pos: MonacoRuntimePositionLike | null = null;
  try { pos = editorInstance && editorInstance.getPosition ? editorInstance.getPosition() : null; } catch (_) { pos = null; }
  let visibleRanges: MonacoRuntimeRangeLike[] = [];
  try {
    visibleRanges = editorInstance?.getVisibleRanges?.() || [];
  } catch (_) {
    visibleRanges = [];
  }

  const line = visibleRanges[0]?.startLineNumber;
  const col = pos && pos.column ? pos.column : null;
  const cursorLine = pos && pos.lineNumber ? pos.lineNumber : null;
  if (!line || !cursorLine) return null;

  let top: number | null = null;
  try {
    const value = editorInstance?.getScrollTop?.();
    top = typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch (_) {}

  return {
    path: currentPath,
    line,
    top,
    column: col || 1,
    cursorLine,
  };
}
