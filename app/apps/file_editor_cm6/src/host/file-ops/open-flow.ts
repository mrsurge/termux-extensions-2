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
 *   emitEditorOpenRequest: (path: string) => void,
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

      let contentPayload;
      try {
        const check = await deps.apiPost('editor/check_cache', { path: resolvedTarget });
        if (check && check.ok && check.has_draft) {
          contentPayload = { path: resolvedTarget, content: check.content, sha256: check.base_sha256 };
          console.log('[Editor] Opening cached draft for', resolvedTarget);
        }
      } catch (e) { console.warn('Cache check failed', e); }

      if (!contentPayload) contentPayload = await deps.apiGet(`read?path=${encodeURIComponent(path)}`);
      const payload = contentPayload;

      const resolved = deps.toAbsolute(payload.path || path, null, deps.homeDir);
      deps.setCurrentPath(resolved);
      deps.setCurrentPathExists(true);
      deps.setLastPickerPath(deps.parentDir(resolved));
      deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(resolved));
      deps.setLastSha256(payload.sha256 || null);
      deps.emitEditorOpenRequest(resolved);

      deps.setLastSavedContent('');
      deps.markUnsaved(false);
      deps.updatePathDisplay();
      deps.syncSessionPath();
      deps.setStatus('');

      try {
        const projectRoot = projectState.activeProject || deps.getCachedProjectRoot() || null;
        const rootAbs = projectRoot ? deps.toAbsolute(projectRoot, null, deps.homeDir).replace(/\/+$/, '') : null;
        let rel = null;
        if (rootAbs && resolved.startsWith(rootAbs + '/')) rel = resolved.slice(rootAbs.length + 1);
        deps.dispatchExplorerActiveFile(rel);
      } catch (_) {}

      deps.openWebSocket(resolved);

      let scrollLineToRestore = null;
      try {
        const activity = await deps.apiPost('state/file_activity', {
          path: resolved,
          project: deps.getCachedProjectRoot() || projectState.activeProject,
        });
        if (activity?.data?.entry?.scroll_line) scrollLineToRestore = activity.data.entry.scroll_line;
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

      if (scrollLineToRestore && scrollLineToRestore > 1) {
        setTimeout(() => {
          console.log('[Editor] Restoring scroll to line', scrollLineToRestore);
          deps.jumpToCurrentFileLine(scrollLineToRestore, { focus: false, scrollToTop: true });
        }, 150);
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
