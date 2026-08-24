import { createHash } from "node:crypto";

export interface SemanticProjectionDocument {
  path: string;
  versionId: number;
  contentIdentity: string | null;
  languageId: string;
  textFingerprint: string;
  projectGeneration: number | null;
  clientForeground: boolean;
}

export interface SemanticProjectionFullResult {
  type: "full";
  resultId: string;
  data: number[];
  dto: {
    id: number;
    type: "full";
    data: number[];
  };
  legend?: unknown;
  providerHandle?: number;
}

interface StoredSemanticProjection {
  document: SemanticProjectionDocument;
  providerGeneration: number;
  resultId: string;
  data: Uint32Array;
  legend?: unknown;
  providerHandle?: number;
  byteLength: number;
  lastAccess: number;
}

export interface SemanticTokenProjectionManagerOptions {
  getDocument: (path: string) => SemanticProjectionDocument | null;
  listBackgroundPaths: () => string[];
  compute: (path: string) => Promise<unknown>;
  releaseResult?: (providerHandle: number, resultId: string) => void;
  canRun?: () => boolean;
  defer?: (callback: () => void, delayMs: number) => unknown;
  maxBytes?: number;
  log?: (message: string) => void;
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

function sameDocument(
  left: SemanticProjectionDocument,
  right: SemanticProjectionDocument,
): boolean {
  return (
    left.path === right.path &&
    left.versionId === right.versionId &&
    left.contentIdentity === right.contentIdentity &&
    left.languageId === right.languageId &&
    left.textFingerprint === right.textFingerprint &&
    left.projectGeneration === right.projectGeneration
  );
}

function numericResultId(resultId: string): number {
  const value = Number(resultId);
  return Number.isFinite(value) ? value : 0;
}

export function semanticTextFingerprint(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const digest = createHash("sha256")
    .update(normalized, "utf8")
    .digest("base64url");
  return `${normalized.length}:${digest}`;
}

/**
 * Retains exact full-document token maps for logical WBA documents. Range
 * providers intentionally never pass through this manager.
 */
export class SemanticTokenProjectionManager {
  private readonly entries = new Map<string, StoredSemanticProjection>();
  private readonly queued = new Set<string>();
  private providerGeneration = 0;
  private totalBytes = 0;
  private accessClock = 0;
  private timerPending = false;
  private draining = false;

  constructor(
    private readonly options: SemanticTokenProjectionManagerOptions,
  ) {}

