export function buildScrollStatePayload(editor, currentPath) {
  var pos = null;
  try { pos = editor.getPosition(); } catch (_) { pos = null; }
  var line = pos && pos.lineNumber ? pos.lineNumber : null;
  var col = pos && pos.column ? pos.column : null;
  if (!line) return null;
  return { path: currentPath, line: line, column: col || 1, cursorLine: line };
}
