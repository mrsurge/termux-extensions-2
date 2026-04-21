import { connectUiIpcSocket } from './editor_ui_ipc_connect_utils.js';
import { bindSaveKeyCommand } from './editor_ui_ipc_save_key_utils.js';
import { bindFocusRelay } from './editor_ui_ipc_focus_relay_utils.js';
import { bindVendoredCtrlHelperFocus } from './editor_mobile_ctrl_helper_utils.js';

interface DisposableLike {
  dispose?(): void;
}

interface EditorLike {
  addCommand?(keybinding: number, handler: () => void): void;
}

interface DiffEditorLike {
  getModifiedEditor?(): EditorLike | null;
}

interface SocketLike {
  connected?: boolean;
  on?(eventName: string, handler: (payload: unknown) => void): void;
  emit?(eventName: string, payload: Record<string, unknown>): void;
}

interface IoLike {
  (namespace: string, opts?: Record<string, unknown>): SocketLike;
}

type WindowWithUiIpc = Window & {
  io?: IoLike;
  __te2AdapterReady?: boolean;
};

interface EditorUiIpcRuntimeDeps {
  getWindow(): WindowWithUiIpc;
  getEditor(): EditorLike | null;
  getDiffEditor(): DiffEditorLike | null;
  replayOpenFileAfterBaton(): void;
}

interface EditorUiIpcRuntime {
  connect(): void;
  bindEditorHooks(): void;
  getSocket(): SocketLike | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createEditorUiIpcRuntime(
  deps: EditorUiIpcRuntimeDeps,
): EditorUiIpcRuntime {
  let uiIpcSocket: SocketLike | null = null;
  let focusDisposable: DisposableLike | null = null;
  let mobileCtrlDisposable: DisposableLike | null = null;

  function resolveActiveEditor(): EditorLike | null {
    const diffEditor = deps.getDiffEditor();
    if (diffEditor && typeof diffEditor.getModifiedEditor === 'function') {
      return diffEditor.getModifiedEditor() || null;
    }
    return deps.getEditor();
  }

  function connect(): void {
    try {
      const win = deps.getWindow();
      if (!win.io) return;
      uiIpcSocket = connectUiIpcSocket(win.io) || null;
      if (!uiIpcSocket || typeof uiIpcSocket.on !== 'function') return;

      uiIpcSocket.on('connect', () => {
        console.log('[UI_IPC] editor iframe connected');
      });
      uiIpcSocket.on('ui_event', (payload) => {
        const data = asRecord(payload);
        if (!data) return;
        if (data.type !== 'adapter_state') return;
        const status = typeof data.status === 'string' ? data.status : '';
        console.log('[adapter_state] iframe received:', status);
        if (status === 'ready') {
          win.__te2AdapterReady = true;
          deps.replayOpenFileAfterBaton();
        } else if (status === 'error') {
          console.warn('[adapter_state] error:', data.error);
        }
      });
    } catch (error) {
      console.warn('[UI_IPC] connect failed', error);
    }
  }

  function bindSaveKey(): void {
    try {
      const editor = resolveActiveEditor();
      const monacoRef = deps.getWindow().monaco;
      if (!editor || !monacoRef) return;
      bindSaveKeyCommand(editor, monacoRef, uiIpcSocket);
    } catch (_) {}
  }

  function bindFocus(): void {
    try {
      if (focusDisposable && typeof focusDisposable.dispose === 'function') {
        try { focusDisposable.dispose(); } catch (_) {}
      }
      focusDisposable = null;

      const editor = resolveActiveEditor();
      if (!editor) {
        console.warn('[focus_relay] no editor instance - skipping bind');
        return;
      }

      focusDisposable = bindFocusRelay(editor, () => uiIpcSocket);
      console.log('[focus_relay] bound to editor widget');
    } catch (error) {
      console.warn('[focus_relay] bind failed', error);
    }
  }

  function bindMobileCtrlHelper(): void {
    try {
      if (mobileCtrlDisposable && typeof mobileCtrlDisposable.dispose === 'function') {
        try { mobileCtrlDisposable.dispose(); } catch (_) {}
      }
      mobileCtrlDisposable = null;

      const editor = resolveActiveEditor();
      const monacoRef = deps.getWindow().monaco;
      if (!editor) {
        console.warn('[editor_ctrl_helper] no editor instance - skipping bind');
        return;
      }

      mobileCtrlDisposable = bindVendoredCtrlHelperFocus(editor, monacoRef);
      console.log('[editor_ctrl_helper] bound to editor widget');
    } catch (error) {
      console.warn('[editor_ctrl_helper] bind failed', error);
    }
  }

  function bindEditorHooks(): void {
    bindSaveKey();
    bindFocus();
    bindMobileCtrlHelper();
  }

  function getSocket(): SocketLike | null {
    return uiIpcSocket;
  }

  return {
    connect,
    bindEditorHooks,
    getSocket,
  };
}
