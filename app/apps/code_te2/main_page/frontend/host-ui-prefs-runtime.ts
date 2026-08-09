export type HostUiPrefs = Record<string, unknown>;

interface SidebarShortcutsLike {
  applyUiPrefs?: (prefs: HostUiPrefs) => unknown;
}

interface HostUiPrefsRuntimeDeps {
  getSidebarShortcuts: () => SidebarShortcutsLike | null | undefined;
  warn?: (...args: unknown[]) => void;
}

interface HostUiPrefsPayload {
  ui?: unknown;
}

function normalizeUiPrefsPayload(payload: unknown): HostUiPrefs {
  const candidate = payload && typeof payload === 'object'
    ? (payload as HostUiPrefsPayload).ui
    : null;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? { ...(candidate as HostUiPrefs) }
    : {};
}

export function createHostUiPrefsRuntime(deps: HostUiPrefsRuntimeDeps) {
  let latestUiPrefs: HostUiPrefs = {};
  let hasUiPrefsSnapshot = false;
  const uiPrefsWaiters: Array<(ui: HostUiPrefs) => void> = [];

  const warn = (...args: unknown[]) => {
    if (deps.warn) deps.warn(...args);
    else console.warn(...args);
  };

  function resolveUiPrefsWaiters(ui: HostUiPrefs) {
    if (!uiPrefsWaiters.length) return;
    while (uiPrefsWaiters.length) {
      const resolve = uiPrefsWaiters.shift();
      try {
        resolve?.(ui);
      } catch (_) {}
    }
  }

  function waitForInitialUiPrefs(timeoutMs = 2200): Promise<HostUiPrefs> {
    if (hasUiPrefsSnapshot) {
      return Promise.resolve(latestUiPrefs || {});
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(latestUiPrefs || {});
      }, Math.max(300, timeoutMs || 0));
      uiPrefsWaiters.push((ui) => {
        clearTimeout(timer);
        resolve(ui || {});
      });
    });
  }

  function applySidebarUiPrefs(prefs: HostUiPrefs) {
    try {
      deps.getSidebarShortcuts()?.applyUiPrefs?.(prefs || {});
    } catch (error) {
      warn('[Sidebar] Failed to apply sidebar prefs:', error);
    }
  }

  function handleUiPrefs(payload: unknown) {
    try {
      latestUiPrefs = normalizeUiPrefsPayload(payload);
      hasUiPrefsSnapshot = true;
      resolveUiPrefsWaiters(latestUiPrefs);
      applySidebarUiPrefs(latestUiPrefs);
    } catch (error) {
      warn('[AgentPrefs] Failed to apply prefs:setUi payload:', error);
    }
  }

  function seedUiPrefsSnapshot(prefs: HostUiPrefs) {
    handleUiPrefs({ ui: prefs || {} });
  }

  function installWindowHook() {
    window.__codeTe2HandleUiPrefs = handleUiPrefs;
  }

  function drainPendingUiPrefs() {
    try {
      if (window.__codeTe2PendingUiPrefs) {
        window.__codeTe2HandleUiPrefs?.(window.__codeTe2PendingUiPrefs);
        window.__codeTe2PendingUiPrefs = null;
      }
    } catch (_) {}
  }

  function latestSnapshot(): HostUiPrefs {
    return { ...latestUiPrefs };
  }

  return {
    applySidebarUiPrefs,
    drainPendingUiPrefs,
    handleUiPrefs,
    installWindowHook,
    latestSnapshot,
    seedUiPrefsSnapshot,
    waitForInitialUiPrefs,
  };
}
