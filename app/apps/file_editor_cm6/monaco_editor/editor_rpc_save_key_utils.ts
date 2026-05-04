import { EDITOR_RPC_METHODS, type EditorRpcMethodName } from './editor_rpc_contract.ts';

type EditorRpcNotify = (method: EditorRpcMethodName, params: Record<string, unknown>) => boolean;

export function bindSaveKeyCommand(
  ed: MonacoRuntimeEditorLike | null | unknown,
  monacoRef: MonacoRuntimeGlobal | null | undefined,
  notifyEditorRpc: EditorRpcNotify,
): void {
  const editor = ed as MonacoRuntimeEditorLike | null;
  if (!editor || !editor.addCommand || !monacoRef || !monacoRef.KeyMod || !monacoRef.KeyCode) return;
  if (typeof monacoRef.KeyMod.CtrlCmd !== 'number' || typeof monacoRef.KeyCode.KeyS !== 'number') return;
  editor.addCommand(monacoRef.KeyMod.CtrlCmd | monacoRef.KeyCode.KeyS, () => {
    notifyEditorRpc(EDITOR_RPC_METHODS.hostSave, {});
  });
}
