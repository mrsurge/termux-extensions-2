import { EDITOR_RPC_METHODS } from './editor_rpc_contract.ts';

interface MonacoEditorLike {
  onDidScrollChange?(listener: () => void): { dispose?(): void } | void;
  onDidChangeCursorPosition?(listener: () => void): { dispose?(): void } | void;
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
  clearScheduledSend?(timer: ReturnType<typeof setTimeout>): void;
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
    let disposed = false;
    const subscriptions: Array<{ dispose?(): void }> = [];
    const cancel = (timer: ReturnType<typeof setTimeout>): void => {
      if (deps.clearScheduledSend) deps.clearScheduledSend(timer); else clearTimeout(timer);
    };
    let pendingT: ReturnType<typeof setTimeout> | null = null;
    let pendingPayload: Record<string, unknown> | null = null;

    const send = (): boolean => {
      if (disposed) return false;
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
      if (disposed) return false;
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
          if (pendingT) cancel(pendingT);
          send();
          return;
        }
        if (pendingT) return;
        pendingT = deps.scheduleSend(send, 450);
      } catch (_) {}
    };

    const scroll = editor.onDidScrollChange?.(schedule);
    const cursor = editor.onDidChangeCursorPosition?.(schedule);
    if (scroll) subscriptions.push(scroll);
    if (cursor) subscriptions.push(cursor);

    return {
      flush(): boolean {
        if (!capture()) return false;
        if (pendingT) {
          cancel(pendingT);
          pendingT = null;
        }
        return send();
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        if (pendingT) cancel(pendingT);
        pendingT = null;
        pendingPayload = null;
        for (const subscription of subscriptions) subscription.dispose?.();
        subscriptions.length = 0;
      },
    };
  } catch (_) {
    return INERT_SCROLL_PUBLISHER;
  }
}
