export interface InlineCompletionPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface InlineCompletionSendResult {
  promise: Promise<unknown>;
}

export interface InlineCompletionRuntime {
  ensureConnected: () => void;
  languageFeaturesRpcId: number;
  defaultAuthority: () => string;
  languageIdFromPath: (filePath: string) => string;
  didChange: (
    params: Record<string, unknown>,
    opts: { waitForAck: true; timeoutMs: number },
  ) => Promise<unknown> | unknown;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: InlineCompletionPendingOptions,
  ) => InlineCompletionSendResult;
  sendExtAwaitTerminalReply: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    timeoutMs: number,
  ) => InlineCompletionSendResult;
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

interface InlineCompletionSyncCacheEntry {
  signature: string;
  promise?: Promise<unknown>;
  result?: unknown;
}

const inlineCompletionSyncByPath = new Map<string, InlineCompletionSyncCacheEntry>();

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

function inlineCompletionSyncSignature(
  input: Record<string, unknown>,
  text: string,
  languageId: string,
  authority: string,
): string {
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

async function syncTextIfProvided(
  runtime: InlineCompletionRuntime,
  input: Record<string, unknown>,
  path: string,
  languageId: string,
  authority: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  if (input.text == null || !path) return null;
  const text = String(input.text);
  const signature = inlineCompletionSyncSignature(input, text, languageId, authority);
  const cached = inlineCompletionSyncByPath.get(path);
  if (cached && cached.signature === signature) {
    try {
      if (cached.promise) await cached.promise;
      runtime.log(`[inlineCompletions] pre-flight didChange coalesced path=${path}`);
      return null;
    } catch (error) {
      const message = errorMessage(error);
      runtime.warn("[inlineCompletions] pre-flight didChange failed", message);
      return { ok: false, error: `didChange_ack_failed: ${message}` };
    }
  }

  try {
    const promise = Promise.resolve(runtime.didChange(
      { path, text, languageId, authority },
      { waitForAck: true, timeoutMs: Math.min(timeoutMs, 5000) },
    ));
    inlineCompletionSyncByPath.set(path, { signature, promise });
    const syncResult = await promise;
    const latest = inlineCompletionSyncByPath.get(path);
    if (latest && latest.signature === signature) {
      inlineCompletionSyncByPath.set(path, { signature, result: syncResult });
    }
    const result = isRecord(syncResult) ? syncResult : {};
    runtime.log(`[inlineCompletions] pre-flight didChange ack path=${path} ver=${result.versionId ?? "?"} type=${result.ackType ?? "?"}`);
    return null;
  } catch (error) {
    const latest = inlineCompletionSyncByPath.get(path);
    if (latest && latest.signature === signature) inlineCompletionSyncByPath.delete(path);
    const message = errorMessage(error);
    runtime.warn("[inlineCompletions] pre-flight didChange failed", message);
    return { ok: false, error: `didChange_ack_failed: ${message}` };
  }
}

function numberFrom(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function provideInlineCompletions(
  runtime: InlineCompletionRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const lineNumber = Number(input.lineNumber ?? 1);
  const column = Number(input.column ?? 1);
  const timeoutMs = Number(input.timeoutMs ?? 10000);
  const providerHandle = numberFrom(input.providerHandle, NaN);
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const context = isRecord(input.context) ? input.context : {};

  runtime.log(`[inlineCompletions] path=${path} lang=${languageId} line=${lineNumber} col=${column} handle=${providerHandle}`);

  if (!Number.isFinite(providerHandle)) {
    return { ok: false, error: "missing inline completions providerHandle" };
  }

  const syncError = await syncTextIfProvided(runtime, input, path, languageId, authority, timeoutMs);
  if (syncError) return syncError;

  const uriObj = runtime.uriForPath(path, authority);
  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
    "$provideInlineCompletions",
    [providerHandle, uriObj, { lineNumber, column }, context],
    true,
    {
      timeoutMs: timeoutMs + 5000,
      timeoutMessage: "timed out waiting for inline completions reply",
    },
  );
  const reply = await promise;

  if (replyType(reply) === 9) {
    return { ok: true, result: { dto: replyResult(reply) ?? null } };
  }
  if (replyType(reply) === 7) {
    return { ok: true, result: { dto: null } };
  }
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  return { ok: false, error: reply };
}

export async function freeInlineCompletions(
  runtime: InlineCompletionRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const providerHandle = numberFrom(input.providerHandle, NaN);
  const pid = numberFrom(input.pid, NaN);
  const reason = input.reason;
  if (!Number.isFinite(providerHandle) || !Number.isFinite(pid) || !isRecord(reason)) {
    return { ok: false, error: "missing inline completions free params" };
  }

  const { promise } = runtime.sendExtAwaitTerminalReply(
    runtime.languageFeaturesRpcId,
    "$freeInlineCompletionsList",
    [providerHandle, pid, reason],
    false,
    3000,
  );
  await promise;
  return { ok: true };
}

export async function handleInlineCompletionDidShow(
  runtime: InlineCompletionRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const providerHandle = numberFrom(input.providerHandle, NaN);
  const pid = numberFrom(input.pid, NaN);
  const idx = numberFrom(input.idx, NaN);
  const updatedInsertText = typeof input.updatedInsertText === "string" ? input.updatedInsertText : "";
  if (!Number.isFinite(providerHandle) || !Number.isFinite(pid) || !Number.isFinite(idx)) {
    return { ok: false, error: "missing inline completions didShow params" };
  }

  const { promise } = runtime.sendExtAwaitTerminalReply(
    runtime.languageFeaturesRpcId,
    "$handleInlineCompletionDidShow",
    [providerHandle, pid, idx, updatedInsertText],
    false,
    3000,
  );
  await promise;
  return { ok: true };
}
