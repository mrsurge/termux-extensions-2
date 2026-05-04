// @ts-check

/**
 * @param {{
 *   recentFilesDD: HTMLElement,
 *   recentFilesBtn: HTMLButtonElement,
 *   formatFileNameDisplay: (name: string) => string,
 *   openFile: (path: string) => Promise<any>
 * }} deps
 */
export function createRecentsController(deps: any) {
  function refreshRecents(state: any) {
    const recents = state?.recents || [];
    deps.recentFilesDD.innerHTML = '';

    if (!recents.length) {
      deps.recentFilesBtn.disabled = true;
      const emptyItem = document.createElement('div');
      emptyItem.className = 'fe-dd-item fe-dd-item--disabled';
      emptyItem.textContent = 'No recent files';
      deps.recentFilesDD.appendChild(emptyItem);
      return;
    }

    deps.recentFilesBtn.disabled = false;
    recents.forEach((entry: any) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      if (!entry.exists) item.classList.add('fe-dd-item--missing');

      const label = entry.label || entry.path || '(unknown)';
      const path = entry.path || '';
      item.textContent = deps.formatFileNameDisplay(label);
      item.title = path;

      item.addEventListener('click', async () => {
        deps.recentFilesDD.classList.remove('show');
        if (!entry.exists) {
          console.warn('[Recents] File does not exist:', path);
          return;
        }
        try {
          await deps.openFile(path);
        } catch (err) {
          console.error('[Recents] Failed to open file:', err);
        }
      });
      deps.recentFilesDD.appendChild(item);
    });
  }

  function installWindowHook() {
    window.__cm6RefreshRecents = (state: any) => refreshRecents(state);
  }

  function broadcastRecentsUpdate(state: any) {
    if (!state) return;
    window.__cm6EditorState = state;
    if (typeof window.__cm6RefreshRecents === 'function') {
      try {
        window.__cm6RefreshRecents(state);
      } catch (err) {
        console.error('Failed to refresh recents dropdown:', err);
      }
    }
    window.dispatchEvent(new CustomEvent('cm6:recents-updated', { detail: state }));
  }

  return { refreshRecents, installWindowHook, broadcastRecentsUpdate };
}
