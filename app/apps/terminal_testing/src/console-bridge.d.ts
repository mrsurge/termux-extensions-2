declare module 'te2-console-bridge' {
  export interface ConsoleBridgeHandle {
    socket: unknown;
    workerId: string;
    destroy: () => void;
  }

  export interface ConsoleBridgeOptions {
    workerId?: string;
    workerLabel?: string;
    uniquePerWindow?: boolean;
    socketPath?: string;
    namespace?: string;
  }

  export function initConsoleBridge(opts?: ConsoleBridgeOptions): ConsoleBridgeHandle | null;
  export function destroyConsoleBridge(): void;
}
