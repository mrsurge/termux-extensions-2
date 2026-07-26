import type { ProviderKind } from "../provider-registry";

export interface CodeNavigationPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface CodeNavigationRuntime {
  ensureConnected: () => void;
  languageFeaturesRpcId: number;
  defaultAuthority: () => string;
  documentScheme: () => string;
  languageIdFromPath: (filePath: string) => string;
  findAllProviderHandles: (
    kind: Extract<
      ProviderKind,
      "references" | "implementations" | "callHierarchy"
    >,
    document: {
      languageId: string;
      scheme: string;
      authority: string;
      path: string;
    },
  ) => number[];
  waitFor: (
    condition: () => boolean,
    options: { timeoutMs: number; intervalMs: number },
  ) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: CodeNavigationPendingOptions,
  ) => { promise: Promise<unknown> };
  sendExt: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable?: boolean,
  ) => unknown;
  sessions: CallHierarchySessions;
  log: (...args: unknown[]) => void;
}

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

export class CallHierarchySessionStore implements CallHierarchySessions {
  private readonly sessions = new Map<string, CallHierarchySession>();

  track(providerHandle: number, sessionId: string): void {
    if (!Number.isFinite(providerHandle) || !sessionId) return;
    this.sessions.set(sessionId, { providerHandle, sessionId });
  }

  get(sessionId: string): CallHierarchySession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  release(
    sessionId: string,
    send: (providerHandle: number, sessionId: string) => void,
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    send(session.providerHandle, session.sessionId);
    return true;
  }

  releaseAll(
    send: (providerHandle: number, sessionId: string) => void,
  ): number {
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const session of sessions) {
      try {
        send(session.providerHandle, session.sessionId);
      } catch {
        // Session teardown is best effort when the extension host is resetting.
      }
    }
    return sessions.length;
  }

  clear(): void {
    this.sessions.clear();
  }
}

interface NavigationRequest {
  path: string;
  authority: string;
  languageId: string;
  lineNumber: number;
  column: number;
  timeoutMs: number;
}

