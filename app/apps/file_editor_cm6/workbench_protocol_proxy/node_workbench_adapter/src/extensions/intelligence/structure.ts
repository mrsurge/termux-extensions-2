export interface StructurePendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface StructureSendResult {
  promise: Promise<unknown>;
}

export interface StructureRuntime {
  ensureConnected: () => void;
  languageFeaturesRpcId: number;
  defaultAuthority: () => string;
  languageIdFromPath: (filePath: string) => string;
  getDocumentVersion: (path: string) => number | null;
  getOpenGeneration: (path: string) => unknown;
  updateActiveDocument: (path: string, uriObj: unknown, languageId: string) => void;
  selectorGroupsSummary: (kind: "documentSymbols" | "foldingRanges") => string;
  findAllProviderHandles: (
    kind: "documentSymbols" | "foldingRanges",
    languageId: string,
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
    pendingOptions: StructurePendingOptions,
  ) => StructureSendResult;
  sleep: (ms: number) => Promise<void>;
  log: (...args: unknown[]) => void;
}

export interface StructureSingleParams {
  providerHandle: number;
  path: string;
  authority: string;
  languageId: string;
  timeoutMs?: number;
  context?: Record<string, unknown>;
  _retried?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
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

function coerceOptionalGeneration(raw: unknown): number | string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") return raw;
  return null;
}

function coercePath(input: Record<string, unknown>): string {
  return String(input.path ?? "");
}

function coerceAuthority(runtime: StructureRuntime, input: Record<string, unknown>): string {
  return String(input.authority ?? runtime.defaultAuthority());
}

function coerceLanguageId(runtime: StructureRuntime, input: Record<string, unknown>, path: string): string {
  return String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
}

function documentOpenError(runtime: StructureRuntime, path: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (runtime.getDocumentVersion(path) == null) {
    return { ok: false, error: "document_not_open" };
  }
  const generation = coerceOptionalGeneration(input.generation);
  const openGeneration = runtime.getOpenGeneration(path);
  if (
    generation !== null &&
    openGeneration !== undefined &&
    openGeneration !== null &&
    openGeneration !== generation
  ) {
    return { ok: false, error: "stale_generation", openGeneration };
  }
  return null;
}

export async function provideDocumentSymbols(runtime: StructureRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const path = coercePath(input);
  const authority = coerceAuthority(runtime, input);
  const timeoutMs = Number(input.timeoutMs ?? 8000);
  const languageId = coerceLanguageId(runtime, input, path);

  const openError = documentOpenError(runtime, path, input);
  if (openError) return openError;

  runtime.log(`[symbols] request path=${path} lang=${languageId} registeredProviders=${runtime.selectorGroupsSummary("documentSymbols")}`);

  if (typeof input.providerHandle === "number") {
    return provideDocumentSymbolsSingle(runtime, {
      providerHandle: input.providerHandle,
      path,
      authority,
      languageId,
      timeoutMs: 15000,
      _retried: !!input._retried,
    });
  }

  let handles = runtime.findAllProviderHandles("documentSymbols", languageId);
  if (handles.length === 0) {
    runtime.log(`[symbols] no provider yet for '${languageId}', waiting up to ${timeoutMs}ms...`);
    await runtime.waitFor(
      () => runtime.findAllProviderHandles("documentSymbols", languageId).length > 0,
      { timeoutMs, intervalMs: 50 },
    );
    handles = runtime.findAllProviderHandles("documentSymbols", languageId);
  }
  if (handles.length === 0) {
    runtime.log(`[symbols] STILL no provider for '${languageId}' after timeout`);
    return { ok: false, error: `no document symbols provider for language '${languageId}'` };
  }
  runtime.log(`[symbols] multi-provider handles=[${handles.join(",")}] for '${languageId}'`);

  const uriObj = runtime.uriForPath(path, authority);
  runtime.updateActiveDocument(path, uriObj, languageId);

  const results = await Promise.all(handles.map((handle) => {
    const { promise } = runtime.sendExtPending(
      runtime.languageFeaturesRpcId,
      "$provideDocumentSymbols",
      [handle, uriObj],
      true,
      {
        timeoutMs: 15000,
        timeoutMessage: "timed out waiting for symbols reply",
        timeoutResult: null,
      },
    );
    return promise.catch(() => null);
  }));

  let merged: unknown[] = [];
  let lastError: unknown = null;
  for (const reply of results) {
    if (!reply) continue;
    if (replyType(reply) === 9 && Array.isArray(replyResult(reply))) {
      merged = merged.concat(replyResult(reply) as unknown[]);
    } else if (replyType(reply) === 11) {
      lastError = replyError(reply);
    }
  }

  if (merged.length === 0 && lastError && !input._retried) {
    runtime.log("[symbols] all providers errored, retrying after 800ms...");
    await runtime.sleep(800);
    return provideDocumentSymbols(runtime, { ...input, _retried: true });
  }

  runtime.log(`[symbols] merged ${merged.length} symbols from ${results.filter((reply) => reply && replyType(reply) === 9).length}/${handles.length} providers`);
  return { ok: true, result: merged };
}

