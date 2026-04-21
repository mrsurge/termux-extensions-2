interface EditorDraftDiffRequestRuntimeDeps {
  getEditorSocket(): { connected?: boolean; emit?(eventName: string, payload: Record<string, unknown>): void } | null;
  getCurrentPath(): string | null;
  getShowDraftDiffs(): boolean;
}

export function createEditorDraftDiffRequestRuntime(deps: EditorDraftDiffRequestRuntimeDeps) {
  let draftDiffDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let draftDiffRequestId: string | null = null;

  function requestDraftDiff(reason?: string): boolean {
    try {
      const editorSocket = deps.getEditorSocket();
      const currentPath = deps.getCurrentPath();
      if (!editorSocket || !editorSocket.connected) return false;
      if (!currentPath) return false;
      if (!deps.getShowDraftDiffs()) return false;

      if (draftDiffDebounceTimer) clearTimeout(draftDiffDebounceTimer);
      draftDiffDebounceTimer = setTimeout(() => {
        try {
          draftDiffRequestId = String(Date.now()) + ':' + String(Math.random()).slice(2);
          if (editorSocket.emit) {
            editorSocket.emit('editor_draft_diff_request', {
              path: currentPath,
              requestId: draftDiffRequestId,
              reason: reason || '',
            });
          }
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
