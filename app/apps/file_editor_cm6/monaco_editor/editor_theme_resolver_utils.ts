export function resolveMonacoThemeId(
  themeKey: string,
  themeCache: Record<string, unknown> | null | undefined,
): string {
  try {
    const key = String(themeKey || '').trim();
    if (themeCache && themeCache[key]) return key;
    if (key === 'vs-dark' || key === 'hc-black') return 'github-dark-default';
    if (key === 'vs' || key === 'hc-light') return 'github-light-default';
    if (key.toLowerCase().includes('light')) return 'github-light-default';
    return 'github-dark-default';
  } catch (_) {
    return 'github-dark-default';
  }
}