interface NormalizedRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface NormalizedLocation {
  uri: string;
  path: string;
  range: NormalizedRange | null;
  selectionRange: NormalizedRange | null;
  originRange: NormalizedRange | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function replyType(reply: unknown): number | null {
  const type = field(reply, "type");
  return typeof type === "number" ? type : null;
}

function replyResult(reply: unknown): unknown {
  return field(reply, "result");
}

function replyError(reply: unknown): unknown {
  return field(reply, "error");
}

function normalizeRange(value: unknown): NormalizedRange | null {
  if (!isRecord(value)) return null;
  const startLineNumber = finiteNumber(value.startLineNumber, 0);
  const startColumn = finiteNumber(value.startColumn, 0);
  const endLineNumber = finiteNumber(value.endLineNumber, startLineNumber);
  const endColumn = finiteNumber(value.endColumn, startColumn);
  if (startLineNumber <= 0 || startColumn <= 0) return null;
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

function uriParts(value: unknown): {
  uri: string;
  path: string;
} {
  if (typeof value === "string") {
    try {
      const parsed = new URL(value);
      return { uri: value, path: decodeURIComponent(parsed.pathname) };
    } catch {
      return { uri: value, path: value };
    }
  }
  if (!isRecord(value)) return { uri: "", path: "" };
  const path = stringValue(value.fsPath) || stringValue(value.path);
  const external = stringValue(value.external);
  if (external) return { uri: external, path };
  const scheme = stringValue(value.scheme);
  const authority = stringValue(value.authority);
  return {
    uri: scheme ? `${scheme}://${authority}${path}` : path,
    path,
  };
}

function normalizeLocation(value: unknown): NormalizedLocation | null {
  if (!isRecord(value)) return null;
  const targetUri = value.targetUri ?? value.uri;
  const { uri, path } = uriParts(targetUri);
  if (!uri && !path) return null;
  const targetRange = value.targetRange ?? value.range;
  return {
    uri,
    path,
    range: normalizeRange(targetRange),
    selectionRange: normalizeRange(value.targetSelectionRange ?? targetRange),
    originRange: normalizeRange(value.originSelectionRange),
  };
}

function locationKey(location: NormalizedLocation): string {
  const range = location.selectionRange ?? location.range;
  return [
    location.uri || location.path,
    range?.startLineNumber ?? 0,
    range?.startColumn ?? 0,
    range?.endLineNumber ?? 0,
    range?.endColumn ?? 0,
  ].join(":");
}

function compareLocations(
  left: NormalizedLocation,
  right: NormalizedLocation,
): number {
  const pathOrder = (left.path || left.uri).localeCompare(
    right.path || right.uri,
  );
  if (pathOrder) return pathOrder;
  const leftRange = left.selectionRange ?? left.range;
  const rightRange = right.selectionRange ?? right.range;
  return (
    (leftRange?.startLineNumber ?? 0) -
      (rightRange?.startLineNumber ?? 0) ||
    (leftRange?.startColumn ?? 0) - (rightRange?.startColumn ?? 0) ||
    (leftRange?.endLineNumber ?? 0) - (rightRange?.endLineNumber ?? 0) ||
    (leftRange?.endColumn ?? 0) - (rightRange?.endColumn ?? 0)
  );
}

function mergeLocations(replies: unknown[]): {
  locations: NormalizedLocation[];
  error: unknown;
} {
  const locations = new Map<string, NormalizedLocation>();
  let error: unknown = null;
  for (const reply of replies) {
    if (replyType(reply) === 9) {
      const result = replyResult(reply);
      if (!Array.isArray(result)) continue;
      for (const rawLocation of result) {
        const location = normalizeLocation(rawLocation);
        if (location) locations.set(locationKey(location), location);
      }
    } else if (replyType(reply) === 11) {
      error = replyError(reply);
    }
  }
  return {
    locations: Array.from(locations.values()).sort(compareLocations),
    error,
  };
}

function navigationRequest(
  runtime: CodeNavigationRuntime,
  params: unknown,
): NavigationRequest {
  const input = isRecord(params) ? params : {};
  const path = stringValue(input.path);
  return {
    path,
    authority:
      stringValue(input.authority) || runtime.defaultAuthority(),
    languageId:
      stringValue(input.languageId) ||
      runtime.languageIdFromPath(path) ||
      "plaintext",
    lineNumber: finiteNumber(input.lineNumber, 1),
    column: finiteNumber(input.column, 1),
    timeoutMs: Math.max(
      1000,
      Math.min(120000, finiteNumber(input.timeoutMs, 8000)),
    ),
  };
}

function providerDocument(
  runtime: CodeNavigationRuntime,
  request: NavigationRequest,
): {
  languageId: string;
  scheme: string;
  authority: string;
  path: string;
} {
  return {
    languageId: request.languageId,
    scheme: runtime.documentScheme(),
    authority: request.authority,
    path: request.path,
  };
}

async function findProviders(
  runtime: CodeNavigationRuntime,
  kind: "references" | "implementations" | "callHierarchy",
  request: NavigationRequest,
): Promise<number[]> {
  const document = providerDocument(runtime, request);
  let handles = runtime.findAllProviderHandles(kind, document);
  if (handles.length) return handles;
  await runtime.waitFor(
    () => runtime.findAllProviderHandles(kind, document).length > 0,
    { timeoutMs: request.timeoutMs, intervalMs: 50 },
  );
  handles = runtime.findAllProviderHandles(kind, document);
  return handles;
}

async function provideLocations(
  runtime: CodeNavigationRuntime,
  params: unknown,
  config: {
    kind: "references" | "implementations";
    method: "$provideReferences" | "$provideImplementation";
    extraArgs: unknown[];
  },
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const request = navigationRequest(runtime, params);
  const handles = await findProviders(runtime, config.kind, request);
  if (!handles.length) {
    return {
      ok: false,
      unsupported: true,
      error: `no ${config.kind} provider for language '${request.languageId}'`,
    };
  }

  const uri = runtime.uriForPath(request.path, request.authority);
  // Cancellable ExtHost frames append the token; args contain only non-token parameters.
  const replies = await Promise.all(
    handles.map((handle) => {
      const { promise } = runtime.sendExtPending(
        runtime.languageFeaturesRpcId,
        config.method,
        [
          handle,
          uri,
          { lineNumber: request.lineNumber, column: request.column },
          ...config.extraArgs,
        ],
        true,
        {
          timeoutMs: request.timeoutMs,
          timeoutMessage: `timed out waiting for ${config.method} reply`,
          timeoutResult: { type: 7 },
        },
      );
      return promise.catch((error: unknown) => ({ type: 11, error }));
    }),
  );
  const merged = mergeLocations(replies);
  runtime.log(
    `[code-navigation] ${config.kind} path=${request.path} providers=${handles.length} locations=${merged.locations.length}`,
  );
  if (!merged.locations.length && merged.error) {
    return { ok: false, error: merged.error };
  }
  return {
    ok: true,
    result: merged.locations,
    providerHandles: handles,
  };
}

export function provideReferences(
  runtime: CodeNavigationRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  return provideLocations(runtime, params, {
    kind: "references",
    method: "$provideReferences",
    extraArgs: [{ includeDeclaration: true }],
  });
}

export function provideImplementations(
  runtime: CodeNavigationRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  return provideLocations(runtime, params, {
    kind: "implementations",
    method: "$provideImplementation",
    extraArgs: [],
  });
}

function normalizeCallHierarchyItem(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const sessionId = stringValue(value._sessionId);
  const itemId = stringValue(value._itemId);
  const { uri, path } = uriParts(value.uri);
  if (!sessionId || !itemId || (!uri && !path)) return null;
  return {
    sessionId,
    itemId,
    name: stringValue(value.name),
    detail: stringValue(value.detail),
    kind: finiteNumber(value.kind, 0),
    tags: Array.isArray(value.tags) ? value.tags : [],
    uri,
    path,
    range: normalizeRange(value.range),
    selectionRange: normalizeRange(value.selectionRange ?? value.range),
  };
}

function normalizeCallResults(
  value: unknown,
  direction: "incoming" | "outgoing",
): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const results: Record<string, unknown>[] = [];
  for (const rawCall of value) {
    if (!isRecord(rawCall)) continue;
    const rawItem = direction === "incoming" ? rawCall.from : rawCall.to;
    const item = normalizeCallHierarchyItem(rawItem);
    if (!item) continue;
    results.push({
      ...item,
      direction,
      fromRanges: Array.isArray(rawCall.fromRanges)
        ? rawCall.fromRanges.map(normalizeRange).filter(Boolean)
        : [],
    });
  }
  return results.sort((left, right) => {
    const leftLocation = normalizeLocation({
      uri: left.uri,
      range: left.selectionRange ?? left.range,
    });
    const rightLocation = normalizeLocation({
      uri: right.uri,
      range: right.selectionRange ?? right.range,
    });
    if (!leftLocation || !rightLocation) return 0;
    return compareLocations(leftLocation, rightLocation);
  });
}

export async function prepareCallHierarchy(
  runtime: CodeNavigationRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const request = navigationRequest(runtime, params);
  const handle = (await findProviders(runtime, "callHierarchy", request))[0];
  if (handle === undefined) {
    return {
      ok: false,
      unsupported: true,
      error: `no call hierarchy provider for language '${request.languageId}'`,
    };
  }
  const uri = runtime.uriForPath(request.path, request.authority);
  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
    "$prepareCallHierarchy",
    [
      handle,
      uri,
      { lineNumber: request.lineNumber, column: request.column },
    ],
    true,
    {
      timeoutMs: request.timeoutMs,
      timeoutMessage: "timed out waiting for call hierarchy roots",
    },
  );
  const reply = await promise;
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  if (replyType(reply) !== 9) return { ok: false, error: reply };

