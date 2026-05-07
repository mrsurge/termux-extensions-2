import { EDITOR_RPC_METHODS } from './editor_rpc_contract.ts';

interface EditorDisposableLike {
  dispose(): void;
}

interface EditorModelLike {
  getValue(): string;
  getLanguageId?(): string;
}

interface EditorMirrorPublisherDeps {
  getEditor(): { onDidChangeModelContent(listener: () => void): EditorDisposableLike } | null;
  getCurrentPath(): string | null;
  getModel(): EditorModelLike | null;
  getBaseSha256(): string | null;
  getIsApplyingRemote(): boolean;
  setLastLocalEditAt(value: number): void;
  getMirrorDebounceTimer(): ReturnType<typeof setTimeout> | null;
  setMirrorDebounceTimer(value: ReturnType<typeof setTimeout> | null): void;
  getMirrorPublisherDisposable(): EditorDisposableLike | null;
  setMirrorPublisherDisposable(value: EditorDisposableLike | null): void;
  isMirrorPublisherInstalled(): boolean;
  setMirrorPublisherInstalled(value: boolean): void;
  getLocalMirrorDebounceMs(): number;
  publishDidChange(path: string, text: string, languageId: string, generation: number): void;
  getCurrentGeneration(): number;
  requestDraftDiff(reason: string): void;
  setTraceMirrorActive(value: number): void;
  incrementTraceMirrorBindTotal(): void;
  syncTraceDebug(): void;
  isRpcConnected(): boolean;
  rpcCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
}

function emitMirrorUpdate(deps: EditorMirrorPublisherDeps, model: EditorModelLike, path: string): void {
  const content = model.getValue();
  if (!deps.isRpcConnected()) return;
  void deps.rpcCall(EDITOR_RPC_METHODS.mirrorPublish, {
    path,
    content,
    base_sha256: deps.getBaseSha256(),
  }, { timeoutMs: 8000 }).catch(() => {});
  deps.publishDidChange(
    path,
    content,
    model.getLanguageId ? model.getLanguageId() : '',
    deps.getCurrentGeneration(),
  );
}

export function flushMirrorDebounce(deps: EditorMirrorPublisherDeps): void {
  try {
    const timer = deps.getMirrorDebounceTimer();
    if (!timer) return;
    clearTimeout(timer);
    deps.setMirrorDebounceTimer(null);

    const model = deps.getModel();
    const currentPath = deps.getCurrentPath();
    if (!model || !currentPath) return;
    emitMirrorUpdate(deps, model, currentPath);
  } catch (_) {}
}

export function installMirrorPublisher(deps: EditorMirrorPublisherDeps): void {
  const editor = deps.getEditor();
  if (!editor) return;

  try {
    if (deps.isMirrorPublisherInstalled()) return;

    try {
      const existing = deps.getMirrorPublisherDisposable();
      if (existing && typeof existing.dispose === 'function') existing.dispose();
    } catch (_) {}

    const disposable = editor.onDidChangeModelContent(() => {
      if (deps.getIsApplyingRemote()) return;
      const model = deps.getModel();
      const currentPath = deps.getCurrentPath();
      if (!deps.isRpcConnected()) return;
      if (!currentPath || !model) return;

      deps.setLastLocalEditAt(Date.now());
      const timer = deps.getMirrorDebounceTimer();
      if (timer) clearTimeout(timer);
      deps.setMirrorDebounceTimer(setTimeout(() => {
        try {
          emitMirrorUpdate(deps, model, currentPath);
        } catch (_) {}
        deps.requestDraftDiff('local');
      }, deps.getLocalMirrorDebounceMs()));
    });

    deps.setMirrorPublisherDisposable(disposable);
    deps.setMirrorPublisherInstalled(true);
    deps.setTraceMirrorActive(1);
    deps.incrementTraceMirrorBindTotal();
    deps.syncTraceDebug();
  } catch (error) {
    console.warn('[Monaco] Failed to install mirror publisher', error);
  }
}
