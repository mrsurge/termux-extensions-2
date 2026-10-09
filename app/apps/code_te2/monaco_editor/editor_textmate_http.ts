/* Dynamic browser resources are separate from native packaged asset routes. */
export function usesHttpGrammarResources(win: Window): boolean {
  if (new URLSearchParams(win.location.search).get('gv_native') === '1') return false;
  if ('te2Electron' in win) return false;
  try { if ('te2Electron' in win.parent) return false; } catch { /* cross-origin browser embed */ }
  return true;
}

export function createHttpGrammarLoader(
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  resourceUrl: string,
): (id: string, revision: string, fingerprint?: string) => Promise<unknown> {
  return async (id, revision, fingerprint) => {
    const query = new URLSearchParams({ id, revision, ...(fingerprint ? { sha256: fingerprint } : {}) });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchFn(`${resourceUrl}?${query}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`TextMate grammar HTTP ${response.status}`);
      // Limit decompressed bytes, not Content-Length (which may describe gzip).
      if (!response.body) throw new Error('Missing TextMate grammar body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          // JSON escaping can expand a four-MiB grammar up to sixfold.
          if (size > 24 * 1024 * 1024 + 8192) throw new Error('TextMate HTTP resource too large');
          chunks.push(part.value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } finally { clearTimeout(timeout); }
  };
}
