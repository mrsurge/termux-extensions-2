interface JumpLineOptions {
  focus?: boolean;
  scrollToTop?: boolean;
  scrollY?: string;
}

interface JumpLinePayload extends Record<string, unknown> {
  line: number;
  path: string;
  focus?: boolean;
  scroll_to_top?: boolean;
  scroll_y?: string;
}

interface JumpLineControllerDeps {
  getCurrentPath: () => string | null;
  requestBackendEditorJumpToLine: (payload: Record<string, unknown>) => Promise<unknown>;
  toast: (msg: string) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'unknown error';
}

export function createJumpLineController(deps: JumpLineControllerDeps) {
  async function jumpToCurrentFileLine(line: number | string, options: JumpLineOptions = {}): Promise<void> {
    const path = deps.getCurrentPath();
    if (!path) {
      deps.toast('No file currently open');
      return;
    }
    try {
      const targetLine = typeof line === 'number' ? line : Number.parseInt(line, 10);
      if (!Number.isFinite(targetLine) || targetLine < 1) {
        deps.toast('Invalid line number');
        return;
      }
      const payload: JumpLinePayload = { line: targetLine, path };
      if (Object.prototype.hasOwnProperty.call(options, 'focus')) payload.focus = Boolean(options.focus);
      if (Object.prototype.hasOwnProperty.call(options, 'scrollToTop')) payload.scroll_to_top = Boolean(options.scrollToTop);
      if (Object.prototype.hasOwnProperty.call(options, 'scrollY') && typeof options.scrollY === 'string') payload.scroll_y = options.scrollY;

      await deps.requestBackendEditorJumpToLine(payload);
    } catch (error) {
      deps.toast('Failed to jump: ' + getErrorMessage(error));
    }
  }

  return { jumpToCurrentFileLine };
}
