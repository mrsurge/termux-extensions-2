interface MonacoUriNamespaceLike {
  file?(path: string): unknown;
}

interface MonacoUriContainerLike {
  Uri?: MonacoUriNamespaceLike;
}

interface MonacoLanguageDescriptorLike {
  id?: unknown;
  aliases?: unknown;
}

export function normalizeLanguageId(lang: unknown): string {
  if (!lang) return 'plaintext';
  const value = String(lang).toLowerCase();
  if (value === 'text') return 'plaintext';
  if (value === 'shell') return 'shell';
  if (value === 'cpp') return 'cpp';
  return value;
}

export function resolveMonacoLanguageId(
  language: unknown,
  registeredLanguages: readonly MonacoLanguageDescriptorLike[] | null | undefined,
): string {
  const requested = String(language || '').trim().toLowerCase();
  if (!requested) return '';
  for (const descriptor of registeredLanguages || []) {
    const id = typeof descriptor.id === 'string' ? descriptor.id.trim() : '';
    if (!id) continue;
    if (id.toLowerCase() === requested) return id;
    if (
      Array.isArray(descriptor.aliases) &&
      descriptor.aliases.some(
        (alias) => typeof alias === 'string' && alias.trim().toLowerCase() === requested,
      )
    ) {
      return id;
    }
  }
  return normalizeLanguageId(requested);
}

export function languageIdFromPath(
  path: string | null | undefined,
  byFilename?: Map<string, string> | null,
  byExtension?: Map<string, string> | null,
): string {
  try {
    const loweredPath = String(path || '').toLowerCase();
    try {
      const fullPath = String(path || '');
      const baseName = fullPath.split('/').pop() || fullPath;
      if (byFilename?.size) {
        const byName = byFilename.get(baseName);
        if (byName) return normalizeLanguageId(byName);
      }
      if (byExtension?.size) {
        let best: string | null = null;
        let bestLen = 0;
        for (const [ext, langId] of byExtension.entries()) {
          if (!ext || !langId) continue;
          if (loweredPath.endsWith(ext.toLowerCase()) && ext.length > bestLen) {
            best = langId;
            bestLen = ext.length;
          }
        }
        if (best) return normalizeLanguageId(best);
      }
    } catch (_) {}
    if (loweredPath.endsWith('.py') || loweredPath.endsWith('.pyw')) return 'python';
    if (loweredPath.endsWith('.js') || loweredPath.endsWith('.mjs') || loweredPath.endsWith('.cjs')) return 'javascript';
    if (loweredPath.endsWith('.ts') || loweredPath.endsWith('.tsx')) return 'typescript';
    if (loweredPath.endsWith('.c')) return 'c';
    if (
      loweredPath.endsWith('.cc') ||
      loweredPath.endsWith('.cpp') ||
      loweredPath.endsWith('.cxx') ||
      loweredPath.endsWith('.h') ||
      loweredPath.endsWith('.hh') ||
      loweredPath.endsWith('.hpp') ||
      loweredPath.endsWith('.hxx')
    ) return 'cpp';
    if (loweredPath.endsWith('.kt') || loweredPath.endsWith('.kts')) return 'kotlin';
    if (loweredPath.endsWith('.html') || loweredPath.endsWith('.htm')) return 'html';
    if (loweredPath.endsWith('.css')) return 'css';
    if (loweredPath.endsWith('.json') || loweredPath.endsWith('.webmanifest')) return 'json';
    if (loweredPath.endsWith('.md') || loweredPath.endsWith('.mdx')) return 'markdown';
    if (loweredPath.endsWith('.sh') || loweredPath.endsWith('.bash') || loweredPath.endsWith('.zsh')) return 'shell';
    if (loweredPath.endsWith('.yml') || loweredPath.endsWith('.yaml')) return 'yaml';
    if (loweredPath.endsWith('.toml')) return 'toml';
    return 'plaintext';
  } catch (_) {
    return 'plaintext';
  }
}

export function monacoFileUri(
  monacoObj: MonacoUriContainerLike | null | undefined,
  absPath: string | null | undefined,
): unknown {
  try {
    return monacoObj?.Uri?.file ? monacoObj.Uri.file(String(absPath || '')) : null;
  } catch (_) {
    return null;
  }
}
