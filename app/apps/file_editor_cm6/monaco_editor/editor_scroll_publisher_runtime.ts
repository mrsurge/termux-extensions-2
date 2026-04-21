interface EditorSocketLike {
  connected?: boolean;
  emit?(eventName: string, payload: Record<string, unknown>): void;
}

interface MonacoEditorLike {
  onDidScrollChange?(listener: () => void): void;
  onDidChangeCursorPosition?(listener: () => void): void;
}

interface EditorScrollPublisherRuntimeDeps {
  getEditor(): MonacoEditorLike | null;
  getEditorSocket(): EditorSocketLike | null;
  getCurrentPath(): string | null;
  getModel(): unknown;
  canInstall(): boolean;
  setInstalled(value: boolean): void;
  buildScrollStatePayload(): Record<string, unknown> | null;
  updateBreadcrumbCursor(cursorLine: number | undefined): void;
  shouldSendImmediately(now: number, lastSentAt: number, thresholdMs: number): boolean;
  scheduleSend(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}

export function installScrollPublisherRuntime(deps: EditorScrollPublisherRuntimeDeps): void {
  try {
    const editor = deps.getEditor();
    if (!editor || !deps.canInstall()) return;
    deps.setInstalled(true);

    let lastSentAt = 0;
    let pendingT: ReturnType<typeof setTimeout> | null = null;

    const send = () => {
      pendingT = null;
      try {
        const socket = deps.getEditorSocket();
        if (!socket || !socket.connected || typeof socket.emit !== 'function') return;
        if (!deps.getCurrentPath() || !deps.getModel()) return;
        const payload = deps.buildScrollStatePayload();
        if (!payload) return;
        socket.emit('editor_scroll_state', payload);
        lastSentAt = Date.now();
        deps.updateBreadcrumbCursor(typeof payload.cursorLine === 'number' ? payload.cursorLine : undefined);
      } catch (_) {}
    };

    const schedule = () => {
      try {
        const now = Date.now();
        if (deps.shouldSendImmediately(now, lastSentAt, 400)) {
          send();
          return;
        }
        if (pendingT) return;
        pendingT = deps.scheduleSend(send, 450);
      } catch (_) {}
    };

    if (typeof editor.onDidScrollChange === 'function') editor.onDidScrollChange(schedule);
    if (typeof editor.onDidChangeCursorPosition === 'function') editor.onDidChangeCursorPosition(schedule);
  } catch (_) {}
}
