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
  languageFeaturesRpcId: number;
  defaultAuthority: () => string;
  languageIdFromPath: (filePath: string) => string;
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

  const uriObj = runtime.uriForPath(path, authority);
  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
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
    runtime.languageFeaturesRpcId,
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
    runtime.languageFeaturesRpcId,
    "$releaseInlayHints",
    [providerHandle, cacheId],
    false,
    3000,
  );
  await promise;
  return { ok: true };
}
