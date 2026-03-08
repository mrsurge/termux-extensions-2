export function resolveMonacoThemeId(themeKey, themeCache) {
  try {
    var key = String(themeKey || '').trim();
    if (themeCache && themeCache[key]) return key;
    if (key === 'vs-dark' || key === 'hc-black') return 'github-dark-default';
    if (key === 'vs' || key === 'hc-light') return 'github-light-default';
    var t = key.toLowerCase();
    if (t.includes('light')) return 'github-light-default';
    return 'github-dark-default';
  } catch (_) {
    return 'github-dark-default';
  }
}
