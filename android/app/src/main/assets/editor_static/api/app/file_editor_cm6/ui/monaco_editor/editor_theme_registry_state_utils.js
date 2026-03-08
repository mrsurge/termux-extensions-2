export async function ensureThemeRegistryState(state, fetchFn, buildUiUrlFn, apiBase) {
  if (state && state.registry) return state.registry;
  if (state && state.promise) return state.promise;
  state.promise = (async function () {
    try {
      var res = await fetchFn(buildUiUrlFn(apiBase, 'monaco_editor/available_themes'), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var themes = data && data.themes ? data.themes : [];
      var reg = {};
      for (var i = 0; i < themes.length; i++) {
        var t = themes[i];
        if (t && t.id && t.serveUrl) reg[t.id] = t;
      }
      state.registry = reg;
      return reg;
    } catch (e) {
      console.warn('[MonacoTheme] _ensureThemeRegistry failed', e);
      state.registry = {};
      return state.registry;
    } finally {
      state.promise = null;
    }
  })();
  return state.promise;
}