  const roots: Record<string, unknown>[] = Array.isArray(replyResult(reply))
    ? (replyResult(reply) as unknown[])
        .map(normalizeCallHierarchyItem)
        .filter((item): item is Record<string, unknown> => !!item)
        .map(
          (item): Record<string, unknown> => ({
            ...item,
            providerHandle: handle,
          }),
        )
    : [];
  for (const root of roots) {
    runtime.sessions.track(handle, stringValue(root["sessionId"]));
  }
  return { ok: true, result: roots, providerHandle: handle };
}

async function expandCallHierarchy(
  runtime: CodeNavigationRuntime,
  params: unknown,
  direction: "incoming" | "outgoing",
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const sessionId = stringValue(input.sessionId);
  const itemId = stringValue(input.itemId);
  const session = runtime.sessions.get(sessionId);
  if (!session || !itemId) {
    return { ok: false, error: "call_hierarchy_session_missing" };
  }
  const method =
    direction === "incoming"
      ? "$provideCallHierarchyIncomingCalls"
      : "$provideCallHierarchyOutgoingCalls";
  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
    method,
    [session.providerHandle, sessionId, itemId],
    true,
    {
      timeoutMs: Math.max(
        1000,
        Math.min(120000, finiteNumber(input.timeoutMs, 15000)),
      ),
      timeoutMessage: `timed out waiting for ${direction} call hierarchy`,
    },
  );
  const reply = await promise;
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  if (replyType(reply) !== 9) return { ok: false, error: reply };
  const result: Record<string, unknown>[] = normalizeCallResults(
    replyResult(reply),
    direction,
  ).map(
    (item): Record<string, unknown> => ({
      ...item,
      providerHandle: session.providerHandle,
    }),
  );
  for (const item of result) {
    runtime.sessions.track(
      session.providerHandle,
      stringValue(item["sessionId"]),
    );
  }
  return { ok: true, result };
}

export function provideIncomingCalls(
  runtime: CodeNavigationRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  return expandCallHierarchy(runtime, params, "incoming");
}

export function provideOutgoingCalls(
  runtime: CodeNavigationRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  return expandCallHierarchy(runtime, params, "outgoing");
}

export function releaseCallHierarchy(
  runtime: CodeNavigationRuntime,
  params: unknown = {},
): Record<string, unknown> {
  const input = isRecord(params) ? params : {};
  const sessionId = stringValue(input.sessionId);
  if (!sessionId) return { ok: false, error: "missing_session_id" };
  const released = runtime.sessions.release(
    sessionId,
    (providerHandle, currentSessionId) => {
      runtime.sendExt(
        runtime.languageFeaturesRpcId,
        "$releaseCallHierarchy",
        [providerHandle, currentSessionId],
        false,
      );
    },
  );
  return { ok: true, released };
}
