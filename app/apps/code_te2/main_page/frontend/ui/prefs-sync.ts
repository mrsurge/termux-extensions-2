// @ts-check

/**
 * @param {{
 *   getClientId: () => string | null,
 *   setEditorViewState: (state: any) => void,
 *   applyStateToMenus: (state: any) => void
 * }} deps
 */
export function installPrefsSync(deps: any) {
  window.__codeTe2HandlePrefsChanged = function(payload: any) {
    try {
      const viewState = payload && typeof payload === 'object'
        ? (payload.view_state || payload.viewState || null)
        : null;
      if (!viewState || typeof viewState !== 'object') return;

      try {
        const clientId = deps.getClientId();
        if (payload.source_client && clientId && String(payload.source_client) === String(clientId)) return;
      } catch (_) {}

      deps.setEditorViewState(viewState);
      deps.applyStateToMenus(viewState);
    } catch (err) {
      console.warn('[PrefsSync] Failed to apply prefs_changed:', err);
    }
  };

  try {
    if (window.__codeTe2PendingPrefsChanged) {
      window.__codeTe2HandlePrefsChanged(window.__codeTe2PendingPrefsChanged);
      window.__codeTe2PendingPrefsChanged = null;
    }
  } catch (_) {}
}
