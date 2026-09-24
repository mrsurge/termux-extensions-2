import type { ProviderDocument } from "../provider-registry";
import { completionTrace } from "../../server/runtime-debug.mjs";
import { completionTimeouts } from "../../protocol/completion-timeouts.mjs";

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
  languageFeaturesRpcId: number;
  defaultAuthority: () => string;
  documentScheme: () => string;
  languageIdFromPath: (filePath: string) => string;
  didChange: (
    params: Record<string, unknown>,
    opts: { waitForAck: true; timeoutMs: number },
  ) => Promise<unknown> | unknown;
  findAllProviderHandles: (
    kind: "completions",
    document: ProviderDocument,
  ) => number[];
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

export async function provideCompletions(runtime: CompletionRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  const input = isRecord(params) ? params : {};
  const request = completionTrace.record("completion.begin", {
    language: input.languageId, path: input.path, frontendRequest: input.debugRequestId,
  });
  try {
    const result = await runCompletions(runtime, params, request);
    completionTrace.record("completion.end", { request, ok: result.ok });
    return result;
  } catch (error) {
    completionTrace.record("completion.failed", { request });
    throw error;
  }
}

async function runCompletions(runtime: CompletionRuntime, params: unknown, request: number): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const lineNumber = Number(input.lineNumber ?? 1);
  const column = Number(input.column ?? 1);
  const timeoutMs = completionTimeouts(input.timeoutMs).providerMs;
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const triggerKind = Number(input.triggerKind ?? 0);
  const triggerCharacter = input.triggerCharacter ?? undefined;
  const document: ProviderDocument = {
    languageId,
    scheme: runtime.documentScheme(),
    authority,
    path,
  };

  runtime.log(`[completions] path=${path} lang=${languageId} line=${lineNumber} col=${column} trigger=${triggerKind}`);

  const sync = await synchronizeCompletionText(runtime, input, request);
  if (sync.ok !== true) return sync;

  const providerHandle = optionalProviderHandle(input.providerHandle);
  if (providerHandle !== null) {
    // The frontend registers providers separately; retain server-side selector
    // matching so a pinned handle cannot run against an unrelated document.
    if (!runtime.findAllProviderHandles("completions", document).includes(providerHandle)) {
      return { ok: true, result: { providers: [] } };
    }
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

  let handles = runtime.findAllProviderHandles("completions", document);
  if (handles.length === 0) {
    completionTrace.record("completion.providerWait.begin", { request, language: languageId });
    await runtime.waitFor(
      () => runtime.findAllProviderHandles("completions", document).length > 0,
      { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 },
    );
    handles = runtime.findAllProviderHandles("completions", document);
    completionTrace.record("completion.providerWait.end", { request, count: handles.length });
  }
  if (handles.length === 0) return { ok: false, error: `no completions provider for language '${languageId}'` };

  runtime.log(`[completions] multi-provider handles=[${handles.join(",")}] for lang=${languageId}`);

  const uriObj = runtime.uriForPath(path, authority);
  const context: Record<string, unknown> = { triggerKind };
  if (triggerCharacter != null) context.triggerCharacter = triggerCharacter;

  const results = await Promise.all(handles.map((handle) => {
    completionTrace.record("completion.rpc.sent", { request, handle });
    const { promise } = runtime.sendExtPending(
      runtime.languageFeaturesRpcId,
      "$provideCompletionItems",
      [handle, uriObj, { lineNumber, column }, context],
      true,
      {
        timeoutMs,
        timeoutMessage: "timed out waiting for completions reply",
        timeoutResult: null,
      },
    );
    return promise.then(reply => {
      completionTrace.record("completion.rpc.reply", { request, handle, replyType: replyType(reply) });
      return reply;
    }, () => {
      completionTrace.record("completion.rpc.failed", { request, handle });
      return null;
    });
  }));

  // Project each original DTO once. Monaco owns inflation and provider merging;
  // keep this batch form for non-pinned callers without expanding suggestions.
  const providers: Array<{ handle: number; dto: Record<string, unknown> }> = [];
  results.forEach((reply, index) => {
    if (replyType(reply) !== 9) return;
    const dto = replyResult(reply);
    const handle = handles[index];
    if (handle !== undefined && isRecord(dto)) providers.push({ handle, dto });
  });
  return { ok: true, result: { providers } };
}

export async function provideCompletionSingle(runtime: CompletionRuntime, params: CompletionSingleParams): Promise<Record<string, unknown>> {
  const request = completionTrace.record("completion.single.begin", { handle: params.providerHandle });
  runtime.ensureConnected();
  const uriObj = runtime.uriForPath(params.path, params.authority);
  const context: Record<string, unknown> = { triggerKind: params.triggerKind };
  if (params.triggerCharacter != null) context.triggerCharacter = params.triggerCharacter;

  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
    "$provideCompletionItems",
    [params.providerHandle, uriObj, { lineNumber: params.lineNumber, column: params.column }, context],
    true,
    {
      timeoutMs: completionTimeouts(params.timeoutMs).providerMs,
      timeoutMessage: "timed out waiting for completions reply",
    },
  );
  let reply: unknown;
  try { reply = await promise; }
  catch (error) {
    completionTrace.record("completion.single.failed", { request });
    throw error;
  }
  completionTrace.record("completion.single.reply", { request, replyType: replyType(reply) });

  if (replyType(reply) === 9) {
    const raw = replyResult(reply);
    return { ok: true, result: { providers: isRecord(raw) ? [{ handle: params.providerHandle, dto: raw }] : [] } };
  }
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  return { ok: false, error: reply };
}

// Only synchronization needs the projected client facade. Provider RPCs use an
// explicit URI and can run outside that gate, independently of other providers.
export async function synchronizeCompletionText(runtime: CompletionRuntime, input: Record<string, unknown>, request = 0): Promise<Record<string, unknown>> {
  const path = String(input.path ?? "");
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const timeoutMs = completionTimeouts(input.timeoutMs).providerMs;
  if (input.text != null && path) {
    completionTrace.record("completion.sync.begin", { request });
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
      completionTrace.record("completion.sync.end", { request });
      runtime.log(`[completions] pre-flight didChange ack path=${path} ver=${result.versionId ?? "?"} type=${result.ackType ?? "?"}`);
    } catch (error) {
      const message = errorMessage(error);
      completionTrace.record("completion.sync.failed", { request });
      runtime.warn("[completions] pre-flight didChange failed", message);
      return { ok: false, error: `didChange_ack_failed: ${message}` };
    }
  }

  return { ok: true };
}
