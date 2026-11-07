import { EDITOR_RPC_METHODS } from './editor_rpc_contract.ts';
import { attachModelMirror } from './shared_model_mirror.ts';

interface EditorMirrorDisposableLike { dispose(): void }
interface EditorMirrorEditorLike {
  onDidChangeModelContent(listener: () => void): EditorMirrorDisposableLike;
}
interface EditorMirrorModelLike {
  getValue(): string;
  getLanguageId?(): string;
  onDidChangeContent?(listener: () => void): EditorMirrorDisposableLike;
}

interface EditorMirrorRuntimeDeps {
  getEditor(): EditorMirrorEditorLike | null;
  getCurrentPath(): string | null;
  getModel(): EditorMirrorModelLike | null;
  getBaseSha256(): string | null;
  getIsApplyingRemote(): boolean;
  setLastLocalEditAt(value: number): void;
  publishDidChange(path: string, text: string, languageId: string, generation: number): void;
  getCurrentGeneration(): number;
  requestDraftDiff(reason?: string): boolean;
  getLocalMirrorDebounceMs(): number;
  setMirrorActive(value: number): void;
  incrementMirrorBindTotal(): void;
  syncTraceDebug(): void;
  isRpcConnected(): boolean;
  rpcCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
}

export function createEditorMirrorRuntime(deps: EditorMirrorRuntimeDeps) {
  let binding: (EditorMirrorDisposableLike & { flush(): void }) | null = null;
  let boundModel: EditorMirrorModelLike | null = null;
  let boundPath: string | null = null;

  function disposeMirrorPublisher(): void {
    binding?.dispose();
    binding = null;
    boundModel = null;
    boundPath = null;
    deps.setMirrorActive(0);
  }

  function installMirrorPublisher(): void {
    const model = deps.getModel();
    const path = deps.getCurrentPath();
    if (binding && model === boundModel && path === boundPath) return;
    binding?.flush();
    disposeMirrorPublisher();
    if (!model || !path || !deps.getEditor()) return;
    const listen = model.onDidChangeContent;
    if (!listen) throw new Error('Working document model lacks its content-change event.');
    boundModel = model;
    boundPath = path;
    binding = attachModelMirror(model, {
      isCurrent: () => deps.getModel() === model && deps.getCurrentPath() === path,
      isConnected: deps.isRpcConnected,
      isApplyingRemote: deps.getIsApplyingRemote,
      changed: () => deps.setLastLocalEditAt(Date.now()),
      debounceMs: deps.getLocalMirrorDebounceMs,
      requestDraftDiff: () => { deps.requestDraftDiff('local'); },
      publish() {
        if (deps.getCurrentPath() !== path || deps.getModel() !== model || !deps.isRpcConnected()) return;
        const content = model.getValue();
        void deps.rpcCall(EDITOR_RPC_METHODS.mirrorPublish, {
          path, content, base_sha256: deps.getBaseSha256(),
        }, { timeoutMs: 8000 }).catch(() => {});
        deps.publishDidChange(path, content, model.getLanguageId?.() || '', deps.getCurrentGeneration());
      },
    }, changed => listen.call(model, changed));
    deps.setMirrorActive(1);
    deps.incrementMirrorBindTotal();
    deps.syncTraceDebug();
  }

  return {
    disposeMirrorPublisher,
    flushMirrorDebounce() { binding?.flush(); },
    installMirrorPublisher,
  };
}
