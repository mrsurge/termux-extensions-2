export class IpcPromiseClient {
  constructor(protocol: unknown, context: Record<string, unknown>);
  whenInitialized(timeoutMs: number): Promise<void>;
  call(channel: string, method: string, args: unknown): Promise<unknown>;
  listen(channel: string, event: string, args: unknown[]): { event(listener: (payload: unknown) => void): void; dispose?(): void };
  getChannel(channelName: string): unknown;
  dispose?(): void;
}
