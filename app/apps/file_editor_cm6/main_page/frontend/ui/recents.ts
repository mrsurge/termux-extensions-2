interface RecentFileEntry {
  path: string;
  label: string;
  opened_at: unknown;
  exists: boolean;
  scroll_line: unknown;
}

interface RecentsControllerDeps {
  recentFilesDD: HTMLElement;
  recentFilesBtn: HTMLButtonElement;
  formatFileNameDisplay: (name: string) => string;
  openFile: (path: string) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recentFileEntry(value: unknown): RecentFileEntry | null {
  if (!isRecord(value) || typeof value.path !== 'string' || !value.path) {
    return null;
  }
  return {
    path: value.path,
    label: typeof value.label === 'string' && value.label ? value.label : value.path,
    opened_at: value.opened_at,
    exists: value.exists === true,
    scroll_line: value.scroll_line,
  };
}

function recentsFromState(state: unknown): RecentFileEntry[] {
  if (!isRecord(state) || !Array.isArray(state.recents)) return [];
  return state.recents
    .map((entry) => recentFileEntry(entry))
    .filter((entry): entry is RecentFileEntry => entry !== null);
}

export function createRecentsController(deps: RecentsControllerDeps) {
  function refreshRecents(state: unknown): void {
    const recents = recentsFromState(state);
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
    recents.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      if (!entry.exists) item.classList.add('fe-dd-item--missing');

      item.textContent = deps.formatFileNameDisplay(entry.label);
      item.title = entry.path;

      item.addEventListener('click', async () => {
        deps.recentFilesDD.classList.remove('show');
        if (!entry.exists) {
          console.warn('[Recents] File does not exist:', entry.path);
          return;
        }
        try {
          await deps.openFile(entry.path);
        } catch (error) {
          console.error('[Recents] Failed to open file:', error);
        }
      });
      deps.recentFilesDD.appendChild(item);
    });
  }

  function installWindowHook(): void {
    window.__cm6RefreshRecents = refreshRecents;
    window.addEventListener('cm6:open-state-changed', (event) => {
      if (event instanceof CustomEvent) refreshRecents(event.detail);
    });
  }

  function broadcastRecentsUpdate(state: unknown): void {
    if (!state) return;
    window.__cm6EditorState = state;
    try {
      refreshRecents(state);
    } catch (error) {
      console.error('Failed to refresh recents dropdown:', error);
    }
    window.dispatchEvent(new CustomEvent('cm6:recents-updated', { detail: state }));
  }

  return { refreshRecents, installWindowHook, broadcastRecentsUpdate };
}
