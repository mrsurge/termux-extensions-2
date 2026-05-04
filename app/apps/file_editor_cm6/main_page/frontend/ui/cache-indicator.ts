// @ts-check

/**
 * @param {{
 *   getCurrentPath: () => string,
 *   getCachedProjectRoot: () => string | null,
 *   getCurrentProjectRoot: () => Promise<string | null>,
 *   apiDelete: (path: string) => Promise<any>,
 *   openFile: (path: string, opts?: any) => Promise<any>,
 *   toast: (msg: string) => void,
 *   markUnsaved: (flag: boolean) => void,
 *   getRestoredSessionActive: () => boolean
 * }} deps
 */
export function createCacheIndicatorController(deps: any) {
  async function handleDiscardClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    const currentPath = deps.getCurrentPath();
    const project = deps.getCachedProjectRoot() || (await deps.getCurrentProjectRoot());
    if (!project) {
      deps.toast('Cannot discard: Project root unknown');
      return;
    }

    try {
      const url = `session_cache?project=${encodeURIComponent(project)}&path=${encodeURIComponent(currentPath)}`;
      await deps.apiDelete(url);
      await deps.openFile(currentPath, { forceRefresh: true });
      deps.toast('Draft discarded');
    } catch (err) {
      deps.toast('Failed to discard draft');
      console.error(err);
    }
  }

  function setIndicatorActive(badge: HTMLElement, char: string) {
    badge.textContent = char;
    badge.style.color = '#ff4444';
    badge.style.cursor = 'pointer';
    badge.title = 'Unsaved draft available. Click to discard.';
    badge.onclick = handleDiscardClick;
    badge.style.display = 'inline-block';
  }

  function setIndicatorInactive(badge: HTMLElement) {
    if (deps.getRestoredSessionActive()) return;
    badge.textContent = '*';
    badge.style.color = '#666';
    badge.style.cursor = 'default';
    badge.title = 'No unsaved draft';
    badge.onclick = null;
    badge.style.display = 'inline-block';
  }

  function applyCacheIndicator(info: any) {
    const badge = document.getElementById('fe-file-draft-badge');
    if (!badge) return;

    if (!info) {
      setIndicatorInactive(badge);
      return;
    }

    const { state, unsaved, reason, restoredActive } = info;
    const isCrashed = state === 'crashed';
    const isRestored = state === 'mid_session' && (reason === 'restore' || restoredActive);
    const isActiveDraft = state === 'mid_session' && unsaved;

    if (isCrashed || isRestored || isActiveDraft) {
      setIndicatorActive(badge, isCrashed ? '!' : '*');
      badge.dataset.state = isCrashed ? 'crashed' : (isRestored ? 'restored' : 'cached');
      deps.markUnsaved(true);
    } else if (!deps.getRestoredSessionActive()) {
      setIndicatorInactive(badge);
      badge.dataset.state = '';
      deps.markUnsaved(false);
    }
  }

  function installWindowHook() {
    window.applyCacheIndicator = applyCacheIndicator;
    try {
      if (window.__fePendingCacheIndicator) {
        applyCacheIndicator(window.__fePendingCacheIndicator);
        window.__fePendingCacheIndicator = null;
      }
    } catch (_) {}
  }

  return { handleDiscardClick, setIndicatorActive, setIndicatorInactive, applyCacheIndicator, installWindowHook };
}
