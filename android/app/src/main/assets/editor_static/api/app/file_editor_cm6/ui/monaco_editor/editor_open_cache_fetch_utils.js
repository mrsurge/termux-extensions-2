export async function fetchOpenCache(fetchJsonWithBaseFn, fetchFn, apiBase, absPath) {
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
