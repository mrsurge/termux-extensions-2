export type ExtRequestAccept = (message: Record<string, unknown>) => boolean;

export interface SentExtMeta {
  rpcId: number;
  method: string;
  ts_ms: number;
}

export interface PendingCreateOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
  accept?: ExtRequestAccept;
}

interface PendingEntry {
  accept?: ExtRequestAccept;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingExtRequestOwnerOptions {
  maxSentMeta?: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

function getMessageReq(message: unknown): number | null {
  if (!message || typeof message !== "object") return null;
  const req = (message as { req?: unknown }).req;
  return typeof req === "number" && Number.isFinite(req) ? req : null;
}

export class PendingExtRequestOwner {
  private readonly maxSentMeta: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly sentMeta = new Map<number, SentExtMeta>();
  private readonly sentMetaOrder: number[] = [];
  private nextReqId = 1;

  constructor(options: PendingExtRequestOwnerOptions = {}) {
    this.maxSentMeta = Math.max(1, Number(options.maxSentMeta ?? 500));
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  allocReqId(): number {
    const req = this.nextReqId >>> 0;
    this.nextReqId = (this.nextReqId + 1) >>> 0;
    return req === 0 ? this.allocReqId() : req;
  }

  resetReqIds(): void {
    this.nextReqId = 1;
  }

  trackSent(req: number, rpcId: number, method: string): void {
    this.sentMeta.set(req, { rpcId, method, ts_ms: this.now() });
    this.sentMetaOrder.push(req);
    while (this.sentMetaOrder.length > this.maxSentMeta) {
      const oldest = this.sentMetaOrder.shift();
      if (typeof oldest === "number") this.sentMeta.delete(oldest);
    }
  }

  getSentMeta(req: number): SentExtMeta | undefined {
    return this.sentMeta.get(req);
  }

  deleteSentMeta(req: number): void {
    this.sentMeta.delete(req);
  }

  get pendingSize(): number {
    return this.pending.size;
  }

  get sentMetaSize(): number {
    return this.sentMeta.size;
  }

  has(req: number): boolean {
    return this.pending.has(req);
  }

  createPromise(req: number, options: PendingCreateOptions): Promise<unknown> {
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 1);
    return new Promise((resolve, reject) => {
      const timer = this.setTimeoutFn(() => {
        if (!this.pending.has(req)) return;
        this.pending.delete(req);
        if (Object.prototype.hasOwnProperty.call(options, "timeoutResult")) {
          resolve(options.timeoutResult);
          return;
        }
        reject(new Error(options.timeoutMessage));
      }, timeoutMs);
      const entry: PendingEntry = {
        resolve: (value) => {
          this.clearTimeoutFn(timer);
          resolve(value);
        },
        reject: (error) => {
          this.clearTimeoutFn(timer);
          reject(error);
        },
        timer,
      };
      if (options.accept) entry.accept = options.accept;
      this.pending.set(req, entry);
    });
  }

  resolveReply(message: Record<string, unknown>): boolean {
    const req = getMessageReq(message);
    if (req === null) return false;
    const entry = this.pending.get(req);
    if (!entry) return false;
    if (entry.accept && !entry.accept(message)) return false;
    this.pending.delete(req);
    entry.resolve(message);
    return true;
  }

  rejectAll(reason: Error): number {
    const count = this.pending.size;
    for (const entry of this.pending.values()) {
      try {
        entry.reject(reason);
      } catch {
        // Keep rejecting the remaining pending requests.
      }
    }
    this.pending.clear();
    return count;
  }

  clear(): void {
    for (const entry of this.pending.values()) {
      this.clearTimeoutFn(entry.timer);
    }
    this.pending.clear();
    this.sentMeta.clear();
    this.sentMetaOrder.length = 0;
  }
}