  get bytes(): number {
    return this.totalBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get generation(): number {
    return this.providerGeneration;
  }

  get(
    path: string,
    languageId: string,
    textFingerprint?: string | null,
  ): SemanticProjectionFullResult | null {
    const stored = this.entries.get(path);
    const current = this.options.getDocument(path);
    if (
      !stored ||
      !current ||
      !this.isStoredCurrent(stored, current) ||
      stored.document.languageId !== languageId ||
      (textFingerprint != null &&
        stored.document.textFingerprint !== textFingerprint)
    ) {
      if (stored) this.delete(path);
      return null;
    }

    stored.lastAccess = ++this.accessClock;
    const data = Array.from(stored.data);
    return {
      type: "full",
      resultId: stored.resultId,
      data,
      dto: {
        id: numericResultId(stored.resultId),
        type: "full",
        data,
      },
      legend: stored.legend,
    };
  }

  store(
    document: SemanticProjectionDocument,
    result: SemanticProjectionFullResult,
    expectedProviderGeneration = this.providerGeneration,
  ): boolean {
    const current = this.options.getDocument(document.path);
    if (
      expectedProviderGeneration !== this.providerGeneration ||
      !current ||
      !sameDocument(document, current)
    ) {
      return false;
    }

    this.delete(document.path);
    const data = Uint32Array.from(result.data);
    const stored: StoredSemanticProjection = {
      document: { ...document },
      providerGeneration: this.providerGeneration,
      resultId: result.resultId,
      data,
      legend: result.legend,
      providerHandle: result.providerHandle,
      byteLength: data.byteLength,
      lastAccess: ++this.accessClock,
    };
    this.entries.set(document.path, stored);
    this.totalBytes += stored.byteLength;
    this.evictToBudget(document.path);
    this.options.log?.(
      `[semantic_projection] stored path=${document.path} version=${document.versionId} tokens=${data.length / 5} bytes=${stored.byteLength}`,
    );
    return true;
  }

  invalidatePath(path: string): void {
    this.queued.delete(path);
    this.delete(path);
  }

  clear(reason = "clear"): void {
    for (const path of [...this.entries.keys()]) this.delete(path);
    this.queued.clear();
    this.options.log?.(`[semantic_projection] cleared reason=${reason}`);
  }

  providerChanged(range: boolean): void {
    if (range) return;
    this.providerGeneration += 1;
    this.clear("full_provider_changed");
    this.scheduleAll();
  }

  schedule(path: string): void {
    if (!path) return;
    this.queued.add(path);
    this.armDrain(0);
  }

  scheduleAll(): void {
    for (const path of this.options.listBackgroundPaths()) {
      this.queued.add(path);
    }
    this.armDrain(0);
  }

  private armDrain(delayMs: number): void {
    if (this.timerPending || this.draining || this.queued.size === 0) return;
    this.timerPending = true;
    const defer =
      this.options.defer ??
      ((callback: () => void, delay: number) => setTimeout(callback, delay));
    defer(() => {
      this.timerPending = false;
      void this.drain();
    }, delayMs);
  }

  private async drain(): Promise<void> {
    if (this.draining || this.queued.size === 0) return;
    if (this.options.canRun && !this.options.canRun()) {
      this.armDrain(25);
      return;
    }

    this.draining = true;
    try {
      while (this.queued.size > 0) {
        if (this.options.canRun && !this.options.canRun()) break;
        const path = this.queued.values().next().value as string | undefined;
        if (!path) break;
        this.queued.delete(path);
        const document = this.options.getDocument(path);
        if (!document || document.clientForeground) continue;
        const stored = this.entries.get(path);
        if (stored && this.isStoredCurrent(stored, document)) continue;
        try {
          await this.options.compute(path);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.options.log?.(
            `[semantic_projection] prewarm failed path=${path} error=${message}`,
          );
        }
      }
    } finally {
      this.draining = false;
      this.armDrain(25);
    }
  }

  private delete(path: string): void {
    const stored = this.entries.get(path);
    if (!stored) return;
    this.entries.delete(path);
    this.totalBytes = Math.max(0, this.totalBytes - stored.byteLength);
    if (
      stored.providerHandle != null &&
      stored.resultId &&
      this.options.releaseResult
    ) {
      this.options.releaseResult(stored.providerHandle, stored.resultId);
    }
  }

  private isStoredCurrent(
    stored: StoredSemanticProjection,
    document: SemanticProjectionDocument,
  ): boolean {
    return (
      stored.providerGeneration === this.providerGeneration &&
      sameDocument(stored.document, document)
    );
  }

  private evictToBudget(protectedPath: string): void {
    const maxBytes = Math.max(0, this.options.maxBytes ?? DEFAULT_MAX_BYTES);
    while (this.totalBytes > maxBytes && this.entries.size > 0) {
      let candidate: StoredSemanticProjection | null = null;
      for (const stored of this.entries.values()) {
        if (stored.document.path === protectedPath && this.entries.size > 1) {
          continue;
        }
        if (!candidate || stored.lastAccess < candidate.lastAccess) {
          candidate = stored;
        }
      }
      if (!candidate) candidate = this.entries.get(protectedPath) ?? null;
      if (!candidate) break;
      this.options.log?.(
        `[semantic_projection] evicted path=${candidate.document.path} bytes=${candidate.byteLength}`,
      );
      this.delete(candidate.document.path);
    }
  }
}
