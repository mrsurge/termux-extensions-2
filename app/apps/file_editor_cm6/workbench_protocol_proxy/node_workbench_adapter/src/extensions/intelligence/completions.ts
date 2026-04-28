export interface CompletionPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface CompletionSendResult {
  promise: Promise<unknown>;
}

export interface CompletionRuntime {
  ensureConnected: () => void;
  defaultAuthority: () => string;
  languageIdFromPath: (filePath: string) => string;
  didChange: (
    params: Record<string, unknown>,
    opts: { waitForAck: true; timeoutMs: number },
  ) => Promise<unknown> | unknown;
  findAllProviderHandles: (kind: "completions", languageId: string) => number[];
  waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: CompletionPendingOptions,
  ) => CompletionSendResult;
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

export interface CompletionSingleParams {
  providerHandle: number;
  path: string;
  authority: string;
  lineNumber: number;
  column: number;
  triggerKind: number;
  triggerCharacter: unknown;
  timeoutMs: number;
}

interface CompletionSyncCacheEntry {
  signature: string;
  promise?: Promise<unknown>;
  result?: unknown;
}

const completionSyncByPath = new Map<string, CompletionSyncCacheEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function commandNeeded(item: Record<string, unknown>): boolean {
  return item.n != null || item.o != null;
}

function insertTextForItem(item: Record<string, unknown>): unknown {
  if (item.h != null) return item.h;
  if (typeof item.a === "string") return item.a;
  return field(item.a, "label") ?? "";
}

