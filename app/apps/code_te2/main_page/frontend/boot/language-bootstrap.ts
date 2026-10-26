import { isUnknownArray } from '../../../src/rpc/value-types.ts';
import type { HostBootSnapshot } from './boot-snapshot.ts';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !isUnknownArray(value)
    ? value as Record<string, unknown> : null;
}

// Dynamic backend state, not an APK/OTA-intercepted static asset. A 404 from an
// older server explicitly selects its existing RPC; transport failures do not.
export function createLanguageBootstrapRequest(
  fetchFn: typeof fetch,
): () => Promise<HostBootSnapshot | null> {
  let unsupported = false;
  return async () => {
    if (unsupported) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetchFn('/api/app/code_te2/startup/language', {
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (response.status === 404) {
        unsupported = true;
        return null;
      }
      if (!response.ok) throw new Error(`Language startup HTTP ${response.status}`);
      // Bound decoded response bytes, including chunked/compressed responses.
      if (!response.body) throw new Error('Missing language startup response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 32 * 1024) throw new Error('Language startup response too large');
          chunks.push(part.value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const snapshot = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
      const prefs = record(snapshot?.ui_prefs);
      const status = record(snapshot?.code_server);
      if (typeof prefs?.webWorkersEnabled !== 'boolean' ||
          typeof status?.compatible !== 'boolean' ||
          !['ready', 'missing', 'incompatible'].includes(String(status.state)) ||
          (status.compatible !== (status.state === 'ready')) ||
          (status.compatible === false &&
            (typeof status.reason !== 'string' || !status.reason ||
             typeof status.install_version !== 'string' || !status.install_version))) {
        throw new Error('Invalid backend language startup state');
      }
      return { ui_prefs: prefs, code_server: status };
    } finally { clearTimeout(timer); }
  };
}
