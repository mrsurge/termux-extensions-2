
/**
 * @param {{
 *   getCurrentPath: () => string,
 *   requestBackendEditorJumpToLine: (payload: Record<string, unknown>) => Promise<any>,
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
      const payload = /** @type {any} */ ({ line: targetLine, path });
      const optionsAny = /** @type {any} */ (options || {});
      if (options && Object.prototype.hasOwnProperty.call(options, 'focus')) payload.focus = Boolean(optionsAny.focus);
      if (options && Object.prototype.hasOwnProperty.call(options, 'scrollToTop')) payload.scroll_to_top = Boolean(optionsAny.scrollToTop);
      if (options && Object.prototype.hasOwnProperty.call(options, 'scrollY') && typeof optionsAny.scrollY === 'string') payload.scroll_y = optionsAny.scrollY;

      await deps.requestBackendEditorJumpToLine(payload);
    } catch (e) {
      const eAny = /** @type {any} */ (e);
      deps.toast('Failed to jump: ' + (eAny?.message || 'unknown error'));
    }
  }

  return { jumpToCurrentFileLine };
}
