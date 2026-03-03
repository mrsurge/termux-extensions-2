// @ts-check

/**
 * @param {{
 *   getCurrentPath: () => string,
 *   getEditorSocket: () => any,
 *   queueEditorMessage: (msg: any) => void,
 *   toast: (msg: string) => void,
 * }} deps
 */
export function createJumpLineController(deps) {
  async function jumpToCurrentFileLine(line, options = {}) {
    const path = deps.getCurrentPath();
    if (!path) {
      deps.toast('No file currently open');
      return;
    }
    try {
      const targetLine = parseInt(line, 10);
      if (!Number.isFinite(targetLine) || targetLine < 1) {
        deps.toast('Invalid line number');
        return;
      }
      const payload = { line: targetLine, path };
      if (options && Object.prototype.hasOwnProperty.call(options, 'focus')) payload.focus = Boolean(options.focus);
      if (options && Object.prototype.hasOwnProperty.call(options, 'scrollToTop')) payload.scroll_to_top = Boolean(options.scrollToTop);
      if (options && Object.prototype.hasOwnProperty.call(options, 'scrollY') && typeof options.scrollY === 'string') payload.scroll_y = options.scrollY;

      const editorSocket = deps.getEditorSocket();
      if (editorSocket && editorSocket.connected) {
        editorSocket.emit('editor_jump_to_line_request', payload);
        return;
      }
      deps.queueEditorMessage({ type: 'editor_jump_to_line_request', payload });
    } catch (e) {
      deps.toast('Failed to jump: ' + (e?.message || 'unknown error'));
    }
  }

  return { jumpToCurrentFileLine };
}
