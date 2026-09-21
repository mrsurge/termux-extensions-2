import { completionTimeouts } from "../../protocol/completion-timeouts.mjs";

export interface CompletionWarmupDocument {
  path: string;
  languageId: string;
  uri: Record<string, unknown>;
}

interface CompletionWarmupOptions {
  documents(): CompletionWarmupDocument[];
  handles(document: CompletionWarmupDocument): number[];
  canRun(): boolean;
  request(document: CompletionWarmupDocument, handle: number): Promise<void>;
  onError(error: unknown): void;
  defer?(callback: () => void): void;
}

// Both readiness edges feed this one-shot coordinator. There is no timer/polling
// or per-file warming: one real request also satisfies its provider/language key.
export class CompletionWarmup {
  private attempted = new Set<string>();
  private epoch = 0;
  private scheduled = false;
  private running = false;

  constructor(private readonly options: CompletionWarmupOptions) {}

  reset(): void {
    this.epoch++;
    this.attempted.clear();
    this.scheduled = false;
    this.running = false;
  }

  markRequested(handle: number, languageId: string): void {
    this.attempted.add(`${handle}:${languageId}`);
  }

  notify(): void {
    if (this.scheduled || this.running) return;
    this.scheduled = true;
    const epoch = this.epoch;
    (this.options.defer ?? queueMicrotask)(() => {
      if (epoch !== this.epoch) return;
      this.scheduled = false;
      void this.drain(epoch);
    });
  }

  private async drain(epoch: number): Promise<void> {
    this.running = true;
    try {
      while (epoch === this.epoch && this.options.canRun()) {
        // Re-read after every await: closed files, new providers and project
        // switches must never reuse an old snapshot of the document registry.
        let candidate: { document: CompletionWarmupDocument; handle: number } | undefined;
        for (const document of this.options.documents()) {
          const handle = this.options.handles(document).find(
            value => !this.attempted.has(`${value}:${document.languageId}`),
          );
          if (handle !== undefined) { candidate = { document, handle }; break; }
        }
        if (!candidate) break;
        this.markRequested(candidate.handle, candidate.document.languageId);
        try {
          await this.options.request(candidate.document, candidate.handle);
        } catch (error) {
          if (epoch === this.epoch) this.options.onError(error);
        }
      }
    } catch (error) {
      if (epoch === this.epoch) this.options.onError(error);
    } finally {
      if (epoch === this.epoch) this.running = false;
    }
  }
}

interface WarmupRpc {
  request(handle: number, uri: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  release(handle: number, cacheId: number): void;
}

// Use the existing extension-host document without text synchronization, editor
// focus changes, or UI publication. Only retain timing/counts, never suggestions.
export async function warmCompletionProvider(
  rpc: WarmupRpc,
  document: CompletionWarmupDocument,
  handle: number,
): Promise<{ itemCount: number; incomplete: boolean }> {
  const reply = await rpc.request(handle, document.uri, completionTimeouts().providerMs);
  if (!isRecord(reply) || reply.type !== 9) throw new Error("Completion warm-up failed");
  const dto = isRecord(reply.result) ? reply.result : null;
  try {
    return { itemCount: Array.isArray(dto?.b) ? dto.b.length : 0, incomplete: dto?.c === true };
  } finally {
    if (typeof dto?.x === "number") rpc.release(handle, dto.x);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
