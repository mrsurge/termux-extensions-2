export function normalizeLanguageId(lang) {
  if (!lang) return 'plaintext';
  var s = String(lang).toLowerCase();
  if (s === 'text') return 'plaintext';
  if (s === 'shell') return 'shell';
  if (s === 'cpp') return 'cpp';
  return s;
}

export function languageIdFromPath(path, byFilename, byExtension) {
  try {
    var p = String(path || '').toLowerCase();
    try {
      var full = String(path || '');
      var base = full.split('/').pop() || full;
      if (byFilename && byFilename.size) {
        var byName = byFilename.get(base);
        if (byName) return normalizeLanguageId(byName);
      }
      if (byExtension && byExtension.size) {
        var best = null;
        var bestLen = 0;
        for (const [ext, langId] of byExtension.entries()) {
          if (!ext || typeof ext !== 'string') continue;
          if (!langId) continue;
          if (p.endsWith(ext.toLowerCase()) && ext.length > bestLen) {
            best = langId;
            bestLen = ext.length;
          }
        }
        if (best) return normalizeLanguageId(best);
      }
    } catch (_) {}
    if (p.endsWith('.py') || p.endsWith('.pyw')) return 'python';
    if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript';
    if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'typescript';
    if (p.endsWith('.c')) return 'c';
    if (p.endsWith('.cc') || p.endsWith('.cpp') || p.endsWith('.cxx') || p.endsWith('.h') || p.endsWith('.hh') || p.endsWith('.hpp') || p.endsWith('.hxx')) return 'cpp';
    if (p.endsWith('.kt') || p.endsWith('.kts')) return 'kotlin';
    if (p.endsWith('.html') || p.endsWith('.htm')) return 'html';
    if (p.endsWith('.css')) return 'css';
    if (p.endsWith('.json') || p.endsWith('.webmanifest')) return 'json';
    if (p.endsWith('.md') || p.endsWith('.mdx')) return 'markdown';
    if (p.endsWith('.sh') || p.endsWith('.bash') || p.endsWith('.zsh')) return 'shell';
    if (p.endsWith('.yml') || p.endsWith('.yaml')) return 'yaml';
    return 'plaintext';
  } catch (_) {
    return 'plaintext';
  }
}

export function monacoFileUri(monacoObj, absPath) {
  try {
    if (!monacoObj || !monacoObj.Uri || !monacoObj.Uri.file) return null;
    return monacoObj.Uri.file(String(absPath || ''));
  } catch (_) { return null; }
}
