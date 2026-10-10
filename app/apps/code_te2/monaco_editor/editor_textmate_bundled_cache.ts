import type { BundledGrammarBody, BundledGrammarLoader } from './editor_textmate_grammar_loader.ts';
import { grammarSha256 } from './editor_textmate_sha256.ts';

// Selection/fingerprints come from editor RPC; bodies use the client-local asset.
export function createBundledGrammarCache(fetchAsset: () => Promise<Response>): BundledGrammarLoader {
  let pending: Promise<Record<string, BundledGrammarBody>> | null = null;
  return () => pending ??= (async () => {
    const response = await fetchAsset();
    if (!response.ok) throw new Error(`Bundled TextMate cache HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object') throw new Error('Invalid bundled TextMate cache');
    const cache = value as Record<string, unknown>;
    if (cache.schema !== 1 || !cache.bodies || typeof cache.bodies !== 'object' || Array.isArray(cache.bodies)) {
      throw new Error('Invalid bundled TextMate cache');
    }
    const bodies: Record<string, BundledGrammarBody> = Object.create(null);
    if (Object.keys(cache.bodies).length > 256) throw new Error('Bundled TextMate cache too large');
    let bytes = 0;
    for (const [id, body] of Object.entries(cache.bodies)) {
      if (!body || typeof body !== 'object') throw new Error('Invalid bundled grammar');
      const entry = body as Record<string, unknown>;
      if (typeof entry.raw !== 'string' || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        throw new Error('Invalid bundled grammar');
      }
      const encoded = new TextEncoder().encode(entry.raw);
      bytes += encoded.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('Bundled TextMate cache too large');
      const actual = await grammarSha256(encoded);
      if (actual === entry.sha256) bodies[id] = { raw: entry.raw, sha256: entry.sha256 };
    }
    return bodies;
  })().catch(error => {
    console.warn('[TextMate] bundled cache unavailable', error);
    return Object.create(null) as Record<string, BundledGrammarBody>;
  });
}
