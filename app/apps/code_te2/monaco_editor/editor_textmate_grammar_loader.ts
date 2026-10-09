/* Revision-scoped, bounded reads for the TextMate factory's grammar fan-out. */

const MAX_BATCH_SIZE = 16;
const MAX_ACTIVE_BATCHES = 2;

interface PendingBody {
  promise: Promise<string>;
  resolve(raw: string): void;
  reject(error: Error): void;
}

interface BatchReply {
  revision?: unknown;
  bodies?: unknown;
}

interface PendingClosure {
  promise: Promise<void>;
  reject(error: Error): void;
}

type GrammarRpcCall = (
  method: string,
  params: Record<string, unknown>,
  options: { timeoutMs: number },
) => Promise<unknown>;

export interface BundledGrammarBody { raw: string; sha256: string }
export type BundledGrammarLoader = () => Promise<Record<string, BundledGrammarBody>>;
export type HttpGrammarLoader = (id: string, revision: string, fingerprint?: string) => Promise<unknown>;

export function createTextmateGrammarBodyLoader(editorRpcCall: GrammarRpcCall, loadBundle?: BundledGrammarLoader, loadHttp?: HttpGrammarLoader): {
  load(id: string, revision: string): Promise<string>;
  prepare(scope: string, revision: string): Promise<void>;
  reset(): void;
} {
  let revision = '';
  let generation = 0;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let activeBatches = 0;
  const bodies = new Map<string, string>();
  const pending = new Map<string, PendingBody>();
  const queued = new Set<string>();
  const closures = new Map<string, PendingClosure>();

  function reset(): void {
    generation += 1;
    if (scheduled !== null) clearTimeout(scheduled);
    scheduled = null;
    activeBatches = 0;
    revision = '';
    bodies.clear();
    for (const closure of closures.values()) closure.reject(new Error('TextMate projection superseded'));
    closures.clear();
    queued.clear();
    for (const item of pending.values()) item.reject(new Error('TextMate projection superseded'));
    pending.clear();
  }

  function schedule(): void {
    if (scheduled !== null || !queued.size || activeBatches >= MAX_ACTIVE_BATCHES) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      void drain();
    }, 0);
  }

  function complete(id: string, item: PendingBody, raw: string | null, error: Error | null): void {
    if (pending.get(id) !== item) return;
    pending.delete(id);
    if (raw !== null) {
      bodies.set(id, raw);
      item.resolve(raw);
    } else {
      item.reject(error || new Error(`Failed to load grammar ${id}`));
    }
  }

  async function readChunks(id: string, requestRevision: string, requestGeneration: number, fingerprint?: string): Promise<string> {
    if (loadHttp) {
      const result = await loadHttp(id, requestRevision, fingerprint);
      if (generation !== requestGeneration) throw new Error('TextMate projection superseded');
      const body = result as Record<string, unknown> | null;
      if (!body || body.id !== id || body.revision !== requestRevision
          || typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)
          || (fingerprint !== undefined && body.sha256 !== fingerprint)
          || typeof body.raw !== 'string' || !body.raw
          || new TextEncoder().encode(body.raw).byteLength > 4 * 1024 * 1024) {
        throw new Error('Invalid HTTP TextMate grammar');
      }
      return body.raw;
    }
    let offset = 0, raw = '', bytes = 0;
    while (true) {
      if (generation !== requestGeneration) throw new Error('TextMate projection superseded');
      const chunk = await editorRpcCall('editor.textmate.chunk.get',
        { id, revision: requestRevision, offset }, { timeoutMs: 8000 }) as Record<string, unknown>;
      if (generation !== requestGeneration) throw new Error('TextMate projection superseded');
      if (!chunk || chunk.id !== id || chunk.revision !== requestRevision
          || typeof chunk.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(chunk.sha256)
          || (fingerprint !== undefined && chunk.sha256 !== fingerprint)
          || chunk.offset !== offset || typeof chunk.raw !== 'string' || !chunk.raw
          || chunk.nextOffset !== offset + Array.from(chunk.raw).length
          || new TextEncoder().encode(chunk.raw).byteLength > 65536 || typeof chunk.done !== 'boolean') {
        throw new Error('Invalid TextMate grammar chunk');
      }
      fingerprint ??= chunk.sha256;
      raw += chunk.raw;
      bytes += new TextEncoder().encode(chunk.raw).byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error('TextMate grammar too large');
      offset = chunk.nextOffset as number;
      if (chunk.done) return raw;
    }
  }

  async function drain(): Promise<void> {
    if (!queued.size || activeBatches >= MAX_ACTIVE_BATCHES) return;
    const ids = Array.from(queued).slice(0, MAX_BATCH_SIZE);
    for (const id of ids) queued.delete(id);
    const items = ids.map((id) => pending.get(id));
    const requestGeneration = generation;
    const requestRevision = revision;
    activeBatches += 1;
    schedule();
    try {
      if (loadBundle) {
        // Oversized closure prefixes still discover further dependencies through
        // TextMate; those misses must remain bounded too.
        for (const [index, id] of ids.entries()) {
          const raw = await readChunks(id, requestRevision, requestGeneration);
          const item = items[index];
          if (item && generation === requestGeneration) complete(id, item, raw, null);
        }
        return;
      }
      const reply = await editorRpcCall(
        'editor.textmate.grammars.get',
        { ids, revision: requestRevision },
        { timeoutMs: 8000 },
      ) as BatchReply;
      if (generation !== requestGeneration) return;
      if (!reply || reply.revision !== requestRevision || !reply.bodies || typeof reply.bodies !== 'object') {
        throw new Error('TextMate grammar batch revision mismatch');
      }
      const returned = reply.bodies as Record<string, unknown>;
      ids.forEach((id, index) => {
        const item = items[index];
        if (!item) return;
        const body = returned[id];
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          const record = body as Record<string, unknown>;
          if (record.ok === true && typeof record.raw === 'string' && record.raw) {
            complete(id, item, record.raw, null);
            return;
          }
          complete(id, item, null, new Error(typeof record.error === 'string' ? record.error : `Failed to load grammar ${id}`));
          return;
        }
        complete(id, item, null, new Error(`Missing grammar batch result ${id}`));
      });
    } catch (error) {
      if (generation === requestGeneration) {
        const failure = error instanceof Error ? error : new Error(String(error));
        ids.forEach((id, index) => {
          const item = items[index];
          if (item) complete(id, item, null, failure);
        });
      }
    } finally {
      if (generation === requestGeneration) activeBatches -= 1;
      schedule();
    }
  }

  function load(id: string, requestedRevision: string): Promise<string> {
    if (revision !== requestedRevision) {
      reset();
      revision = requestedRevision;
    }
    const cached = bodies.get(id);
    if (cached !== undefined) return Promise.resolve(cached);
    const inFlight = pending.get(id);
    if (inFlight) return inFlight.promise;
    let resolve!: (raw: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    pending.set(id, { promise, resolve, reject });
    queued.add(id);
    schedule();
    return promise;
  }

  function prepare(scope: string, requestedRevision: string): Promise<void> {
    if (revision !== requestedRevision) {
      reset();
      revision = requestedRevision;
    }
    const existing = closures.get(scope);
    if (existing) return existing.promise;
    const requestGeneration = generation;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    const pendingClosure = { promise, reject };
    closures.set(scope, pendingClosure);
    void promise.catch(() => { if (closures.get(scope) === pendingClosure) closures.delete(scope); });
    void (async () => {
      const result = await editorRpcCall('editor.textmate.closure.get',
        { scope, revision: requestedRevision, knownIds: Array.from(bodies.keys()), ...(loadBundle ? { metadataOnly: true } : {}) }, { timeoutMs: 8000 });
      if (generation !== requestGeneration) throw new Error('TextMate projection superseded');
      if (!result || typeof result !== 'object') throw new Error('Invalid TextMate closure');
      const reply = result as Record<string, unknown>;
      if (reply.revision !== requestedRevision || reply.rootScope !== scope || !Array.isArray(reply.ids)
          || (reply.ids.length === 0 && reply.complete !== false) || reply.ids.length > 256 || !reply.bodies || typeof reply.bodies !== 'object'
          || Array.isArray(reply.bodies)) throw new Error('Invalid TextMate closure');
      const returned = reply.bodies as Record<string, unknown>;
      const seeds = new Map<string, string>();
      if (loadBundle) {
        if (typeof reply.complete !== 'boolean' || !reply.fingerprints || typeof reply.fingerprints !== 'object' || Array.isArray(reply.fingerprints)) {
          throw new Error('Invalid TextMate closure fingerprints');
        }
        const fingerprints = reply.fingerprints as Record<string, unknown>;
        const bundle = await loadBundle();
        const missing: string[] = [];
        for (const id of reply.ids) {
          if (typeof id !== 'string' || !id || typeof fingerprints[id] !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprints[id] as string)) {
            throw new Error('Invalid TextMate closure identity');
          }
          if (bodies.has(id)) continue;
          const local = bundle[id];
          if (local && local.sha256 === fingerprints[id] && typeof local.raw === 'string' && local.raw) seeds.set(id, local.raw);
          else missing.push(id);
        }
        // At most two bounded streams; never put a multi-megabyte closure on RPC.
        let index = 0;
        let failed = false;
        const stream = async () => {
          while (!failed && index < missing.length) {
            const id = missing[index++];
            try { seeds.set(id, await readChunks(id, requestedRevision, requestGeneration, fingerprints[id] as string)); }
            catch (error) { failed = true; throw error; }
          }
        };
        await Promise.all([stream(), stream()]);
        if (generation !== requestGeneration) throw new Error('TextMate projection superseded');
        for (const [id, raw] of seeds) bodies.set(id, raw);
        return;
      }
      for (const id of reply.ids) {
        if (typeof id !== 'string' || !id) throw new Error('Invalid TextMate closure identity');
        const body = returned[id];
        if (body === undefined && bodies.has(id)) continue;
        if (!body || typeof body !== 'object') throw new Error(`Missing TextMate closure body ${id}`);
        const value = body as Record<string, unknown>;
        if (value.ok !== true || value.revision !== requestedRevision || typeof value.raw !== 'string' || !value.raw) {
          throw new Error(`Invalid TextMate closure body ${id}`);
        }
        seeds.set(id, value.raw);
      }
      // Validate the entire response before making any partial result reusable.
      for (const [id, raw] of seeds) bodies.set(id, raw);
    })().then(resolve, (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
    return promise;
  }

  return { load, prepare, reset };
}
