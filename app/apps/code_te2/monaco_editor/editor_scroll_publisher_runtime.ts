import { EDITOR_RPC_METHODS } from './editor_rpc_contract.ts';

interface MonacoEditorLike {
  onDidScrollChange?(listener: () => void): void;
  onDidChangeCursorPosition?(listener: () => void): void;
}

interface EditorScrollPublisherRuntimeDeps {
  getEditor(): MonacoEditorLike | null;
  getCurrentPath(): string | null;
  getModel(): unknown;
  canInstall(): boolean;
  setInstalled(value: boolean): void;
  buildScrollStatePayload(): Record<string, unknown> | null;
  updateBreadcrumbCursor(cursorLine: number | undefined): void;
  notifyEditorRpc(method: string, payload: Record<string, unknown>): boolean;
  shouldSendImmediately(now: number, lastSentAt: number, thresholdMs: number): boolean;
  scheduleSend(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}

export interface EditorScrollPublisherRuntime {
  flush(): boolean;
  dispose(): void;
}

const INERT_SCROLL_PUBLISHER: EditorScrollPublisherRuntime = {
  flush: () => false,
  dispose: () => {},
};

export function installScrollPublisherRuntime(
  deps: EditorScrollPublisherRuntimeDeps,
): EditorScrollPublisherRuntime {
  try {
    const editor = deps.getEditor();
    if (!editor || !deps.canInstall()) return INERT_SCROLL_PUBLISHER;
    deps.setInstalled(true);

    let lastSentAt = 0;
    let pendingT: ReturnType<typeof setTimeout> | null = null;
    let pendingPayload: Record<string, unknown> | null = null;

    const send = (): boolean => {
      pendingT = null;
      try {
        const payload = pendingPayload;
        pendingPayload = null;
        if (!payload || !deps.getCurrentPath() || !deps.getModel()) return false;
        if (!deps.notifyEditorRpc(EDITOR_RPC_METHODS.scrollStatePublish, payload)) return false;
        lastSentAt = Date.now();
        deps.updateBreadcrumbCursor(typeof payload.cursorLine === 'number' ? payload.cursorLine : undefined);
        return true;
      } catch (_) {
        return false;
      }
    };

    const capture = (): boolean => {
      try {
        pendingPayload = deps.buildScrollStatePayload();
        return pendingPayload != null;
      } catch (_) {
        pendingPayload = null;
        return false;
      }
    };

    const schedule = () => {
      try {
        if (!capture()) return;
        const now = Date.now();
        if (deps.shouldSendImmediately(now, lastSentAt, 400)) {
          if (pendingT) clearTimeout(pendingT);
          send();
          return;
        }
        if (pendingT) return;
        pendingT = deps.scheduleSend(send, 450);
      } catch (_) {}
    };

    if (typeof editor.onDidScrollChange === 'function') editor.onDidScrollChange(schedule);
    if (typeof editor.onDidChangeCursorPosition === 'function') editor.onDidChangeCursorPosition(schedule);

    return {
      flush(): boolean {
        if (!capture()) return false;
        if (pendingT) {
          clearTimeout(pendingT);
          pendingT = null;
        }
        return send();
      },
      dispose(): void {
        if (pendingT) clearTimeout(pendingT);
        pendingT = null;
        pendingPayload = null;
      },
    };
  } catch (_) {
    return INERT_SCROLL_PUBLISHER;
  }
}
