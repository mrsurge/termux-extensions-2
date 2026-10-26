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
    forwardLogs?: boolean;
  }

  export interface ConsoleBridgeStatus {
    active: boolean;
    forwarding: boolean;
    connected: boolean;
    workerId: string | null;
    workerLabel: string | null;
  }

  export function initConsoleBridge(opts?: ConsoleBridgeOptions): ConsoleBridgeHandle | null;
  export function initBuiltinConsoleBridge(opts?: ConsoleBridgeOptions & { prepare?: () => Promise<void> }): Promise<ConsoleBridgeHandle | null>;
  export function getConsoleBridgeStatus(): ConsoleBridgeStatus;
  export function destroyConsoleBridge(): void;
}
