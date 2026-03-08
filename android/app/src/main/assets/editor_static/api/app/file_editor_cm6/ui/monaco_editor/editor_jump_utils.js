export function applyJumpToLine(editorInstance, modelInstance, payload) {
  try {
    if (!payload) return;
    if (!editorInstance || !modelInstance) return;

    var line = payload.line;
    var col = payload.column;
    if (typeof line === 'string' && /^\d+$/.test(line)) line = parseInt(line, 10);
    if (typeof col === 'string' && /^\d+$/.test(col)) col = parseInt(col, 10);
    if (!Number.isFinite(line)) return;
    line = Math.max(1, Math.min(modelInstance.getLineCount(), line));
    if (!Number.isFinite(col)) col = 1;
    col = Math.max(1, Math.min(modelInstance.getLineMaxColumn(line), col));

    var focus = payload.focus;
    var scrollY = payload.scroll_y;
    var scrollToTop = payload.scroll_to_top;

    if (scrollToTop) {
      try { editorInstance.revealLine(line, 0); } catch (_) {}
    } else if (typeof scrollY === 'string' && String(scrollY).toLowerCase() === 'center') {
      try { editorInstance.revealLineInCenter(line, 0); } catch (_) {}
    } else {
      try { editorInstance.revealLineNearTop(line, 0); } catch (_) {}
    }

    try { editorInstance.setPosition({ lineNumber: line, column: col }); } catch (_) {}
    try { if (focus !== false) editorInstance.focus(); } catch (_) {}
  } catch (_) {}
}
