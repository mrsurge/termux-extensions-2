export function handleJumpToLineEvent(editor, model, payload, applyJumpToLineFn) {
  try { applyJumpToLineFn(editor, model, payload); } catch (e) { console.warn('[Monaco] jump_to_line failed', e); }
}
