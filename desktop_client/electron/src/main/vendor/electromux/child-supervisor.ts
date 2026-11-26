/** Owns a single child operation; the runner owns PID/group and must settle after abort. */
export class OwnedChildSupervisor {
  private readonly controller = new AbortController();
  private active: Promise<unknown> | undefined;
  private closed = false;
  async run<T>(runner: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed || this.active) throw new Error('Child supervisor unavailable');
    const operation = Promise.resolve().then(() => {
      if (this.controller.signal.aborted) throw new Error('Child owner closed');
      return runner(this.controller.signal);
    });
    this.active = operation;
    try { return await operation; }
    finally { this.active = undefined; }
  }
  async dispose(): Promise<void> {
    this.closed = true;
    this.controller.abort();
    await this.active?.catch(() => {});
  }
}
