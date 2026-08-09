export function handleJumpToLineEvent(
  editor: unknown,
  model: unknown,
  payload: unknown,
  applyJumpToLineFn: (editor: unknown, model: unknown, payload: unknown) => void,
): void {
  try { applyJumpToLineFn(editor, model, payload); } catch (e) { console.warn('[Monaco] jump_to_line failed', e); }
}
