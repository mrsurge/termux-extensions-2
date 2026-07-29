export interface CallHierarchySession {
  providerHandle: number;
  sessionId: string;
}

export interface CallHierarchySessions {
  track(providerHandle: number, sessionId: string): void;
  get(sessionId: string): CallHierarchySession | null;
  release(
    sessionId: string,
    send: (providerHandle: number, sessionId: string) => void,
  ): boolean;
  releaseAll(
    send: (providerHandle: number, sessionId: string) => void,
  ): number;
  clear(): void;
}

export declare class CallHierarchySessionStore
  implements CallHierarchySessions
{
  track(providerHandle: number, sessionId: string): void;
  get(sessionId: string): CallHierarchySession | null;
  release(
    sessionId: string,
    send: (providerHandle: number, sessionId: string) => void,
  ): boolean;
  releaseAll(
    send: (providerHandle: number, sessionId: string) => void,
  ): number;
  clear(): void;
}

export declare function provideReferences(
  runtime: unknown,
  params?: unknown,
): Promise<Record<string, unknown>>;

export declare function provideDefinitions(
  runtime: unknown,
  params?: unknown,
): Promise<Record<string, unknown>>;

export declare function provideImplementations(
  runtime: unknown,
  params?: unknown,
): Promise<Record<string, unknown>>;

export declare function prepareCallHierarchy(
  runtime: unknown,
  params?: unknown,
): Promise<Record<string, unknown>>;

export declare function provideIncomingCalls(
  runtime: unknown,
  params?: unknown,
): Promise<Record<string, unknown>>;

export declare function provideOutgoingCalls(
  runtime: unknown,
  params?: unknown,
): Promise<Record<string, unknown>>;

export declare function releaseCallHierarchy(
  runtime: unknown,
  params?: unknown,
): Record<string, unknown>;
