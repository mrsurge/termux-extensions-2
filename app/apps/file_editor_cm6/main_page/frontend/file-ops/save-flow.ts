interface SaveTarget {
  path: string;
  existed?: boolean;
}

interface SaveFileParams {
  currentPath?: string | null;
  currentPathExists?: boolean;
  isAutosave?: boolean;
  onMissingPath?: () => unknown | Promise<unknown>;
}

interface SaveFlowControllerDeps {
  clientId: string;
  setInflightOpId: (id: string | null) => void;
  setLastSaveTime: (ts: number) => void;
  getLastSha256: () => string | null;
  setLastSha256: (sha: string | null) => void;
  setLastSavedContent: (content: string) => void;
  markUnsaved: (flag: boolean) => void;
  syncSessionPath: () => void;
  apiPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  apiGet: (path: string) => Promise<unknown>;
  saveFileViaEditorSocket: (payload: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  setStatus: (text: string) => void;
  getUnsaved: () => boolean;
  toast: (msg: string) => void;
  pickSaveTarget: () => Promise<SaveTarget | null>;
  toAbsolute: (path: string, base?: string | null, home?: string) => string;
  homeDir: string;
  setCurrentPath: (path: string) => void;
  setCurrentPathExists: (exists: boolean) => void;
  setLastPickerPath: (path: string) => void;
  setCurrentModeLanguage: (lang: string | null) => void;
  parentDir: (path: string | null | undefined) => string;
  detectLanguageFromFilename: (path: string) => string | null;
  updatePathDisplay: () => void;
  openFile?: (path: string, options?: Record<string, unknown>) => Promise<unknown>;
  closeWebSocket: () => void;
  openWebSocket: (path: string) => void | Promise<void>;
  getCachedProjectRoot: () => string | null;
  getEditorState: () => unknown;
  setEditorState: (state: unknown) => void;
  setCachedProjectRoot: (path: string | null) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error)) {
    if (typeof error.message === 'string') return error.message;
    if (typeof error.error === 'string') return error.error;
  }
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error ?? 'unknown error');
  }
}

function responseRecord(response: unknown): Record<string, unknown> {
  return isRecord(response) ? response : {};
}

function responseData(response: Record<string, unknown>): Record<string, unknown> {
  return isRecord(response.data) ? response.data : {};
}