export async function provideDocumentSymbolsSingle(
  runtime: StructureRuntime,
  params: StructureSingleParams,
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const uriObj = runtime.uriForPath(params.path, params.authority);
  runtime.updateActiveDocument(params.path, uriObj, params.languageId);

  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
    "$provideDocumentSymbols",
    [params.providerHandle, uriObj],
    true,
    {
      timeoutMs: params.timeoutMs ?? 15000,
      timeoutMessage: "timed out waiting for symbols reply",
    },
  );
  const reply = await promise;

  const symbolCount =
    replyType(reply) === 9 && Array.isArray(replyResult(reply))
      ? (replyResult(reply) as unknown[]).length
      : "n/a";
  runtime.log(`[symbols] response path=${params.path} lang=${params.languageId} type=${replyType(reply)} count=${symbolCount}`);
  if (replyType(reply) === 9) return { ok: true, result: replyResult(reply) };
  if (replyType(reply) === 11) {
    runtime.log("[symbols] error reply:", replyError(reply));
    if (!params._retried) {
      runtime.log("[symbols] retrying after 800ms...");
      await runtime.sleep(800);
      return provideDocumentSymbolsSingle(runtime, { ...params, _retried: true });
    }
    return { ok: false, error: replyError(reply) };
  }
  return { ok: false, error: reply };
}

export async function provideFoldingRanges(runtime: StructureRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const path = coercePath(input);
  const authority = coerceAuthority(runtime, input);
  const timeoutMs = Number(input.timeoutMs ?? 8000);
  const languageId = coerceLanguageId(runtime, input, path);
  const context =
    isRecord(input.context) ? input.context : {};

  const openError = documentOpenError(runtime, path, input);
  if (openError) return openError;

  runtime.log(`[folding] request path=${path} lang=${languageId} registeredProviders=${runtime.selectorGroupsSummary("foldingRanges")}`);

  if (typeof input.providerHandle === "number") {
    return provideFoldingRangesSingle(runtime, {
      providerHandle: input.providerHandle,
      path,
      authority,
      languageId,
      context,
      timeoutMs: 15000,
      _retried: !!input._retried,
    });
  }

  let handles = runtime.findAllProviderHandles("foldingRanges", languageId);
  if (handles.length === 0) {
    runtime.log(`[folding] no provider for '${languageId}', fast-fail`);
    return { ok: true, result: null };
  }
  runtime.log(`[folding] multi-provider handles=[${handles.join(",")}] for '${languageId}'`);

  const uriObj = runtime.uriForPath(path, authority);
  runtime.updateActiveDocument(path, uriObj, languageId);

  const results = await Promise.all(handles.map((handle) => {
    const { promise } = runtime.sendExtPending(
      runtime.languageFeaturesRpcId,
      "$provideFoldingRanges",
      [handle, uriObj, context],
      true,
      {
        timeoutMs: 15000,
        timeoutMessage: "timed out waiting for folding ranges reply",
        timeoutResult: null,
      },
    );
    return promise.catch(() => null);
  }));

  let merged: unknown[] = [];
  let sawArray = false;
  let sawJson = false;
  let lastError: unknown = null;
  for (const reply of results) {
    if (!reply) continue;
    if (replyType(reply) === 9) {
      sawJson = true;
      if (Array.isArray(replyResult(reply))) {
        sawArray = true;
        merged = merged.concat(replyResult(reply) as unknown[]);
      }
    } else if (replyType(reply) === 11) {
      lastError = replyError(reply);
    }
  }

  if (!sawArray && lastError && !input._retried) {
    runtime.log("[folding] all providers errored, retrying after 800ms...");
    await runtime.sleep(800);
    return provideFoldingRanges(runtime, { ...input, _retried: true });
  }

  if (sawArray) {
    runtime.log(`[folding] merged ${merged.length} ranges from ${results.filter((reply) => reply && replyType(reply) === 9 && Array.isArray(replyResult(reply))).length}/${handles.length} providers`);
    return { ok: true, result: merged };
  }
  if (sawJson) {
    runtime.log(`[folding] providers returned no ranges for path=${path} lang=${languageId}`);
    return { ok: true, result: null };
  }
  return { ok: false, error: lastError || "no folding range results" };
}

export async function provideFoldingRangesSingle(
  runtime: StructureRuntime,
  params: StructureSingleParams,
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const uriObj = runtime.uriForPath(params.path, params.authority);
  runtime.updateActiveDocument(params.path, uriObj, params.languageId);

  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
    "$provideFoldingRanges",
    [params.providerHandle, uriObj, params.context ?? {}],
    true,
    {
      timeoutMs: params.timeoutMs ?? 15000,
      timeoutMessage: "timed out waiting for folding ranges reply",
    },
  );
  const reply = await promise;

  const rangeCount =
    replyType(reply) === 9 && Array.isArray(replyResult(reply))
      ? (replyResult(reply) as unknown[]).length
      : (replyType(reply) === 9 && replyResult(reply) == null ? "null" : "n/a");
  runtime.log(`[folding] response path=${params.path} lang=${params.languageId} type=${replyType(reply)} count=${rangeCount}`);
  if (replyType(reply) === 9) {
    return { ok: true, result: Array.isArray(replyResult(reply)) ? replyResult(reply) : null };
  }
  if (replyType(reply) === 11) {
    runtime.log("[folding] error reply:", replyError(reply));
    if (!params._retried) {
      runtime.log("[folding] retrying after 800ms...");
      await runtime.sleep(800);
      return provideFoldingRangesSingle(runtime, { ...params, _retried: true });
    }
    return { ok: false, error: replyError(reply) };
  }
  return { ok: false, error: reply };
}
