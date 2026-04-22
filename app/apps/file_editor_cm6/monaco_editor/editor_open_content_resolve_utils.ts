interface OpenCacheLike {
  has_draft?: unknown;
  content?: unknown;
  base_sha256?: unknown;
}

interface OpenContentResult {
  hasDraft: boolean;
  content: string;
  sha256: string | null;
}

export async function resolveOpenContent(
  fetchJsonWithBaseFn: (fetchFn: (url: string, init?: RequestInit) => Promise<unknown>, apiBase: URL | string, path: string, init?: RequestInit) => Promise<unknown>,
  fetchFn: (url: string, init?: RequestInit) => Promise<unknown>,
  apiBase: URL | string,
  absPath: string,
  cache: unknown,
): Promise<OpenContentResult> {
  const typedCache = cache != null && typeof cache === 'object' && !Array.isArray(cache)
    ? cache as OpenCacheLike
    : null;
  const hasDraft = !!(typedCache && typedCache.has_draft);
  let content = '';
  let sha256: string | null = null;
  if (hasDraft) {
    content = typeof typedCache?.content === 'string' ? typedCache.content : '';
    sha256 = typeof typedCache?.base_sha256 === 'string' ? typedCache.base_sha256 : null;
    return { hasDraft, content, sha256 };
  }
  const read = await fetchJsonWithBaseFn(fetchFn, apiBase, '/read?path=' + encodeURIComponent(absPath), { cache: 'no-store' }) as { content?: unknown; sha256?: unknown };
  content = typeof read.content === 'string' ? read.content : '';
  sha256 = typeof read.sha256 === 'string' ? read.sha256 : null;
  return { hasDraft, content, sha256 };
}
