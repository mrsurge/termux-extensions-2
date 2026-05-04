import { bindSaveKeyCommand } from './editor_rpc_save_key_utils.ts';
import { bindFocusRelay } from './editor_rpc_focus_relay_utils.ts';
import { bindVendoredCtrlHelperFocus } from './editor_mobile_ctrl_helper_utils.ts';
import {
  EDITOR_RPC_NOTIFICATIONS,
  type EditorRpcMethodName,
  type EditorRpcNotificationName,
} from './editor_rpc_contract.ts';

interface DisposableLike {
  dispose?(): void;
}

interface EditorLike {
  addCommand?(keybinding: number, handler: () => void): void;
}

interface DiffEditorLike {
  getModifiedEditor?(): EditorLike | null;
}

type WindowWithEditorHostActions = Window & {
  __te2AdapterReady?: boolean;
};

interface EditorRpcHostActionRuntimeDeps {
  getWindow(): WindowWithEditorHostActions;
  getEditor(): EditorLike | null;
  getDiffEditor(): DiffEditorLike | null;
  replayOpenFileAfterBaton(): void;
  notifyEditorRpc(method: EditorRpcMethodName, params: Record<string, unknown>): boolean;
  onEditorRpcNotification(
    method: EditorRpcNotificationName,
    handler: (params: Record<string, unknown>) => void,
  ): () => void;
}

interface EditorRpcHostActionRuntime {
  connect(): void;
  bindEditorHooks(): void;
}

export function createEditorRpcHostActionRuntime(
  deps: EditorRpcHostActionRuntimeDeps,
): EditorRpcHostActionRuntime {
  let adapterStateUnsubscribe: (() => void) | null = null;
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
      if (adapterStateUnsubscribe) return;
      adapterStateUnsubscribe = deps.onEditorRpcNotification(EDITOR_RPC_NOTIFICATIONS.adapterState, (params) => {
        const status = typeof params.status === 'string' ? params.status : '';
        console.log('[adapter_state] editor rpc received:', status);
        if (status === 'ready') {
          deps.getWindow().__te2AdapterReady = true;
          deps.replayOpenFileAfterBaton();
        } else if (status === 'error') {
          console.warn('[adapter_state] error:', params.error);
        }
      });
    } catch (error) {
      console.warn('[editor_rpc_host_actions] connect failed', error);
    }
  }

  function bindSaveKey(): void {
    try {
      const editor = resolveActiveEditor();
      const monacoRef = deps.getWindow().monaco;
      if (!editor || !monacoRef) return;
      bindSaveKeyCommand(editor, monacoRef, deps.notifyEditorRpc);
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

      focusDisposable = bindFocusRelay(editor, deps.notifyEditorRpc);
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

  return {
    connect,
    bindEditorHooks,
  };
}
