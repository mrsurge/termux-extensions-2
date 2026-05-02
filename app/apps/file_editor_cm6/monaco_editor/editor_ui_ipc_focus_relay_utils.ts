import {
  UI_IPC_RPC_NOTIFICATIONS,
  buildUiIpcRpcNotificationEnvelope,
} from '../src/ui_ipc/rpc_contract.ts';

type SocketResolver = (() => MonacoRuntimeSocketLike | null) | MonacoRuntimeSocketLike | null;

export function bindFocusRelay(
  ed: MonacoRuntimeEditorLike | null | unknown,
  getSocket: SocketResolver,
): { dispose(): void } | null {
  const editor = ed as MonacoRuntimeEditorLike | null;
  if (!editor || !editor.onDidFocusEditorWidget || !editor.onDidBlurEditorWidget) return null;
  const disposables: MonacoRuntimeDisposableLike[] = [];
  disposables.push(editor.onDidFocusEditorWidget(() => {
    const sock = typeof getSocket === 'function' ? getSocket() : getSocket;
    console.log('[focus_relay] onDidFocusEditorWidget fired, socket=' +
      (sock ? (sock.connected ? 'connected' : 'disconnected') : 'null'));
    if (sock && typeof sock.emit === 'function') {
      sock.emit('rpc', buildUiIpcRpcNotificationEnvelope(UI_IPC_RPC_NOTIFICATIONS.editorFocus));
    }
  }));
  disposables.push(editor.onDidBlurEditorWidget(() => {
    const sock = typeof getSocket === 'function' ? getSocket() : getSocket;
    console.log('[focus_relay] onDidBlurEditorWidget fired, socket=' +
      (sock ? (sock.connected ? 'connected' : 'disconnected') : 'null'));
    if (sock && typeof sock.emit === 'function') {
      sock.emit('rpc', buildUiIpcRpcNotificationEnvelope(UI_IPC_RPC_NOTIFICATIONS.editorBlur));
    }
  }));
  return { dispose() { disposables.forEach((disposable) => { disposable.dispose?.(); }); } };
}
