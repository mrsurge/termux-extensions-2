// @ts-check

interface CacheIndicatorInfo {
  state?: string;
  unsaved?: boolean;
  reason?: string;
  restoredActive?: boolean;
}

interface CacheIndicatorControllerDeps {
  getCurrentPath: () => string | null;
  getCachedProjectRoot: () => string | null;
  getCurrentProjectRoot: () => Promise<string | null>;
  discardDraft: (payload: Record<string, unknown>) => Promise<unknown>;
  toast: (msg: string) => void;
  markUnsaved: (flag: boolean) => void;
  getRestoredSessionActive: () => boolean;
}

function asCacheIndicatorInfo(value: unknown): CacheIndicatorInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as CacheIndicatorInfo;
}

export function createCacheIndicatorController(deps: CacheIndicatorControllerDeps) {
  async function handleDiscardClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    const currentPath = deps.getCurrentPath();
    if (!currentPath) {
      deps.toast('Cannot discard: No active file');
      return;
    }
    const project = deps.getCachedProjectRoot() || (await deps.getCurrentProjectRoot());
    if (!project) {
      deps.toast('Cannot discard: Project root unknown');
      return;
    }

    try {
      await deps.discardDraft({
        project,
        path: currentPath,
        source: 'host_cache_indicator',
      });
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

  function applyCacheIndicator(rawInfo: unknown) {
    const badge = document.getElementById('fe-file-draft-badge');
    if (!badge) return;

    const info = asCacheIndicatorInfo(rawInfo);
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
