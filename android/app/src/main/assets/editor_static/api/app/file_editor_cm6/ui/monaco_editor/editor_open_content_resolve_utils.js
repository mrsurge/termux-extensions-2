export async function resolveOpenContent(fetchJsonWithBaseFn, fetchFn, apiBase, absPath, cache) {
  var hasDraft = !!(cache && cache.has_draft);
  var content = '';
  var sha256 = null;
  if (hasDraft) {
    content = typeof cache.content === 'string' ? cache.content : '';
    sha256 = (cache.base_sha256 && typeof cache.base_sha256 === 'string') ? cache.base_sha256 : null;
    return { hasDraft: hasDraft, content: content, sha256: sha256 };
  }
  var read = await fetchJsonWithBaseFn(fetchFn, apiBase, '/read?path=' + encodeURIComponent(absPath), { cache: 'no-store' });
  content = typeof read.content === 'string' ? read.content : '';
  sha256 = (read.sha256 && typeof read.sha256 === 'string') ? read.sha256 : null;
  return { hasDraft: hasDraft, content: content, sha256: sha256 };
}
