// Disposable content cache, never catalog/selection authority. No project data.
import { grammarSha256 } from './editor_textmate_sha256.ts';
export interface GrammarIdentity { id: string; sha256: string }
export interface GrammarRecord extends GrammarIdentity { raw: string; bytes: number; touched: number }
export interface GrammarStorage {
  read(keys: string[]): Promise<unknown[]>;
  write(records: GrammarRecord[]): Promise<void>;
}
export interface PersistentGrammarCache {
  read(identities: GrammarIdentity[]): Promise<Map<string, string>>;
  write(identity: GrammarIdentity, raw: string): void;
}
const MAX_BODY = 4 * 1024 * 1024;
const MAX_BATCH = 8 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_STORED = 32 * 1024 * 1024;
const key = ({ id, sha256 }: GrammarIdentity) => JSON.stringify([id, sha256]);
const validIdentity = (value: GrammarIdentity) => typeof value.id === 'string' && value.id.length > 0
  && value.id.length <= 4096 && /^[a-f0-9]{64}$/.test(value.sha256);

function indexedStorage(): GrammarStorage {
  let pending: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    return pending ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('te2-textmate-bodies', 1);
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('Grammar database open timeout')); }, 250);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('bodies');
        request.result.createObjectStore('metadata');
      };
      request.onerror = request.onblocked = () => {
        settled = true; clearTimeout(timer); reject(new Error('Grammar database unavailable'));
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => { request.result.close(); pending = null; };
        resolve(request.result);
      };
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['bodies', 'metadata'], mode);
      let result: T;
      const timer = setTimeout(() => { tx.abort(); }, mode === 'readonly' ? 250 : 2000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(new Error('Grammar database transaction failed')); };
      try { run(tx, value => { result = value; }); }
      catch (error) { clearTimeout(timer); tx.abort(); reject(error); }
    });
  }
  return {
    async read(keys) {
      return transaction<unknown[]>('readonly', (tx, done) => {
        const values: unknown[] = Array(keys.length);
        let admitted = 0;
        keys.forEach((k, index) => {
          // Inspect small metadata before cloning potentially large body strings.
          const metadata = tx.objectStore('metadata').get(k);
          metadata.onsuccess = () => {
            const row = metadata.result as { bytes?: unknown } | undefined;
            if (!row || !Number.isSafeInteger(row.bytes) || (row.bytes as number) <= 0
                || (row.bytes as number) > MAX_BODY || admitted + (row.bytes as number) > MAX_BATCH) return;
            admitted += row.bytes as number;
            const request = tx.objectStore('bodies').get(k);
            request.onsuccess = () => { values[index] = request.result as unknown; };
          };
        });
        done(values);
      });
    },
    async write(records) {
      await transaction<void>('readwrite', (tx, done) => {
        const bodies = tx.objectStore('bodies');
        const metadata = tx.objectStore('metadata');
        const entries: { key: string; bytes: number; touched: number }[] = [];
        const cursor = metadata.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) {
            const value = row.value as Record<string, unknown>;
            if (entries.length >= MAX_ENTRIES || typeof row.key !== 'string'
                || !Number.isSafeInteger(value?.bytes) || (value.bytes as number) < 0
                || (value.bytes as number) > MAX_BODY || typeof value.touched !== 'number' || !Number.isFinite(value.touched)) {
              // Only this disposable cache's stores; never touch other databases.
              bodies.clear(); metadata.clear(); entries.length = 0;
            } else {
              entries.push({ key: row.key, bytes: value.bytes as number, touched: value.touched });
              row.continue(); return;
            }
          }
          const updates = new Map(entries.map(entry => [entry.key, entry]));
          for (const record of records) {
            const k = key(record);
            bodies.put(record, k);
            metadata.put({ bytes: record.bytes, touched: record.touched }, k);
            updates.set(k, { key: k, bytes: record.bytes, touched: record.touched });
          }
          let size = Array.from(updates.values()).reduce((total, entry) => total + entry.bytes, 0);
          for (const entry of Array.from(updates.values()).sort((a, b) => a.touched - b.touched)) {
            if (updates.size <= MAX_ENTRIES && size <= MAX_STORED) break;
            bodies.delete(entry.key); metadata.delete(entry.key);
            updates.delete(entry.key); size -= entry.bytes;
          }
          done(undefined);
        };
      });
    },
  };
}

export function createPersistentGrammarCache(storage?: GrammarStorage): PersistentGrammarCache {
  let disabled = !storage && typeof indexedDB === 'undefined';
  const disk = storage ?? indexedStorage();
  let queued = new Map<string, GrammarRecord>();
  let queuedBytes = 0;
  let writing = false;
  let scheduled = false;
  async function verified(raw: string, identity: GrammarIdentity): Promise<boolean> {
    return await grammarSha256(new TextEncoder().encode(raw)) === identity.sha256;
  }
  function schedule(): void {
    if (scheduled || writing || disabled || !queued.size) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false; writing = true;
      const batch = Array.from(queued.values()); queued = new Map(); queuedBytes = 0;
      void (async () => {
        const valid: GrammarRecord[] = [];
        for (const record of batch) if (await verified(record.raw, record)) valid.push(record);
        if (valid.length) await disk.write(valid);
      })().catch(() => { disabled = true; queued.clear(); queuedBytes = 0; })
        .finally(() => { writing = false; schedule(); });
    }, 0);
  }
  return {
    async read(identities) {
      const hits = new Map<string, string>();
      if (disabled || identities.length > 256 || identities.some(value => !validIdentity(value))) return hits;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          (async () => {
            const rows = await disk.read(identities.map(key));
            let total = 0;
            for (const [index, identity] of identities.entries()) {
              const row = rows[index] as Partial<GrammarRecord> | null;
              if (!row || row.id !== identity.id || row.sha256 !== identity.sha256
                  || typeof row.raw !== 'string' || !row.raw || row.raw.length > MAX_BODY || !Number.isSafeInteger(row.bytes)
                  || row.bytes! <= 0 || row.bytes! > MAX_BODY) continue;
              const bytes = new TextEncoder().encode(row.raw).byteLength;
              total += bytes;
              if (total > MAX_BATCH) break;
              if (bytes === row.bytes && await verified(row.raw, identity)) hits.set(identity.id, row.raw);
            }
            return hits;
          })(),
          new Promise<Map<string, string>>((_, reject) => { timer = setTimeout(() => reject(new Error('Grammar cache read timeout')), 250); }),
        ]);
        return result;
      } catch { disabled = true; return new Map(); }
      finally { if (timer) clearTimeout(timer); }
    },
    write(identity, raw) {
      if (disabled || !validIdentity(identity) || !raw || raw.length > MAX_BODY) return;
      const bytes = new TextEncoder().encode(raw).byteLength;
      if (bytes > MAX_BODY || queued.size >= 256) return;
      const k = key(identity);
      const previous = queued.get(k)?.bytes ?? 0;
      if (queuedBytes - previous + bytes > MAX_BATCH) return;
      queued.set(k, { ...identity, raw, bytes, touched: Date.now() });
      queuedBytes += bytes - previous; schedule();
    },
  };
}
