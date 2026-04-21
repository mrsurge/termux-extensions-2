
/**
 * @param {{
 *   clientId: string,
 *   setInflightOpId: (id: string | null) => void,
 *   setLastSaveTime: (ts: number) => void,
 *   getLastSha256: () => string | null,
 *   setLastSha256: (sha: string | null) => void,
 *   setLastSavedContent: (content: string) => void,
 *   markUnsaved: (flag: boolean) => void,
 *   syncSessionPath: () => void,
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   apiGet: (path: string) => Promise<any>,
 *   saveFileViaEditorSocket: (payload: any, timeoutMs?: number) => Promise<any>,
 *   setStatus: (text: string) => void,
 *   getUnsaved: () => boolean,
 *   toast: (msg: string) => void,
 *   pickSaveTarget: () => Promise<any>,
 *   toAbsolute: (path: string, base?: string|null, home?: string) => string,
 *   homeDir: string,
 *   setCurrentPath: (path: string) => void,
 *   setCurrentPathExists: (exists: boolean) => void,
 *   setLastPickerPath: (path: string) => void,
 *   setCurrentModeLanguage: (lang: string | null) => void,
 *   parentDir: (path: string) => string,
 *   detectLanguageFromFilename: (path: string) => string,
 *   updatePathDisplay: () => void,
 *   openFile?: (path: string, options?: any) => Promise<any>,
 *   closeWebSocket: () => void,
 *   openWebSocket: (path: string) => void,
 *   getCachedProjectRoot: () => string | null,
 *   getEditorState: () => any,
 *   setEditorState: (state: any) => void,
 *   setCachedProjectRoot: (path: string | null) => void,
 * }} deps
 */
export function createSaveFlowController(deps) {
  async function doSave(targetPath, content) {
    const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    deps.setInflightOpId(opId);
    deps.setLastSaveTime(Date.now());
    const payload = /** @type {any} */ ({ path: targetPath, content, client_id: deps.clientId, op_id: opId });
    const lastSha = deps.getLastSha256();
    if (lastSha) payload.base = { sha256: lastSha };
    try {
      const result = await deps.apiPost('write', payload);
      deps.setLastSha256(result.sha256 || deps.getLastSha256());
      deps.setLastSavedContent(content);
      deps.markUnsaved(false);
      deps.syncSessionPath();
      return { success: true, result };
    } catch (e) {
      const eAny = /** @type {any} */ (e);
      deps.setInflightOpId(null);
      if (eAny.status === 409 || (eAny.response && eAny.response.error === 'BASE_MISMATCH')) {
        try {
          const latest = await deps.apiGet(`read?path=${encodeURIComponent(targetPath)}`);
          deps.setLastSha256(latest.sha256 || null);
          if (window.confirm('File was modified externally. Retry save and overwrite?')) {
            const retryPayload = { path: targetPath, content, client_id: deps.clientId, op_id: `${opId}_retry` };
            const retryResult = await deps.apiPost('write', retryPayload);
            deps.setLastSha256(retryResult.sha256 || deps.getLastSha256());
            deps.setLastSavedContent(content);
            deps.markUnsaved(false);
            return { success: true, result: retryResult };
          }
          return { success: false, error: 'Conflict - user cancelled' };
        } catch (retryErr) {
          const retryErrAny = /** @type {any} */ (retryErr);
          return { success: false, error: `Conflict resolution failed: ${retryErrAny.message}` };
        }
      }
      return { success: false, error: eAny.message };
    }
  }

  async function saveFile(params = {}) {
    const { currentPath, currentPathExists, isAutosave = false, onMissingPath } = /** @type {any} */ (params);
    deps.setStatus('Saving...');
    const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const payload = /** @type {any} */ ({ client_id: deps.clientId, op_id: opId });
    if (currentPath && currentPathExists) payload.path = currentPath;
    const lastSha = deps.getLastSha256();
    if (lastSha && currentPath && currentPathExists) payload.base_sha256 = lastSha;
    try {
      const result = await deps.saveFileViaEditorSocket(payload);
      if (!result || typeof result !== 'object') throw new Error('Invalid save response');
      if (result.ok === false) {
        if (result.error === 'missing_path') {
          deps.setStatus('');
          return onMissingPath ? onMissingPath() : false;
        }
        if (result.error === 'BASE_MISMATCH') {
          if (isAutosave) { deps.setStatus(''); return false; }
          if (window.confirm('File was modified externally. Retry save and overwrite?')) {
            const retryPayload = /** @type {any} */ ({ client_id: deps.clientId, op_id: `${opId}_retry`, force: true });
            if (currentPath && currentPathExists) retryPayload.path = currentPath;
            const retryResult = await deps.saveFileViaEditorSocket(retryPayload);
            if (retryResult && retryResult.ok) {
              const fileMeta = retryResult.data || {};
              if ((!currentPath || !currentPathExists) && typeof fileMeta.path === 'string' && fileMeta.path) {
                deps.setCurrentPath(fileMeta.path);
                deps.setCurrentPathExists(true);
                deps.setLastPickerPath(deps.parentDir(fileMeta.path));
                deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(fileMeta.path));
                deps.updatePathDisplay();
              }
              deps.setLastSha256(fileMeta.sha256 || deps.getLastSha256());
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
        if (result.error) deps.toast(`Save failed: ${result.error}`);
        deps.setStatus('');
        return false;
      }
      const fileMeta = result.data || {};
      if (fileMeta && Object.keys(fileMeta).length > 0) {
        if ((!currentPath || !currentPathExists) && typeof fileMeta.path === 'string' && fileMeta.path) {
          deps.setCurrentPath(fileMeta.path);
          deps.setCurrentPathExists(true);
          deps.setLastPickerPath(deps.parentDir(fileMeta.path));
          deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(fileMeta.path));
          deps.updatePathDisplay();
        }
        deps.setLastSha256(fileMeta.sha256 || deps.getLastSha256());
        deps.setLastSavedContent('');
        deps.markUnsaved(false);
        deps.setStatus('Saved');
        setTimeout(() => { if (!deps.getUnsaved()) deps.setStatus(''); }, 1500);
        return true;
      }
      deps.toast('Save failed');
      deps.setStatus('');
      return false;
    } catch (e) {
      const eAny = /** @type {any} */ (e);
      deps.toast(`Save failed: ${eAny.message || eAny.error || JSON.stringify(eAny)}`);
      deps.setStatus('');
      return false;
    }
  }

  async function saveAsDialog() {
    const target = await deps.pickSaveTarget();
    if (!target || !target.path) return;
    if (target.existed && !window.confirm('File exists. Overwrite?')) return;
    deps.setStatus('Saving...');
    const targetAbs = deps.toAbsolute(target.path, null, deps.homeDir);
    try {
      const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const response = await deps.saveFileViaEditorSocket({
        target_path: targetAbs,
        client_id: deps.clientId,
        op_id: opId,
        force: true,
      });
      if (!response || typeof response !== 'object') throw new Error('Invalid save response');
      if (response.ok === false) throw new Error(String(response.error || 'Save failed'));

      deps.setLastSha256((response.data || {}).sha256 || null);
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
    } catch (e) {
      const eAny = /** @type {any} */ (e);
      deps.toast(`Save failed: ${eAny.message || eAny.error || JSON.stringify(eAny)}`);
      deps.setStatus('');
    }
  }

  return { doSave, saveFile, saveAsDialog };
}
