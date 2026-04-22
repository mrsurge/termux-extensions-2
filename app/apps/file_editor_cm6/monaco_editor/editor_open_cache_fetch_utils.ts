export async function fetchOpenCache(
  fetchJsonWithBaseFn: (fetchFn: (url: string, init?: RequestInit) => Promise<unknown>, apiBase: URL | string, path: string, init?: RequestInit) => Promise<unknown>,
  fetchFn: (url: string, init?: RequestInit) => Promise<unknown>,
  apiBase: URL | string,
  absPath: string,
): Promise<unknown | null> {
  try {
    return await fetchJsonWithBaseFn(fetchFn, apiBase, '/editor/check_cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absPath }),
    });
  } catch (_) {
    return null;
  }
}
