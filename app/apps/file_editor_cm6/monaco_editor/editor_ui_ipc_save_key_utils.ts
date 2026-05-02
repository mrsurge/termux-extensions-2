import {
  UI_IPC_RPC_NOTIFICATIONS,
  buildUiIpcRpcNotificationEnvelope,
} from '../src/ui_ipc/rpc_contract.ts';

export function bindSaveKeyCommand(
  ed: MonacoRuntimeEditorLike | null | unknown,
  monacoRef: MonacoRuntimeGlobal | null | undefined,
  uiIpcSocket: MonacoRuntimeSocketLike | null | undefined,
): void {
  const editor = ed as MonacoRuntimeEditorLike | null;
  if (!editor || !editor.addCommand || !monacoRef || !monacoRef.KeyMod || !monacoRef.KeyCode) return;
  if (typeof monacoRef.KeyMod.CtrlCmd !== 'number' || typeof monacoRef.KeyCode.KeyS !== 'number') return;
  editor.addCommand(monacoRef.KeyMod.CtrlCmd | monacoRef.KeyCode.KeyS, () => {
    if (uiIpcSocket && typeof uiIpcSocket.emit === 'function') {
      uiIpcSocket.emit('rpc', buildUiIpcRpcNotificationEnvelope(UI_IPC_RPC_NOTIFICATIONS.editorSave));
    }
  });
}
