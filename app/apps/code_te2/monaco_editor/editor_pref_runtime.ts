import { getShowInlineDiffsFlag, getShowDraftDiffsFlag, getUseTrueInlineViewFlag, getAutoSaveFlag } from './editor_pref_flags_utils.ts';
import { localMirrorDebounceMs, mirrorHotWindowMs, gitBaselineDebounceMs, gitBaselineApplyIdleMs } from './editor_timing_policy_utils.ts';
import { requestGitBaselinesDebounced } from './editor_git_baseline_request_utils.ts';
import { EDITOR_RPC_METHODS } from './editor_rpc_contract.ts';

interface EditorPrefRuntimeDeps {
  getCachedPrefs(): unknown;
  getLastLocalEditAt(): number;
  isRpcConnected(): boolean;
  rpcCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  getCurrentPath(): string | null;
  getDiffEditor(): unknown;
  disposeGitBaselines(): void;
  ensurePlainEditorWithPrefs(): unknown;
  applyGitBaselines(payload: unknown): void;
  noteGitBaselineRequest(source: string, immediate: boolean): void;
}

export function createEditorPrefRuntime(deps: EditorPrefRuntimeDeps) {
  const recentEditorOpenKeys: Record<string, number> = Object.create(null);
  let gitBaselineDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let gitBaselineApplyTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingGitBaselinePayload: unknown = null;

  function getShowInlineDiffs(): boolean {
    if (getShowDraftDiffs()) return false;
    return getShowInlineDiffsFlag(deps.getCachedPrefs());
  }

  function getAutoSave(): boolean {
    return getAutoSaveFlag(deps.getCachedPrefs());
  }

  function getShowDraftDiffs(): boolean {
    return getShowDraftDiffsFlag(deps.getCachedPrefs(), getAutoSave);
  }

  function getShowDraftInsertions(): boolean {
    return !getAutoSave();
  }

  function getUseTrueInlineView(): boolean {
    return getUseTrueInlineViewFlag(deps.getCachedPrefs());
  }

  function getLocalMirrorDebounceMs(): number {
    return localMirrorDebounceMs(getAutoSave);
  }

  function getMirrorHotWindowMs(): number {
    return mirrorHotWindowMs(getAutoSave);
  }

  function getGitBaselineDebounceMs(): number {
    return gitBaselineDebounceMs(getAutoSave);
  }

  function getGitBaselineApplyIdleMs(): number {
    return gitBaselineApplyIdleMs(getAutoSave, getShowInlineDiffs);
  }

  function schedulePendingGitBaselineApply(): void {
    if (!pendingGitBaselinePayload) return;
    const idleMs = getGitBaselineApplyIdleMs();
    if (idleMs <= 0) return;
    const sinceEdit = deps.getLastLocalEditAt() > 0 ? (Date.now() - deps.getLastLocalEditAt()) : idleMs;
    const waitMs = sinceEdit >= idleMs ? 0 : (idleMs - sinceEdit);
    if (gitBaselineApplyTimer) clearTimeout(gitBaselineApplyTimer);
    gitBaselineApplyTimer = setTimeout(() => {
      gitBaselineApplyTimer = null;
      const payload = pendingGitBaselinePayload;
      pendingGitBaselinePayload = null;
      try { if (payload) deps.applyGitBaselines(payload); } catch (_) {}
    }, waitMs);
  }

  function emitGitBaselineRequestNow(): boolean {
    const currentPath = deps.getCurrentPath();
    if (!deps.isRpcConnected()) return false;
    if (!currentPath) return false;

    if (!getShowInlineDiffs() && !getShowDraftDiffs()) {
      deps.disposeGitBaselines();
      if (deps.getDiffEditor()) deps.ensurePlainEditorWithPrefs();
      return false;
    }

    void deps.rpcCall(
      EDITOR_RPC_METHODS.gitBaselinesGet,
      { path: currentPath },
      { timeoutMs: 12000 },
    ).then(
      (payload) => {
        try {
          deps.applyGitBaselines(payload);
        } catch (error) {
          console.warn('[Monaco] editor.gitBaselines.get apply failed', error);
        }
      },
      (error) => {
        console.warn('[Monaco] editor.gitBaselines.get failed', error);
      },
    );
    return true;
  }

  function requestGitBaselines(opts?: { immediate?: boolean; reason?: string }): boolean {
    return requestGitBaselinesDebounced({
      immediate: !!(opts && opts.immediate),
      reason: (opts && opts.reason) ? String(opts.reason) : 'unknown',
      timer: gitBaselineDebounceTimer,
      setTimerFn(timer: ReturnType<typeof setTimeout> | null) { gitBaselineDebounceTimer = timer; },
      noteRequestFn: deps.noteGitBaselineRequest,
      emitNowFn: emitGitBaselineRequestNow,
      debounceMs: getGitBaselineDebounceMs(),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });
  }

  function shouldDropDuplicateEditorOpen(payload: { path?: unknown; request_id?: unknown; line?: unknown; column?: unknown } | null | undefined): boolean {
    try {
      const path = payload && payload.path ? String(payload.path) : '';
      if (!path) return false;
      const requestId = payload && payload.request_id ? String(payload.request_id) : '';
      const line = payload && payload.line != null ? String(payload.line) : '';
      const column = payload && payload.column != null ? String(payload.column) : '';
      const key = requestId ? ('req:' + requestId) : ('path:' + path + '|line:' + line + '|column:' + column);
      const now = Date.now();
      const seen = recentEditorOpenKeys[key];
      if (seen && (now - seen) < 1500) return true;
      recentEditorOpenKeys[key] = now;
      const keys = Object.keys(recentEditorOpenKeys);
      if (keys.length > 256) {
        const cutoff = now - 30000;
        for (let index = 0; index < keys.length; index += 1) {
          const existingKey = keys[index];
          if ((recentEditorOpenKeys[existingKey] || 0) < cutoff) delete recentEditorOpenKeys[existingKey];
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  return {
    getShowInlineDiffs,
    getShowDraftDiffs,
    getShowDraftInsertions,
    getUseTrueInlineView,
    getAutoSave,
    getLocalMirrorDebounceMs,
    getMirrorHotWindowMs,
    getGitBaselineApplyIdleMs,
    requestGitBaselines,
    shouldDropDuplicateEditorOpen,
    getPendingGitBaselinePayload() { return pendingGitBaselinePayload; },
    setPendingGitBaselinePayload(payload: unknown) { pendingGitBaselinePayload = payload; },
    schedulePendingGitBaselineApply,
  };
}