function suggestResultDto(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function optionalProviderHandle(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const handle = Number(value);
  return Number.isFinite(handle) ? handle : null;
}

function textHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

function completionSyncSignature(input: Record<string, unknown>, text: string, languageId: string, authority: string): string {
  const modelVersionId = input.modelVersionId;
  const versionPart = modelVersionId == null ? "no-version" : String(modelVersionId);
  return [
    authority,
    languageId,
    versionPart,
    String(text.length),
    textHash(text),
  ].join("|");
}

async function ensureCompletionTextSynced(
  runtime: CompletionRuntime,
  input: Record<string, unknown>,
  path: string,
  text: string,
  languageId: string,
  authority: string,
  timeoutMs: number,
): Promise<unknown> {
  const signature = completionSyncSignature(input, text, languageId, authority);
  const cached = completionSyncByPath.get(path);
  if (cached && cached.signature === signature) {
    if (cached.promise) return cached.promise;
    return cached.result;
  }

  const promise = Promise.resolve(runtime.didChange(
    { path, text, languageId, authority },
    { waitForAck: true, timeoutMs: Math.min(timeoutMs, 5000) },
  ));
  completionSyncByPath.set(path, { signature, promise });
  try {
    const result = await promise;
    const latest = completionSyncByPath.get(path);
    if (latest && latest.signature === signature) {
      completionSyncByPath.set(path, { signature, result });
    }
    return result;
  } catch (error) {
    const latest = completionSyncByPath.get(path);
    if (latest && latest.signature === signature) completionSyncByPath.delete(path);
    throw error;
  }
}

export function inflateCompletionItems(dto: unknown, log: (message: string) => void = () => undefined): Record<string, unknown>[] {
  const completions = field(dto, "b");
  if (!Array.isArray(completions)) return [];
  const defaultRanges = field(dto, "a");
  log(`[completions] _inflate defaultRanges(dto.a)=${JSON.stringify(defaultRanges)} completions.length=${completions.length}`);
  if (completions.length > 0) {
    const first = completions[0];
    log(`[completions] _inflate item[0] a=${JSON.stringify(field(first, "a"))} j=${JSON.stringify(field(first, "j"))} f=${JSON.stringify(field(first, "f"))}`);
  }

  const items: Record<string, unknown>[] = [];
  for (const rawItem of completions) {
    if (!isRecord(rawItem)) continue;
    const item: Record<string, unknown> = {
      label: rawItem.a ?? "",
      kind: rawItem.b ?? 0,
      detail: rawItem.c ?? undefined,
      documentation: rawItem.d ?? undefined,
      sortText: rawItem.e ?? undefined,
      filterText: rawItem.f ?? undefined,
      preselect: rawItem.g ?? undefined,
      insertText: insertTextForItem(rawItem),
      insertTextRules: rawItem.i ?? undefined,
      range: rawItem.j ?? defaultRanges ?? undefined,
      commitCharacters: rawItem.k ?? undefined,
      additionalTextEdits: rawItem.l ?? undefined,
      tags: rawItem.m ?? undefined,
    };
    if (commandNeeded(rawItem)) {
      item.command = {
        $ident: rawItem.n ?? undefined,
        id: rawItem.o ?? "",
        arguments: rawItem.p ?? undefined,
      };
    }
    items.push(item);
  }
  return items;
}

export async function provideCompletions(runtime: CompletionRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const lineNumber = Number(input.lineNumber ?? 1);
  const column = Number(input.column ?? 1);
  const timeoutMs = Number(input.timeoutMs ?? 10000);
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const triggerKind = Number(input.triggerKind ?? 0);
  const triggerCharacter = input.triggerCharacter ?? undefined;

  runtime.log(`[completions] path=${path} lang=${languageId} line=${lineNumber} col=${column} trigger=${triggerKind}`);

  if (input.text != null && path) {
    try {
      const syncResult = await ensureCompletionTextSynced(
        runtime,
        input,
        path,
        String(input.text),
        languageId,
        authority,
        timeoutMs,
      );
      const result = isRecord(syncResult) ? syncResult : {};
      runtime.log(`[completions] pre-flight didChange ack path=${path} ver=${result.versionId ?? "?"} type=${result.ackType ?? "?"}`);
    } catch (error) {
      const message = errorMessage(error);
      runtime.warn("[completions] pre-flight didChange failed", message);
      return { ok: false, error: `didChange_ack_failed: ${message}` };
    }
  }

  const providerHandle = optionalProviderHandle(input.providerHandle);
  if (providerHandle !== null) {
    return provideCompletionSingle(runtime, {
      providerHandle,
      path,
      authority,
      lineNumber,
      column,
      triggerKind,
      triggerCharacter,
      timeoutMs,
    });
  }

  let handles = runtime.findAllProviderHandles("completions", languageId);
  if (handles.length === 0) {
    await runtime.waitFor(
      () => runtime.findAllProviderHandles("completions", languageId).length > 0,
      { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 },
    );
    handles = runtime.findAllProviderHandles("completions", languageId);
  }
  if (handles.length === 0) return { ok: false, error: `no completions provider for language '${languageId}'` };

  runtime.log(`[completions] multi-provider handles=[${handles.join(",")}] for lang=${languageId}`);

  const uriObj = runtime.uriForPath(path, authority);
  const context: Record<string, unknown> = { triggerKind };
  if (triggerCharacter != null) context.triggerCharacter = triggerCharacter;

  const results = await Promise.all(handles.map((handle) => {
    const { promise } = runtime.sendExtPending(
      94,
      "$provideCompletionItems",
      [handle, uriObj, { lineNumber, column }, context],
      true,
      {
        timeoutMs: timeoutMs + 5000,
        timeoutMessage: "timed out waiting for completions reply",
        timeoutResult: null,
      },
    );
    return promise.catch(() => null);
  }));

  let mergedItems: Record<string, unknown>[] = [];
  let anyIncomplete = false;
  let firstCacheId: unknown;
  const suggestResults: Record<string, unknown>[] = [];
  for (const reply of results) {
    if (replyType(reply) !== 9) continue;
    const raw = replyResult(reply);
    if (!raw) continue;
    const rawRecord = isRecord(raw) ? raw : {};
    const rawDto = suggestResultDto(raw);
    if (rawDto) suggestResults.push(rawDto);
    const items = inflateCompletionItems(raw, runtime.log);
    if (items.length > 0) mergedItems = mergedItems.concat(items);
    if (rawRecord.c) anyIncomplete = true;
    if (rawRecord.x != null && firstCacheId == null) firstCacheId = rawRecord.x;
  }

  runtime.log(`[completions] merged ${mergedItems.length} items from ${results.filter((reply) => replyType(reply) === 9).length}/${handles.length} providers`);
  return { ok: true, result: { suggestResults, items: mergedItems, isIncomplete: anyIncomplete, cacheId: firstCacheId } };
}

export async function provideCompletionSingle(runtime: CompletionRuntime, params: CompletionSingleParams): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const uriObj = runtime.uriForPath(params.path, params.authority);
  const context: Record<string, unknown> = { triggerKind: params.triggerKind };
  if (params.triggerCharacter != null) context.triggerCharacter = params.triggerCharacter;

  const { promise } = runtime.sendExtPending(
    94,
    "$provideCompletionItems",
    [params.providerHandle, uriObj, { lineNumber: params.lineNumber, column: params.column }, context],
    true,
    {
      timeoutMs: params.timeoutMs + 5000,
      timeoutMessage: "timed out waiting for completions reply",
    },
  );
  const reply = await promise;

  if (replyType(reply) === 9) {
    const raw = replyResult(reply);
    if (!raw) return { ok: true, result: { dto: null, suggestResults: [], items: [], isIncomplete: false } };
    const rawRecord = isRecord(raw) ? raw : {};
    const items = inflateCompletionItems(raw, runtime.log);
    const rawDto = suggestResultDto(raw);
    return {
      ok: true,
      result: {
        dto: rawDto,
        suggestResults: rawDto ? [rawDto] : [],
        items,
        isIncomplete: !!rawRecord.c,
        cacheId: rawRecord.x,
      },
    };
  }
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  return { ok: false, error: reply };
}
