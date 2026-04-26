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
      const syncResult = await runtime.didChange(
        { path, text: String(input.text), languageId, authority },
        { waitForAck: true, timeoutMs: Math.min(timeoutMs, 5000) },
      );
      const result = isRecord(syncResult) ? syncResult : {};
      runtime.log(`[completions] pre-flight didChange ack path=${path} ver=${result.versionId ?? "?"} type=${result.ackType ?? "?"}`);
    } catch (error) {
      const message = errorMessage(error);
      runtime.warn("[completions] pre-flight didChange failed", message);
      return { ok: false, error: `didChange_ack_failed: ${message}` };
    }
  }

  if (typeof input.providerHandle === "number") {
    return provideCompletionSingle(runtime, {
      providerHandle: input.providerHandle,
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
  for (const reply of results) {
    if (replyType(reply) !== 9) continue;
    const raw = replyResult(reply);
    if (!raw) continue;
    const rawRecord = isRecord(raw) ? raw : {};
    const items = inflateCompletionItems(raw, runtime.log);
    if (items.length > 0) mergedItems = mergedItems.concat(items);
    if (rawRecord.c) anyIncomplete = true;
    if (rawRecord.x != null && firstCacheId == null) firstCacheId = rawRecord.x;
  }

  runtime.log(`[completions] merged ${mergedItems.length} items from ${results.filter((reply) => replyType(reply) === 9).length}/${handles.length} providers`);
  return { ok: true, result: { items: mergedItems, isIncomplete: anyIncomplete, cacheId: firstCacheId } };
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
    if (!raw) return { ok: true, result: { items: [], isIncomplete: false } };
    const rawRecord = isRecord(raw) ? raw : {};
    const items = inflateCompletionItems(raw, runtime.log);
    return { ok: true, result: { items, isIncomplete: !!rawRecord.c, cacheId: rawRecord.x } };
  }
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  return { ok: false, error: reply };
}