export function createSaveFlowController(deps: SaveFlowControllerDeps) {
  async function doSave(targetPath: string, content: string): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    deps.setInflightOpId(opId);
    deps.setLastSaveTime(Date.now());
    const payload: Record<string, unknown> = { path: targetPath, content, client_id: deps.clientId, op_id: opId };
    const lastSha = deps.getLastSha256();
    if (lastSha) payload.base = { sha256: lastSha };
    try {
      const result = await deps.apiPost('write', payload);
      const resultRecord = responseRecord(result);
      deps.setLastSha256(stringValue(resultRecord.sha256) || deps.getLastSha256());
      deps.setLastSavedContent(content);
      deps.markUnsaved(false);
      deps.syncSessionPath();
      return { success: true, result };
    } catch (error) {
      deps.setInflightOpId(null);
      const errorRecord = responseRecord(error);
      const response = responseRecord(errorRecord.response);
      if (errorRecord.status === 409 || response.error === 'BASE_MISMATCH') {
        try {
          const latest = responseRecord(await deps.apiGet(`read?path=${encodeURIComponent(targetPath)}`));
          deps.setLastSha256(stringValue(latest.sha256));
          if (window.confirm('File was modified externally. Retry save and overwrite?')) {
            const retryPayload: Record<string, unknown> = {
              path: targetPath,
              content,
              client_id: deps.clientId,
              op_id: `${opId}_retry`,
            };
            const retryResult = await deps.apiPost('write', retryPayload);
            const retryRecord = responseRecord(retryResult);
            deps.setLastSha256(stringValue(retryRecord.sha256) || deps.getLastSha256());
            deps.setLastSavedContent(content);
            deps.markUnsaved(false);
            return { success: true, result: retryResult };
          }
          return { success: false, error: 'Conflict - user cancelled' };
        } catch (retryErr) {
          return { success: false, error: `Conflict resolution failed: ${errorMessage(retryErr)}` };
        }
      }
      return { success: false, error: errorMessage(error) };
    }
  }

  async function saveFile(params: SaveFileParams = {}): Promise<unknown> {
    const { currentPath, currentPathExists, isAutosave = false, onMissingPath } = params;
    deps.setStatus('Saving...');
    const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const payload: Record<string, unknown> = { client_id: deps.clientId, op_id: opId };
    if (currentPath && currentPathExists) payload.path = currentPath;
    const lastSha = deps.getLastSha256();
    if (lastSha && currentPath && currentPathExists) payload.base_sha256 = lastSha;
    try {
      const result = responseRecord(await deps.saveFileViaEditorSocket(payload));
      if (!Object.keys(result).length) throw new Error('Invalid save response');
      if (result.ok === false) {
        const error = stringValue(result.error);
        if (error === 'missing_path') {
          deps.setStatus('');
          return onMissingPath ? onMissingPath() : false;
        }
        if (error === 'BASE_MISMATCH') {
          if (isAutosave) { deps.setStatus(''); return false; }
          if (window.confirm('File was modified externally. Retry save and overwrite?')) {
            const retryPayload: Record<string, unknown> = { client_id: deps.clientId, op_id: `${opId}_retry`, force: true };
            if (currentPath && currentPathExists) retryPayload.path = currentPath;
            const retryResult = responseRecord(await deps.saveFileViaEditorSocket(retryPayload));
            if (retryResult.ok) {
              const fileMeta = responseData(retryResult);
              if ((!currentPath || !currentPathExists) && typeof fileMeta.path === 'string' && fileMeta.path) {
                deps.setCurrentPath(fileMeta.path);
                deps.setCurrentPathExists(true);
                deps.setLastPickerPath(deps.parentDir(fileMeta.path));
                deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(fileMeta.path));
                deps.updatePathDisplay();
              }
              deps.setLastSha256(stringValue(fileMeta.sha256) || deps.getLastSha256());
              deps.setLastSavedContent('');
              deps.markUnsaved(false);
              deps.setStatus('Saved');
              setTimeout(() => { if (!deps.getUnsaved()) deps.setStatus(''); }, 1500);
              return true;
            }
          }
          deps.setStatus('');
          return false;
        }
        if (error) deps.toast(`Save failed: ${error}`);
        deps.setStatus('');
        return false;
      }
      const fileMeta = responseData(result);
      if (Object.keys(fileMeta).length > 0) {
        if ((!currentPath || !currentPathExists) && typeof fileMeta.path === 'string' && fileMeta.path) {
          deps.setCurrentPath(fileMeta.path);
          deps.setCurrentPathExists(true);
          deps.setLastPickerPath(deps.parentDir(fileMeta.path));
          deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(fileMeta.path));
          deps.updatePathDisplay();
        }
        deps.setLastSha256(stringValue(fileMeta.sha256) || deps.getLastSha256());
        deps.setLastSavedContent('');
        deps.markUnsaved(false);
        deps.setStatus('Saved');
        setTimeout(() => { if (!deps.getUnsaved()) deps.setStatus(''); }, 1500);
        return true;
      }
      deps.toast('Save failed');
      deps.setStatus('');
      return false;
    } catch (error) {
      deps.toast(`Save failed: ${errorMessage(error)}`);
      deps.setStatus('');
      return false;
    }
  }

  async function saveAsDialog(): Promise<void> {
    const target = await deps.pickSaveTarget();
    if (!target || !target.path) return;
    if (target.existed && !window.confirm('File exists. Overwrite?')) return;
    deps.setStatus('Saving...');
    const targetAbs = deps.toAbsolute(target.path, null, deps.homeDir);
    try {
      const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const response = responseRecord(await deps.saveFileViaEditorSocket({
        target_path: targetAbs,
        client_id: deps.clientId,
        op_id: opId,
        force: true,
      }));
      if (!Object.keys(response).length) throw new Error('Invalid save response');
      if (response.ok === false) throw new Error(String(response.error || 'Save failed'));

      const data = responseData(response);
      deps.setLastSha256(stringValue(data.sha256));
      if (typeof deps.openFile === 'function') {
        await deps.openFile(targetAbs, { forceRefresh: true });
      } else {
        deps.setCurrentPath(targetAbs);
        deps.setCurrentPathExists(true);
        deps.setLastPickerPath(deps.parentDir(targetAbs));
        deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(targetAbs));
        deps.updatePathDisplay();
        deps.closeWebSocket();
        deps.openWebSocket(targetAbs);
      }
      deps.setStatus('Saved');
      setTimeout(() => { if (!deps.getUnsaved()) deps.setStatus(''); }, 1500);
    } catch (error) {
      deps.toast(`Save failed: ${errorMessage(error)}`);
      deps.setStatus('');
    }
  }

  return { doSave, saveFile, saveAsDialog };
}
