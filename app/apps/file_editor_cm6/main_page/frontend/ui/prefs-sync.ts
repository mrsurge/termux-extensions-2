// @ts-check

/**
 * @param {{
 *   getClientId: () => string | null,
 *   setEditorViewState: (state: any) => void,
 *   applyStateToMenus: (state: any) => void
 * }} deps
 */
export function installPrefsSync(deps: any) {
  window.__cm6HandlePrefsChanged = function(payload: any) {
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
    if (window.__cm6PendingPrefsChanged) {
      window.__cm6HandlePrefsChanged(window.__cm6PendingPrefsChanged);
      window.__cm6PendingPrefsChanged = null;
    }
  } catch (_) {}
}
