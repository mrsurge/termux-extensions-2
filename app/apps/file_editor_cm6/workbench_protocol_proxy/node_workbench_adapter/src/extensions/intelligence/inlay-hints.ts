export interface InlayHintsPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface InlayHintsSendResult {
  promise: Promise<unknown>;
}

export interface InlayHintsRuntime {
  ensureConnected: () => void;
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
    pendingOptions: InlayHintsPendingOptions,
  ) => InlayHintsSendResult;
  sendExtAwaitTerminalReply: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    timeoutMs: number,
  ) => InlayHintsSendResult;
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

interface InlayHintsSyncCacheEntry {
  signature: string;
  promise?: Promise<unknown>;
  result?: unknown;
}

const inlayHintsSyncByPath = new Map<string, InlayHintsSyncCacheEntry>();

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

function inlayHintsSyncSignature(
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
  runtime: InlayHintsRuntime,
  input: Record<string, unknown>,
  path: string,
  languageId: string,
  authority: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  if (input.text == null || !path) return null;
  const text = String(input.text);
  const signature = inlayHintsSyncSignature(input, text, languageId, authority);
  const cached = inlayHintsSyncByPath.get(path);
  if (cached && cached.signature === signature) {
    try {
      if (cached.promise) await cached.promise;
      runtime.log(`[inlayHints] pre-flight didChange coalesced path=${path}`);
      return null;
    } catch (error) {
      const message = errorMessage(error);
      runtime.warn("[inlayHints] pre-flight didChange failed", message);
      return { ok: false, error: `didChange_ack_failed: ${message}` };
    }
  }

  try {
    const promise = Promise.resolve(runtime.didChange(
      { path, text, languageId, authority },
      { waitForAck: true, timeoutMs: Math.min(timeoutMs, 5000) },
    ));
    inlayHintsSyncByPath.set(path, { signature, promise });
    const syncResult = await promise;
    const latest = inlayHintsSyncByPath.get(path);
    if (latest && latest.signature === signature) {
      inlayHintsSyncByPath.set(path, { signature, result: syncResult });
    }
    const result = isRecord(syncResult) ? syncResult : {};
    runtime.log(`[inlayHints] pre-flight didChange ack path=${path} ver=${result.versionId ?? "?"} type=${result.ackType ?? "?"}`);
    return null;
  } catch (error) {
    const latest = inlayHintsSyncByPath.get(path);
    if (latest && latest.signature === signature) inlayHintsSyncByPath.delete(path);
    const message = errorMessage(error);
    runtime.warn("[inlayHints] pre-flight didChange failed", message);
    return { ok: false, error: `didChange_ack_failed: ${message}` };
  }
}

function numberFrom(value: unknown, fallback = NaN): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeRange(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const startLineNumber = numberFrom(value.startLineNumber, NaN);
  const startColumn = numberFrom(value.startColumn, NaN);
  const endLineNumber = numberFrom(value.endLineNumber, NaN);
  const endColumn = numberFrom(value.endColumn, NaN);
  if (![startLineNumber, startColumn, endLineNumber, endColumn].every((part) => Number.isFinite(part))) {
    return null;
  }
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

function normalizeChainedCacheId(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = numberFrom(value[0], NaN);
  const second = numberFrom(value[1], NaN);
  return Number.isFinite(first) && Number.isFinite(second) ? [first, second] : null;
}

export async function provideInlayHints(
  runtime: InlayHintsRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const providerHandle = numberFrom(input.providerHandle, NaN);
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const timeoutMs = numberFrom(input.timeoutMs, 10000);
  const range = normalizeRange(input.range);

  runtime.log(`[inlayHints] path=${path} lang=${languageId} handle=${providerHandle}`);

  if (!Number.isFinite(providerHandle)) {
    return { ok: false, error: "missing inlay hints providerHandle" };
  }
  if (!range) {
    return { ok: false, error: "missing inlay hints range" };
  }

  const syncError = await syncTextIfProvided(runtime, input, path, languageId, authority, timeoutMs);
  if (syncError) return syncError;

  const uriObj = runtime.uriForPath(path, authority);
  const { promise } = runtime.sendExtPending(
    94,
    "$provideInlayHints",
    [providerHandle, uriObj, range],
    true,
    {
      timeoutMs: timeoutMs + 5000,
      timeoutMessage: "timed out waiting for inlay hints reply",
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

export async function resolveInlayHint(
  runtime: InlayHintsRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const providerHandle = numberFrom(input.providerHandle, NaN);
  const cacheId = normalizeChainedCacheId(input.cacheId);
  if (!Number.isFinite(providerHandle) || !cacheId) {
    return { ok: false, error: "missing inlay hints resolve params" };
  }

  const { promise } = runtime.sendExtPending(
    94,
    "$resolveInlayHint",
    [providerHandle, cacheId],
    true,
    {
      timeoutMs: 5000,
      timeoutMessage: "timed out waiting for inlay hint resolve reply",
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

export async function releaseInlayHints(
  runtime: InlayHintsRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const providerHandle = numberFrom(input.providerHandle, NaN);
  const cacheId = numberFrom(input.cacheId, NaN);
  if (!Number.isFinite(providerHandle) || !Number.isFinite(cacheId)) {
    return { ok: false, error: "missing inlay hints release params" };
  }

  const { promise } = runtime.sendExtAwaitTerminalReply(
    94,
    "$releaseInlayHints",
    [providerHandle, cacheId],
    false,
    3000,
  );
  await promise;
  return { ok: true };
}
