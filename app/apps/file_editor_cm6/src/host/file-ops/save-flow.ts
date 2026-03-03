// @ts-nocheck

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
    if (!currentPath || !currentPathExists) return onMissingPath ? onMissingPath() : false;
    deps.setStatus('Saving...');
    const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const payload = /** @type {any} */ ({ path: currentPath, client_id: deps.clientId, op_id: opId });
    const lastSha = deps.getLastSha256();
    if (lastSha) payload.base_sha256 = lastSha;
    try {
      const result = await deps.saveFileViaEditorSocket(payload);
      if (!result || typeof result !== 'object') throw new Error('Invalid save response');
      if (result.ok === false) {
        if (result.error === 'BASE_MISMATCH') {
          if (isAutosave) { deps.setStatus(''); return false; }
          if (window.confirm('File was modified externally. Retry save and overwrite?')) {
            const retryResult = await deps.saveFileViaEditorSocket({ path: currentPath, client_id: deps.clientId, op_id: `${opId}_retry`, force: true });
            if (retryResult && retryResult.ok) {
              const fileMeta = retryResult.data || {};
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
    deps.setLastSha256(null);
    const targetAbs = deps.toAbsolute(target.path, null, deps.homeDir);
    const result = await doSave(targetAbs, '');
    if (result.success) {
      deps.setCurrentPath(targetAbs);
      deps.setCurrentPathExists(true);
      deps.setLastPickerPath(deps.parentDir(targetAbs));
      deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(targetAbs));
      deps.updatePathDisplay();
      deps.setStatus('Saved');
      setTimeout(() => { if (!deps.getUnsaved()) deps.setStatus(''); }, 1500);
      deps.closeWebSocket();
      deps.openWebSocket(targetAbs);
      deps.apiPost('state/file_activity', {
        path: targetAbs,
        project: deps.getCachedProjectRoot() || (deps.getEditorState() && deps.getEditorState().activeProject) || undefined,
      }).then((data) => {
        if (data?.state) {
          deps.setEditorState(data.state);
          deps.setCachedProjectRoot(data.state.activeProject || deps.getCachedProjectRoot());
          window.__cm6EditorState = data.state;
          if (typeof window.__cm6RefreshRecents === 'function') window.__cm6RefreshRecents(data.state);
        }
      }).catch((err) => {
        console.error('Failed to record file activity after save-as:', err);
      });
    } else {
      deps.toast(`Save failed: ${result.error}`);
      deps.setStatus('');
    }
  }

  return { doSave, saveFile, saveAsDialog };
}
