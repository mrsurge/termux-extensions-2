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

type GrammarRpcCall = (
  method: string,
  params: Record<string, unknown>,
  options: { timeoutMs: number },
) => Promise<unknown>;

export function createTextmateGrammarBodyLoader(editorRpcCall: GrammarRpcCall): {
  load(id: string, revision: string): Promise<string>;
  reset(): void;
} {
  let revision = '';
  let generation = 0;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let activeBatches = 0;
  const bodies = new Map<string, string>();
  const pending = new Map<string, PendingBody>();
  const queued = new Set<string>();

  function reset(): void {
    generation += 1;
    if (scheduled !== null) clearTimeout(scheduled);
    scheduled = null;
    activeBatches = 0;
    revision = '';
    bodies.clear();
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

  return { load, reset };
}
