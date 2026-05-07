import { EDITOR_RPC_METHODS } from './editor_rpc_contract.ts';

interface EditorDraftDiffRequestRuntimeDeps {
  isRpcConnected(): boolean;
  rpcCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  getCurrentPath(): string | null;
  getShowDraftDiffs(): boolean;
}

export function createEditorDraftDiffRequestRuntime(deps: EditorDraftDiffRequestRuntimeDeps) {
  let draftDiffDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let draftDiffRequestId: string | null = null;

  function requestDraftDiff(reason?: string): boolean {
    try {
      const currentPath = deps.getCurrentPath();
      if (!deps.isRpcConnected()) return false;
      if (!currentPath) return false;
      if (!deps.getShowDraftDiffs()) return false;

      if (draftDiffDebounceTimer) clearTimeout(draftDiffDebounceTimer);
      draftDiffDebounceTimer = setTimeout(() => {
        try {
          draftDiffRequestId = String(Date.now()) + ':' + String(Math.random()).slice(2);
          void deps.rpcCall(
            EDITOR_RPC_METHODS.draftDiffGet,
            {
              path: currentPath,
              requestId: draftDiffRequestId,
              reason: reason || '',
            },
            { timeoutMs: 12000 },
          ).catch((error) => {
            console.warn('[DraftDiff] editor.draftDiff.get failed', error);
          });
        } catch (_) {}
      }, 180);
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    requestDraftDiff,
    getDraftDiffRequestId() {
      return draftDiffRequestId;
    },
  };
}
