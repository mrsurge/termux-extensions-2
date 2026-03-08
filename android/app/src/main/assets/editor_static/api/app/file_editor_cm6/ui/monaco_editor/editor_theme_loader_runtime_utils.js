export async function loadVscodeTextmateThemesRuntime(opts) {
  var o = opts || {};
  if (o.state && o.state.done) return;
  if (!o.win || !o.win.monaco || !o.win.monaco.editor || !o.win.monaco.editor.defineTheme) return;
  if (o.state && o.state.promise) return o.state.promise;
  o.state.promise = (async function () {
    if (!o.state.jsonCache) o.state.jsonCache = {};
    var reg = await o.ensureThemeRegistryFn();
    var themeIds = Object.keys(reg || {});
    if (!themeIds.length) themeIds = ['github-dark-default', 'github-light-default'];
    for (var i = 0; i < themeIds.length; i++) {
      var id = themeIds[i];
      var url = o.getThemeJsonUrlFn(id);
      if (!url) continue;
      try {
        var res = await o.fetchFn(url, { cache: 'no-store' });
        if (!res.ok) {
          console.warn('[MonacoTheme] missing vscode theme', id, res.status);
          continue;
        }
        var json = await res.json();
        o.state.jsonCache[id] = json;
        var monacoTheme = o.toMonacoThemeFn(id, json);
        o.win.monaco.editor.defineTheme(id, monacoTheme);
        console.log('[MonacoTheme] loaded vscode theme', id, 'rules=', monacoTheme.rules.length);
      } catch (e) {
        console.warn('[MonacoTheme] failed vscode theme', id, e);
      }
    }
    o.state.done = true;
  })();
  return o.state.promise;
}
