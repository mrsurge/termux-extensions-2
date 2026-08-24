import { AsyncLocalStorage } from "node:async_hooks";

interface OperationContext {
  token: string;
  clientInstanceId: string;
}

interface OperationOwner extends OperationContext {
  label: string;
  acquiredAt: number;
  depth: number;
  timer: NodeJS.Timeout | null;
  expired: Promise<never>;
  rejectExpired: (error: Error) => void;
}

interface OperationWaiter {
  token: string;
  clientInstanceId: string;
  label: string;
  timeoutMs: number;
  resolve: (owner: OperationOwner) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

export interface ClientOperationGateRunOptions {
  label: string;
  timeoutMs: number;
  waitTimeoutMs?: number;
  reentryKey?: string | null;
}

export interface ClientOperationGateSnapshot {
  owner: null | {
    token: string;
    clientInstanceId: string;
    label: string;
    ageMs: number;
    depth: number;
  };
  queued: number;
  reentryKeys: number;
}

export class ClientOperationGate {
  private readonly storage = new AsyncLocalStorage<OperationContext>();
  private readonly waiters: OperationWaiter[] = [];
  private readonly reentryKeys = new Map<string, OperationContext>();
  private owner: OperationOwner | null = null;
  private nextToken = 1;

  constructor(
    private readonly options: {
      now?: () => number;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
      onTimeout?: (snapshot: ClientOperationGateSnapshot) => void;
      minimumTimeoutMs?: number;
    } = {},
  ) {}

  snapshot(): ClientOperationGateSnapshot {
    const now = this.now();
    return {
      owner: this.owner
        ? {
            token: this.owner.token,
            clientInstanceId: this.owner.clientInstanceId,
            label: this.owner.label,
            ageMs: Math.max(0, now - this.owner.acquiredAt),
            depth: this.owner.depth,
          }
        : null,
      queued: this.waiters.length,
      reentryKeys: this.reentryKeys.size,
    };
  }

  registerReentryKey(rawKey: string, clientInstanceId: string): boolean {
    const key = String(rawKey || "").trim();
    const owner = this.owner;
    if (!key || !owner || owner.clientInstanceId !== clientInstanceId) {
      return false;
    }
    this.reentryKeys.set(key, {
      token: owner.token,
      clientInstanceId,
    });
    return true;
  }

  clear(reason = "clear"): void {
    const error = new Error(`Client operation gate cleared: ${reason}`);
    const owner = this.owner;
    if (owner?.timer) this.clearTimeout(owner.timer);
    owner?.rejectExpired(error);
    this.owner = null;
    this.reentryKeys.clear();
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer) this.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  async run<T>(
    clientInstanceId: string,
    operation: () => Promise<T> | T,
    options: ClientOperationGateRunOptions,
  ): Promise<T> {
    const inherited = this.storage.getStore();
    const reentry = this.consumeReentry(options.reentryKey, clientInstanceId);
    const context = inherited?.clientInstanceId === clientInstanceId
      ? inherited
      : reentry;
    const owner = context && this.owner?.token === context.token
      ? this.reenter(context)
      : await this.acquire(clientInstanceId, options);
    try {
      return await Promise.race([
        this.storage.run(owner, operation),
        owner.expired,
      ]);
    } finally {
      this.release(owner.token);
    }
  }

  private reenter(context: OperationContext): OperationOwner {
    const owner = this.owner;
    if (!owner || owner.token !== context.token) {
      throw new Error("Client operation reentry lease expired");
    }
    owner.depth += 1;
    return owner;
  }

  private consumeReentry(
    rawKey: string | null | undefined,
    clientInstanceId: string,
  ): OperationContext | null {
    const key = String(rawKey || "").trim();
    if (!key) return null;
    const context = this.reentryKeys.get(key) ?? null;
    if (context?.clientInstanceId !== clientInstanceId) return null;
    this.reentryKeys.delete(key);
    return context;
  }

  private acquire(
    clientInstanceId: string,
    options: ClientOperationGateRunOptions,
  ): Promise<OperationOwner> {
    const token = `client_op_${this.nextToken++}`;
    if (!this.owner && this.waiters.length === 0) {
      return Promise.resolve(this.grant(
        token,
        clientInstanceId,
        options.label,
        options.timeoutMs,
      ));
    }
    return new Promise<OperationOwner>((resolve, reject) => {
      const waitTimeoutMs = Math.max(
        this.minimumTimeoutMs(),
        Number(options.waitTimeoutMs ?? options.timeoutMs + 5000),
      );
      const waiter: OperationWaiter = {
        token,
        clientInstanceId,
        label: options.label,
        timeoutMs: options.timeoutMs,
        resolve,
        reject,
        timer: null,
      };
      waiter.timer = this.setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        reject(new Error(
          `Client operation wait timed out: ${options.label}`,
        ));
      }, waitTimeoutMs);
      this.waiters.push(waiter);
    });
  }

  private grant(
    token: string,
    clientInstanceId: string,
    label: string,
    timeoutMs: number,
  ): OperationOwner {
    let rejectExpired: (error: Error) => void = () => {};
    const expired = new Promise<never>((_resolve, reject) => {
      rejectExpired = reject;
    });
    const owner: OperationOwner = {
      token,
      clientInstanceId,
      label,
      acquiredAt: this.now(),
      depth: 1,
      timer: null,
      expired,
      rejectExpired,
    };
    owner.timer = this.setTimeout(() => {
      if (this.owner?.token !== token) return;
      this.options.onTimeout?.(this.snapshot());
      owner.rejectExpired(new Error(`Client operation timed out: ${label}`));
      this.expire(token);
    }, Math.max(this.minimumTimeoutMs(), Number(timeoutMs)));
    this.owner = owner;
    return owner;
  }

  private expire(token: string): void {
    if (this.owner?.token !== token) return;
    if (this.owner.timer) this.clearTimeout(this.owner.timer);
    this.deleteReentryKeys(token);
    this.owner = null;
    this.grantNext();
  }

  private release(token: string): void {
    const owner = this.owner;
    if (!owner || owner.token !== token) return;
    owner.depth = Math.max(0, owner.depth - 1);
    if (owner.depth > 0) return;
    if (owner.timer) this.clearTimeout(owner.timer);
    this.deleteReentryKeys(token);
    this.owner = null;
    this.grantNext();
  }

  private grantNext(): void {
    if (this.owner) return;
    const waiter = this.waiters.shift();
    if (!waiter) return;
    if (waiter.timer) this.clearTimeout(waiter.timer);
    waiter.resolve(this.grant(
      waiter.token,
      waiter.clientInstanceId,
      waiter.label,
      waiter.timeoutMs,
    ));
  }

  private deleteReentryKeys(token: string): void {
    for (const [key, context] of this.reentryKeys) {
      if (context.token === token) this.reentryKeys.delete(key);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private minimumTimeoutMs(): number {
    return Math.max(1, Number(this.options.minimumTimeoutMs ?? 1000));
  }

  private setTimeout(callback: () => void, delayMs: number): NodeJS.Timeout {
    return (this.options.setTimeoutFn ?? setTimeout)(callback, delayMs);
  }

  private clearTimeout(timer: NodeJS.Timeout): void {
    (this.options.clearTimeoutFn ?? clearTimeout)(timer);
  }
}
