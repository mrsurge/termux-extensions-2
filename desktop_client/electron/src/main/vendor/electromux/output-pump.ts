export type OutputLane = 'stdout' | 'stderr';
export type OutputSink = (lane: OutputLane, bytes: Buffer) => Promise<void>;

/** Streaming, not a lifetime-output accumulator. Queue/tails/deadlines are bounded. */
export class OutputPump {
  private count = 0;
  private sequence: Promise<void> = Promise.resolve();
  private error: Error | undefined;
  private readonly tails = {stdout: Buffer.alloc(0), stderr: Buffer.alloc(0)};
  constructor(private readonly sink: OutputSink, private readonly deadlineMs = 5000) {}
  tail(lane: OutputLane): string { return this.tails[lane].toString('utf8'); }
  push(lane: OutputLane, bytes: Buffer): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (bytes.length > 65536 || this.count >= 16) {
      this.error = new Error('Child output queue exceeded');
      return Promise.reject(this.error);
    }
    // Copy borrowed stream storage; retain only a bounded diagnostic tail.
    const owned = Buffer.from(bytes);
    this.tails[lane] = Buffer.from(Buffer.concat([this.tails[lane], owned]).subarray(-2048));
    this.count++;
    const operation = this.sequence.then(async () => {
      if (this.error) throw this.error;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.sink(lane, owned), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Child output delivery deadline exceeded')), this.deadlineMs);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    }).catch((error: unknown) => {
      this.error ||= error instanceof Error ? error : new Error('Child output delivery failed');
      throw this.error;
    }).finally(() => { this.count--; });
    this.sequence = operation.catch(() => {});
    return operation;
  }
  async drain(): Promise<void> { await this.sequence; if (this.error) throw this.error; }
}
