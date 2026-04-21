import { flushMirrorDebounce as flushMirrorDebounceImpl, installMirrorPublisher as installMirrorPublisherImpl } from './editor_mirror_publisher.ts';

interface EditorMirrorDisposableLike {
  dispose(): void;
}

interface EditorMirrorEditorLike {
  onDidChangeModelContent(listener: () => void): EditorMirrorDisposableLike;
}

interface EditorMirrorSocketLike {
  connected?: boolean;
  emit(eventName: string, payload: Record<string, unknown>): void;
}

interface EditorMirrorModelLike {
  getValue(): string;
  getLanguageId?(): string;
}

interface EditorMirrorRuntimeDeps {
  getEditor(): EditorMirrorEditorLike | null;
  getEditorSocket(): EditorMirrorSocketLike | null;
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
}

export function createEditorMirrorRuntime(deps: EditorMirrorRuntimeDeps) {
  let mirrorDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let mirrorPublisherDisposable: EditorMirrorDisposableLike | null = null;
  let mirrorPublisherInstalled = false;

  function disposeMirrorPublisher(): void {
    try {
      if (mirrorPublisherDisposable && mirrorPublisherDisposable.dispose) {
        mirrorPublisherDisposable.dispose();
      }
    } catch (_) {}
    mirrorPublisherDisposable = null;
    mirrorPublisherInstalled = false;
    deps.setMirrorActive(0);
  }

  function buildMirrorDeps() {
    return {
      getEditor: deps.getEditor,
      getEditorSocket: deps.getEditorSocket,
      getCurrentPath: deps.getCurrentPath,
      getModel: deps.getModel,
      getBaseSha256: deps.getBaseSha256,
      getIsApplyingRemote: deps.getIsApplyingRemote,
      setLastLocalEditAt: deps.setLastLocalEditAt,
      getMirrorDebounceTimer() { return mirrorDebounceTimer; },
      setMirrorDebounceTimer(value: ReturnType<typeof setTimeout> | null) { mirrorDebounceTimer = value; },
      getMirrorPublisherDisposable() { return mirrorPublisherDisposable; },
      setMirrorPublisherDisposable(value: EditorMirrorDisposableLike | null) { mirrorPublisherDisposable = value; },
      isMirrorPublisherInstalled() { return mirrorPublisherInstalled; },
      setMirrorPublisherInstalled(value: boolean) { mirrorPublisherInstalled = !!value; },
      getLocalMirrorDebounceMs: deps.getLocalMirrorDebounceMs,
      publishDidChange: deps.publishDidChange,
      getCurrentGeneration: deps.getCurrentGeneration,
      requestDraftDiff: deps.requestDraftDiff,
      setTraceMirrorActive: deps.setMirrorActive,
      incrementTraceMirrorBindTotal: deps.incrementMirrorBindTotal,
      syncTraceDebug: deps.syncTraceDebug,
    };
  }

  function flushMirrorDebounce(): void {
    flushMirrorDebounceImpl(buildMirrorDeps());
  }

  function installMirrorPublisher(): void {
    installMirrorPublisherImpl(buildMirrorDeps());
  }

  return {
    disposeMirrorPublisher,
    flushMirrorDebounce,
    installMirrorPublisher,
  };
}
