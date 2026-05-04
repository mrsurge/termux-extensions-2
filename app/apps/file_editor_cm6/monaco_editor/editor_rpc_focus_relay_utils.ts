import { EDITOR_RPC_METHODS, type EditorRpcMethodName } from './editor_rpc_contract.ts';

type EditorRpcNotify = (method: EditorRpcMethodName, params: Record<string, unknown>) => boolean;

export function bindFocusRelay(
  ed: MonacoRuntimeEditorLike | null | unknown,
  notifyEditorRpc: EditorRpcNotify,
): { dispose(): void } | null {
  const editor = ed as MonacoRuntimeEditorLike | null;
  if (!editor || !editor.onDidFocusEditorWidget || !editor.onDidBlurEditorWidget) return null;
  const disposables: MonacoRuntimeDisposableLike[] = [];
  disposables.push(editor.onDidFocusEditorWidget(() => {
    console.log('[focus_relay] onDidFocusEditorWidget fired');
    notifyEditorRpc(EDITOR_RPC_METHODS.focus, {});
  }));
  disposables.push(editor.onDidBlurEditorWidget(() => {
    console.log('[focus_relay] onDidBlurEditorWidget fired');
    notifyEditorRpc(EDITOR_RPC_METHODS.blur, {});
  }));
  return { dispose() { disposables.forEach((disposable) => { disposable.dispose?.(); }); } };
}
