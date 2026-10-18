// Compatibility ingress shares the project/revision-checked preference owner.
export function installPrefsSync(deps: { apply(payload: unknown): boolean }) {
  window.__codeTe2HandlePrefsChanged = function(payload: unknown) {
    try {
      deps.apply(payload);
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
