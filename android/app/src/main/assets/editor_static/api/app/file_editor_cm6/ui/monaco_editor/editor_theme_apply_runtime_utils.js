export async function applyMonacoThemeRuntime(opts) {
  var o = opts || {};
  try {
    if (!o.win || !o.win.monaco || !o.win.monaco.editor || !o.win.monaco.editor.setTheme) return null;
    if (typeof o.ensureTe2DiffThemeFn === 'function') o.ensureTe2DiffThemeFn();
    try { if (typeof o.loadThemesFn === 'function') await o.loadThemesFn(); } catch (_) {}
    var cache = o.getJsonCacheFn ? (o.getJsonCacheFn() || {}) : {};
    var resolvedId = o.resolveThemeIdFn ? o.resolveThemeIdFn(o.themeKey, cache) : String(o.themeKey || '');
    if (!cache[resolvedId]) {
      var url = o.getThemeJsonUrlFn ? o.getThemeJsonUrlFn(resolvedId) : null;
      if (url) {
        try {
          var res = await o.fetchFn(url, { cache: 'no-store' });
          if (res.ok) {
            var json = await res.json();
            cache[resolvedId] = json;
            var monacoTheme = o.toMonacoThemeFn(resolvedId, json);
            o.win.monaco.editor.defineTheme(resolvedId, monacoTheme);
          }
        } catch (_) {}
      }
    }
    if (o.setJsonCacheFn) o.setJsonCacheFn(cache);
    o.win.monaco.editor.setTheme(resolvedId);
    try {
      o.doc.documentElement.classList.remove('vs', 'vs-dark', 'hc-black', 'hc-light');
      var base = (cache[resolvedId] && cache[resolvedId].uiTheme) || '';
      if (!base) base = resolvedId.toLowerCase().includes('light') ? 'vs' : 'vs-dark';
      else if (base.includes('light')) base = 'vs';
      else base = 'vs-dark';
      o.doc.documentElement.classList.add(base);
      console.log('[touch-theme] html class set to', base, 'for theme', resolvedId);
    } catch (_) {}
    if (cache[resolvedId]) {
      if (typeof o.applyThemeToTextmateRegistryFn === 'function') o.applyThemeToTextmateRegistryFn(cache[resolvedId]);
      return cache[resolvedId];
    }
    return null;
  } catch (e) {
    console.warn('[Monaco] applyMonacoTheme failed', e);
    return null;
  }
}
