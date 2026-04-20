// @ts-nocheck

/**
 * @param {{
 *   setStatus: (text: string) => void,
 *   ensureProjectContext: () => Promise<any>,
 *   toAbsolute: (path: string, base?: string|null, home?: string) => string,
 *   homeDir: string,
 *   getRestoredSessionActive: () => boolean,
 *   getCurrentPath: () => string,
 *   setRestoredSessionActive: (flag: boolean) => void,
 *   setIndicatorInactive: () => void,
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   apiGet: (path: string) => Promise<any>,
 *   setCurrentPath: (path: string) => void,
 *   setCurrentPathExists: (exists: boolean) => void,
 *   setLastPickerPath: (path: string) => void,
 *   parentDir: (path: string) => string,
 *   setCurrentModeLanguage: (lang: string | null) => void,
 *   detectLanguageFromFilename: (path: string) => string,
 *   setLastSha256: (sha: string | null) => void,
 *   requestBackendOpen: (payload: any) => Promise<any>,
 *   awaitEditorOpen: (requestId: string, path: string, timeoutMs?: number) => Promise<any>,
 *   setLastSavedContent: (content: string) => void,
 *   markUnsaved: (flag: boolean) => void,
 *   updatePathDisplay: () => void,
 *   syncSessionPath: () => void,
 *   getCachedProjectRoot: () => string | null,
 *   dispatchExplorerActiveFile: (rel: string | null) => void,
 *   openWebSocket: (path: string) => void,
 *   getEditorState: () => any,
 *   setEditorState: (state: any) => void,
 *   setCachedProjectRoot: (path: string | null) => void,
 *   broadcastRecentsUpdate: (state: any) => void,
 *   syncEditorState: (force?: boolean) => Promise<any>,
 *   getSessionStateActiveProject: () => string | null,
 *   setSessionStateActiveProject: (path: string | null) => void,
 *   jumpToCurrentFileLine: (line: number, opts?: any) => void,
 *   toast: (msg: string) => void,
 * }} deps
 */
export function createOpenFlowController(deps) {
  async function openFile(path, options = {}) {
    const optionsAny = /** @type {any} */ (options || {});
    const { allowOverwrite = true, forceRefresh = false } = optionsAny;
    const line = Number.isFinite(Number(optionsAny.line ?? optionsAny.lineNo))
      ? Number(optionsAny.line ?? optionsAny.lineNo)
      : null;
    const column = Number.isFinite(Number(optionsAny.column ?? optionsAny.col))
      ? Number(optionsAny.column ?? optionsAny.col)
      : null;
    const openRequestOptions = /** @type {any} */ ({});
    if (line != null && line >= 1) openRequestOptions.line = line;
    if (column != null && column >= 1) openRequestOptions.column = column;
    if (Object.prototype.hasOwnProperty.call(optionsAny, 'focus')) {
      openRequestOptions.focus = Boolean(optionsAny.focus);
    }
    if (Object.prototype.hasOwnProperty.call(optionsAny, 'scrollY') && typeof optionsAny.scrollY === 'string') {
      openRequestOptions.scroll_y = optionsAny.scrollY;
    }
    if (Object.prototype.hasOwnProperty.call(optionsAny, 'scrollToTop')) {
      openRequestOptions.scroll_to_top = Boolean(optionsAny.scrollToTop);
    }
    const openRequestId = `editor_open_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    openRequestOptions.request_id = openRequestId;
    if (!path) throw new Error('Path is empty');
    deps.setStatus('Opening...');

    const projectState = await deps.ensureProjectContext();
    if (!projectState || !projectState.activeProject || !projectState.activeProjectExists) {
      deps.setStatus('');
      deps.toast(projectState?.activeProjectMessage || 'Select a project before opening files.');
      return;
    }

    try {
      const resolvedTarget = deps.toAbsolute(path, null, deps.homeDir);
      if (!forceRefresh && !allowOverwrite && deps.getRestoredSessionActive() && deps.getCurrentPath() && resolvedTarget === deps.getCurrentPath()) {
        console.log('[Editor] Skipping host-side open; restored session buffer already loaded');
        deps.setStatus('');
        return;
      }

      deps.setRestoredSessionActive(false);
      deps.setIndicatorInactive();

      await deps.requestBackendOpen({
        path: resolvedTarget,
        ...openRequestOptions,
      });
      await deps.awaitEditorOpen(openRequestId, resolvedTarget, 10000);

      deps.setLastSavedContent('');
      deps.markUnsaved(false);
      deps.syncSessionPath();
      deps.setStatus('');

      deps.openWebSocket(resolvedTarget);

      try {
        const activity = await deps.apiPost('state/file_activity', {
          path: resolvedTarget,
          project: deps.getCachedProjectRoot() || projectState.activeProject,
        });
        if (activity?.state || activity?.data?.state) {
          const next = activity.state || activity.data.state;
          deps.setEditorState(next);
          deps.setCachedProjectRoot(next.activeProject || deps.getCachedProjectRoot());
          deps.broadcastRecentsUpdate(next);
          deps.syncSessionPath();
        } else {
          const refreshed = await deps.syncEditorState(true);
          if (refreshed) {
            deps.broadcastRecentsUpdate(refreshed);
            deps.setSessionStateActiveProject(refreshed.activeProject || deps.getSessionStateActiveProject());
            deps.syncSessionPath();
          }
        }
      } catch (err) {
        console.error('Failed to record file activity:', err);
      }
    } catch (e) {
      const eAny = /** @type {any} */ (e);
      deps.setStatus('');
      deps.toast(`Failed to open: ${eAny.message}`);
      throw e;
    }
  }

  return { openFile };
}
