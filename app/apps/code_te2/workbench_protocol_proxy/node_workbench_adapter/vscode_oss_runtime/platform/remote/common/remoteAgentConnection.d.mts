export const ConnectionType: {
  readonly Management: unknown;
  readonly ExtensionHost: unknown;
};

export interface RemoteAgentProtocol {
  send(payload: unknown): void;
  onMessage(listener: (payload: { buffer?: Uint8Array & { readUInt32BE?: (offset: number) => number } }) => void): { dispose?: () => void };
  dispose?(): void;
}

export function connectToRemoteAgent(options: Record<string, unknown>): Promise<{ protocol: RemoteAgentProtocol }>;
export function createNoopSignService(): unknown;
