export interface ActivationRequestHandle {
  req: number;
  promise: Promise<unknown>;
}

export interface ExtensionActivationRuntimeOptions {
  extensionServiceRpcId: number;
  sendAwaitingReply(
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    timeoutMs: number,
  ): ActivationRequestHandle;
  hasExtension(extensionId: string): boolean;
  onEvent(payload: Record<string, unknown>): void;
  log(...args: unknown[]): void;
}

export interface ExtensionActivationResult {
  ok: true;
  kind: "event" | "extension";
  target: string;
  req: number;
}

function requiredValue(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`Missing required ${label}`);
  return normalized;
}

export class ExtensionActivationRuntime {
  private readonly eventRequests = new Map<
    string,
    Promise<ExtensionActivationResult>
  >();
  private readonly extensionRequests = new Map<
    string,
    Promise<ExtensionActivationResult>
  >();

  constructor(private readonly options: ExtensionActivationRuntimeOptions) {}

  reset(reason: string): void {
    this.eventRequests.clear();
    this.extensionRequests.clear();
    this.options.onEvent({
      type: "extension/activationReset",
      ts_ms: Date.now(),
      reason,
    });
  }

  activateByEvent(
    rawEvent: unknown,
    activationKind = 0,
    timeoutMs = 30000,
  ): Promise<ExtensionActivationResult> {
    const event = requiredValue(rawEvent, "activation event");
    const existing = this.eventRequests.get(event);
    if (existing) return existing;

    const request = this.options.sendAwaitingReply(
      this.options.extensionServiceRpcId,
      "$activateByEvent",
      [event, activationKind],
      false,
      timeoutMs,
    );
    const operation = request.promise
      .then(() => {
        const result: ExtensionActivationResult = {
          ok: true,
          kind: "event",
          target: event,
          req: request.req,
        };
        this.options.onEvent({
          type: "extension/activationResolved",
          ts_ms: Date.now(),
          ...result,
        });
        return result;
      })
      .catch((error) => {
        this.eventRequests.delete(event);
        this.options.onEvent({
          type: "extension/activationFailed",
          ts_ms: Date.now(),
          kind: "event",
          target: event,
          error: String((error as Error)?.message ?? error),
        });
        throw error;
      });
    this.eventRequests.set(event, operation);
    return operation;
  }

  activateExtension(
    rawExtensionId: unknown,
    rawActivationEvent?: unknown,
    timeoutMs = 30000,
  ): Promise<ExtensionActivationResult> {
    const extensionId = requiredValue(rawExtensionId, "extensionId");
    const cacheKey = extensionId.toLowerCase();
    if (!this.options.hasExtension(cacheKey)) {
      return Promise.reject(new Error(`Unknown extension: ${extensionId}`));
    }
    const existing = this.extensionRequests.get(cacheKey);
    if (existing) return existing;

    const activationEvent =
      typeof rawActivationEvent === "string" && rawActivationEvent.trim()
        ? rawActivationEvent.trim()
        : `onTe2Explicit:${cacheKey}`;
    const identifier = {
      value: extensionId,
      _lower: cacheKey,
      id: extensionId,
    };
    const request = this.options.sendAwaitingReply(
      this.options.extensionServiceRpcId,
      "$activate",
      [
        identifier,
        {
          startup: false,
          extensionId: identifier,
          activationEvent,
        },
      ],
      false,
      timeoutMs,
    );
    const operation = request.promise
      .then(() => {
        const result: ExtensionActivationResult = {
          ok: true,
          kind: "extension",
          target: extensionId,
          req: request.req,
        };
        this.options.onEvent({
          type: "extension/activationResolved",
          ts_ms: Date.now(),
          ...result,
          activationEvent,
        });
        return result;
      })
      .catch((error) => {
        this.extensionRequests.delete(cacheKey);
        this.options.onEvent({
          type: "extension/activationFailed",
          ts_ms: Date.now(),
          kind: "extension",
          target: extensionId,
          activationEvent,
          error: String((error as Error)?.message ?? error),
        });
        throw error;
      });
    this.extensionRequests.set(cacheKey, operation);
    return operation;
  }
}
