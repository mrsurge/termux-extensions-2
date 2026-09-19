import { readFile } from "node:fs/promises";
import type { Writable } from "node:stream";

interface BunFileRuntime {
  file(path: URL): { arrayBuffer(): Promise<ArrayBuffer> };
}

// Runtime selection is explicit; Node never imports Bun-only modules. Keep wire
// formats and flow control shared, specializing only the file read primitive.
const bun = (globalThis as typeof globalThis & { Bun?: BunFileRuntime }).Bun;
export const runtimeIo = {
  runtime: process.versions.bun ? "bun" : "node",
  version: process.versions.bun ?? process.versions.node,
  fileReader: process.versions.bun && bun ? "bun.file" : "node:fs",
  socketEngine: "engine.io-node-compatible",
} as const;

export async function readRuntimeFile(path: URL): Promise<Uint8Array> {
  if (process.versions.bun && bun) return new Uint8Array(await bun.file(path).arrayBuffer());
  return readFile(path);
}

// One loader per immutable adapter asset, not a cache of arbitrary user files.
// Concurrent first requests share I/O; failed reads remain retryable.
export function createStaticAssetLoader(path: URL): () => Promise<Uint8Array> {
  let pending: Promise<Uint8Array> | undefined;
  return () => pending ??= readRuntimeFile(path).catch(error => {
    pending = undefined;
    throw error;
  });
}

// Respect stdout backpressure without changing request concurrency or frame order.
// The bound includes writes already handed to the stream; overload fails the
// transport explicitly rather than silently dropping replies or growing forever.
export class PipeOutputWriter {
  private queue: Array<Uint8Array | undefined> = [];
  private index = 0;
  private bytes = 0;
  private blocked = false;
  private failure: Error | undefined;
  private waiters: Array<{ resolve(): void; reject(error: Error): void }> = [];

  constructor(
    private readonly output: Writable,
    private readonly onFailure: (error: Error) => void,
    private readonly limit = 64 * 1024 * 1024,
  ) {
    output.on("drain", () => { this.blocked = false; this.pump(); });
    output.on("error", error => this.fail(error));
    output.on("close", () => this.fail(new Error("Workbench pipe output closed")));
  }

  write(frame: Uint8Array): void {
    if (this.failure) throw this.failure;
    if (this.bytes + frame.byteLength > this.limit) {
      const error = new Error("Workbench pipe output backlog exceeds limit");
      this.fail(error);
      throw error;
    }
    this.bytes += frame.byteLength;
    this.queue.push(frame);
    this.pump();
  }

  flush(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.bytes) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private pump(): void {
    while (!this.blocked && !this.failure && this.index < this.queue.length) {
      const frame = this.queue[this.index]!;
      this.queue[this.index++] = undefined;
      try {
        this.blocked = !this.output.write(frame, error => {
          if (error) { this.fail(error); return; }
          this.bytes -= frame.byteLength;
          if (!this.bytes) this.waiters.splice(0).forEach(waiter => waiter.resolve());
        });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (this.index === this.queue.length || (this.index >= 1024 && this.index * 2 >= this.queue.length)) {
      this.queue = this.queue.slice(this.index);
      this.index = 0;
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.queue = [];
    this.index = 0;
    this.waiters.splice(0).forEach(waiter => waiter.reject(error));
    this.onFailure(error);
  }
}
