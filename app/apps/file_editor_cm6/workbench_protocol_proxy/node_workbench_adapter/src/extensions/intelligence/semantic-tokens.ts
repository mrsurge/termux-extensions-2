export interface SemanticPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface SemanticSendResult {
  promise: Promise<unknown>;
}

export interface SemanticProviderEntry {
  legend?: unknown;
}

export interface SemanticRuntime {
  ensureConnected: () => void;
  defaultAuthority: () => string;
  languageIdFromPath: (filePath: string) => string;
  didChange: (
    params: Record<string, unknown>,
    opts: { waitForAck: true; timeoutMs: number },
  ) => Promise<unknown> | unknown;
  findAllProviderHandles: (kind: "semanticTokens", languageId: string) => number[];
  findSemanticRangeHandles: (languageId: string) => number[];
  waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: SemanticPendingOptions,
  ) => SemanticSendResult;
  getProvider: (kind: "semanticTokens", handle: number) => SemanticProviderEntry | undefined;
  log: (message: string) => void;
  warn: (message: string) => void;
  timeLabel: () => string;
}

export interface SemanticSingleParams {
  providerHandle: number;
  path: string;
  authority: string;
  previousResultId: string;
  timeoutMs: number;
}

export interface SemanticRangeParams {
  path: string;
  authority: string;
  timeoutMs: number;
  languageId: string;
  range: Record<string, unknown>;
}

export interface SemanticParsedFull {
  type: "full";
  resultId: string;
  data: number[];
  dto: SemanticTokensFullDto;
  legend?: unknown;
}

export interface SemanticParsedDeltaEdit {
  start: number;
  deleteCount: number;
  data?: number[];
}

export interface SemanticParsedDelta {
  type: "delta";
  resultId: string;
  edits: SemanticParsedDeltaEdit[];
  dto: SemanticTokensDeltaDto;
  legend?: unknown;
}

export type SemanticParsedResult = SemanticParsedFull | SemanticParsedDelta;

export interface SemanticTokensFullDto {
  id: number;
  type: "full";
  data: number[];
}

export interface SemanticTokensDeltaDto {
  id: number;
  type: "delta";
  deltas: SemanticParsedDeltaEdit[];
}

interface SemanticSyncCacheEntry {
  signature: string;
  promise?: Promise<unknown>;
  result?: unknown;
}

const semanticSyncByPath = new Map<string, SemanticSyncCacheEntry>();

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

function replyReq(reply: unknown): number | null {
  const req = field(reply, "req");
  return typeof req === "number" ? req : null;
}

function replyResult(reply: unknown): unknown {
  return field(reply, "result");
}

function replyError(reply: unknown): unknown {
  return field(reply, "error");
}

function replyBuffer(reply: unknown): Uint8Array | null {
  const buffer = field(reply, "buffer");
  if (buffer instanceof Uint8Array) return buffer;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  return null;
}

function numberFrom(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

function semanticSyncSignature(input: Record<string, unknown>, text: string, languageId: string, authority: string): string {
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
  runtime: SemanticRuntime,
  input: Record<string, unknown>,
  path: string,
  languageId: string,
  authority: string,
  timeoutMs: number,
  label: string,
): Promise<Record<string, unknown> | null> {
  if (input.text == null || !path) return null;
  const text = String(input.text);
  const signature = semanticSyncSignature(input, text, languageId, authority);
  const cached = semanticSyncByPath.get(path);
  if (cached && cached.signature === signature) {
    try {
      if (cached.promise) {
        await cached.promise;
      }
      runtime.log(`[${label}] pre-flight didChange coalesced path=${path}`);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.warn(`[${label}] pre-flight didChange failed: ${message}`);
      return { ok: false, error: `didChange_ack_failed: ${message}` };
    }
  }

  try {
    const promise = Promise.resolve(runtime.didChange(
      { path, text, languageId, authority },
      { waitForAck: true, timeoutMs: Math.min(timeoutMs, 5000) },
    ));
    semanticSyncByPath.set(path, { signature, promise });
    const syncResult = await promise;
    const latest = semanticSyncByPath.get(path);
    if (latest && latest.signature === signature) {
      semanticSyncByPath.set(path, { signature, result: syncResult });
    }
    const result = isRecord(syncResult) ? syncResult : {};
    runtime.log(`[${label}] pre-flight didChange ack path=${path} ver=${result.versionId ?? "?"} type=${result.ackType ?? "?"}`);
    return null;
  } catch (error) {
    const latest = semanticSyncByPath.get(path);
    if (latest && latest.signature === signature) semanticSyncByPath.delete(path);
    const message = error instanceof Error ? error.message : String(error);
    runtime.warn(`[${label}] pre-flight didChange failed: ${message}`);
    return { ok: false, error: `didChange_ack_failed: ${message}` };
  }
}

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => numberFrom(item));
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return Array.from(new Uint32Array(view.buffer, view.byteOffset, Math.floor(view.byteLength / 4)));
  }
  return [];
}

function emptySemanticTokensResult(legend: unknown = null): SemanticParsedFull {
  const dto: SemanticTokensFullDto = { id: 0, type: "full", data: [] };
  return { type: "full", resultId: "", data: [], dto, legend };
}

function semanticScore(result: SemanticParsedResult | null): number {
  if (!result) return -1;
  return result.type === "full" ? result.data.length : result.edits.length;
}

export function parseSemanticTokensDto(dto: unknown): SemanticParsedResult {
  const id = numberFrom(field(dto, "id") ?? field(dto, "resultId"));
  const resultIdRaw = field(dto, "id") ?? field(dto, "resultId");
  const resultId = resultIdRaw == null ? "" : String(resultIdRaw);

  if (field(dto, "type") === 2 || field(dto, "edits") || field(dto, "deltas")) {
    const rawEdits = field(dto, "deltas") ?? field(dto, "edits");
    const edits: SemanticParsedDeltaEdit[] = [];
    if (Array.isArray(rawEdits)) {
      for (const edit of rawEdits) {
        const normalized: SemanticParsedDeltaEdit = {
          start: numberFrom(field(edit, "start")),
          deleteCount: numberFrom(field(edit, "deleteCount")),
        };
        if (field(edit, "data") != null) {
          normalized.data = toNumberArray(field(edit, "data"));
        }
        edits.push(normalized);
      }
    }
    const rawDto: SemanticTokensDeltaDto = {
      id,
      type: "delta",
      deltas: edits,
    };
    return {
      type: "delta",
      resultId,
      edits,
      dto: rawDto,
    };
  }

  const data = toNumberArray(field(dto, "data"));
  const rawDto: SemanticTokensFullDto = {
    id,
    type: "full",
    data,
  };
  return {
    type: "full",
    resultId,
    data,
    dto: rawDto,
  };
}

export function parseSemanticTokensReply(
  reply: unknown,
  legend: unknown,
  log: (message: string) => void = () => undefined,
  warn: (message: string) => void = () => undefined,
): SemanticParsedResult | null {
  const buffer = replyBuffer(reply);
  log(`★★★ [SEMANTIC_TOKENS_REPLY] type=${replyType(reply)} req=${replyReq(reply)} bufBytes=${buffer?.byteLength ?? 0} hasResult=${replyResult(reply) != null} hasError=${replyError(reply) != null}`);

  if (replyType(reply) === 8 && buffer) {
    const aligned = new Uint8Array(buffer.byteLength);
    aligned.set(buffer);
    const src = new Uint32Array(aligned.buffer, 0, aligned.byteLength >>> 2);
    if (src.length < 2) return emptySemanticTokensResult(legend);

    let offset = 0;
    const dtoId = numberFrom(src[offset++]);
    const dtoType = numberFrom(src[offset++]);

    if (dtoType === 1) {
      const dataLen = numberFrom(src[offset++]);
      const data = Array.from(src.subarray(offset, offset + dataLen));
      log(`★★★ [SEMANTIC_TOKENS_DTO] full id=${dtoId} dataLen=${dataLen} tokens=${dataLen / 5}`);
      if (dataLen >= 5) {
        log(`★★★ [SEMANTIC_TOKENS_DATA] first tokens: [${data.slice(0, 20).join(", ")}]`);
      }
      return { type: "full", resultId: String(dtoId), data, dto: { id: dtoId, type: "full", data }, legend };
    }

    if (dtoType === 2) {
      const deltaCount = numberFrom(src[offset++]);
      const edits: SemanticParsedDeltaEdit[] = [];
      for (let i = 0; i < deltaCount; i += 1) {
        const start = numberFrom(src[offset++]);
        const deleteCount = numberFrom(src[offset++]);
        const dataLen = numberFrom(src[offset++]);
        let data: number[] | undefined;
        if (dataLen > 0) {
          data = Array.from(src.subarray(offset, offset + dataLen));
          offset += dataLen;
        }
        const edit: SemanticParsedDeltaEdit = { start, deleteCount };
        if (data) edit.data = data;
        edits.push(edit);
      }
      log(`★★★ [SEMANTIC_TOKENS_DTO] delta id=${dtoId} edits=${edits.length}`);
      return { type: "delta", resultId: String(dtoId), edits, dto: { id: dtoId, type: "delta", deltas: edits }, legend };
    }

    warn(`★★★ [SEMANTIC_TOKENS_DTO] unknown dtoType=${dtoType} id=${dtoId}`);
    return emptySemanticTokensResult(legend);
  }

  if (replyType(reply) === 7) {
    return emptySemanticTokensResult(legend);
  }

  if (replyType(reply) === 9) {
    const raw = replyResult(reply);
    if (!raw) return emptySemanticTokensResult(legend);
    return { ...parseSemanticTokensDto(raw), legend };
  }

  return null;
}

export async function provideSemanticTokens(runtime: SemanticRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const timeoutMs = Number(input.timeoutMs ?? 10000);
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const previousResultId = String(input.previousResultId ?? "0");

  runtime.log(`[semanticTokens] path=${path} lang=${languageId} prevResultId=${previousResultId}`);

  const syncError = await syncTextIfProvided(runtime, input, path, languageId, authority, timeoutMs, "semanticTokens");
  if (syncError) return syncError;

  if (typeof input.providerHandle === "number") {
    return provideSemanticTokensSingle(runtime, {
      providerHandle: input.providerHandle,
      path,
      authority,
      previousResultId,
      timeoutMs,
    });
  }

  let handles = runtime.findAllProviderHandles("semanticTokens", languageId);
  if (handles.length === 0) {
    await runtime.waitFor(
      () => runtime.findAllProviderHandles("semanticTokens", languageId).length > 0,
      { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 },
    );
    handles = runtime.findAllProviderHandles("semanticTokens", languageId);
  }
  if (handles.length === 0) return { ok: false, error: `no semanticTokens provider for language '${languageId}'` };

  runtime.log(`[semanticTokens] multi-provider handles=[${handles.join(",")}] for lang=${languageId}`);

  const uriObj = runtime.uriForPath(path, authority);
  const results = await Promise.all(handles.map((handle) => {
    const legend = runtime.getProvider("semanticTokens", handle)?.legend ?? null;
    const { promise } = runtime.sendExtPending(
      94,
      "$provideDocumentSemanticTokens",
      [handle, uriObj, previousResultId],
      true,
      {
        timeoutMs: timeoutMs + 5000,
        timeoutMessage: "timed out waiting for semanticTokens reply",
        timeoutResult: null,
      },
    );
    return promise.then((reply) => ({ reply, legend })).catch(() => null);
  }));

  let best: SemanticParsedResult | null = null;
  let bestScore = -1;
  for (const result of results) {
    if (!result || result.reply == null) continue;
    const parsed = parseSemanticTokensReply(result.reply, result.legend, runtime.log, runtime.warn);
    const score = semanticScore(parsed);
    if (score > bestScore) {
      bestScore = score;
      best = parsed;
    }
  }

  if (best) {
    runtime.log(`[semanticTokens] picked best from ${results.filter((result) => result?.reply != null).length}/${handles.length} providers, score=${bestScore}`);
    return { ok: true, result: best };
  }

  for (const result of results) {
    if (replyType(result?.reply) === 11) return { ok: false, error: replyError(result?.reply) };
  }
  return { ok: true, result: emptySemanticTokensResult(null) };
}

export async function provideSemanticTokensSingle(runtime: SemanticRuntime, params: SemanticSingleParams): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const legend = runtime.getProvider("semanticTokens", params.providerHandle)?.legend ?? null;
  const uriObj = runtime.uriForPath(params.path, params.authority);
  const { promise } = runtime.sendExtPending(
    94,
    "$provideDocumentSemanticTokens",
    [params.providerHandle, uriObj, params.previousResultId],
    true,
    {
      timeoutMs: params.timeoutMs + 5000,
      timeoutMessage: "timed out waiting for semanticTokens reply",
    },
  );
  const reply = await promise;

  const parsed = parseSemanticTokensReply(reply, legend, runtime.log, runtime.warn);
  if (parsed) return { ok: true, result: parsed };
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  return { ok: false, error: reply };
}

export async function provideSemanticTokensRange(runtime: SemanticRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const timeoutMs = Number(input.timeoutMs ?? 10000);
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const range = isRecord(input.range) ? input.range : null;

  if (!range) return { ok: false, error: "range is required for semanticTokensRange" };

  runtime.log(`${runtime.timeLabel()} [semanticTokensRange] path=${path} lang=${languageId} range=${range.startLineNumber}:${range.startColumn}-${range.endLineNumber}:${range.endColumn}`);

  const syncError = await syncTextIfProvided(runtime, input, path, languageId, authority, timeoutMs, "semanticTokensRange");
  if (syncError) return syncError;

  let handles = runtime.findSemanticRangeHandles(languageId);
  if (handles.length === 0) {
    await runtime.waitFor(
      () => runtime.findSemanticRangeHandles(languageId).length > 0,
      { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 },
    );
    handles = runtime.findSemanticRangeHandles(languageId);
  }
  if (handles.length === 0) return { ok: false, error: `no semanticTokensRange provider for language '${languageId}'` };

  runtime.log(`${runtime.timeLabel()} [semanticTokensRange] multi-provider handles=[${handles.join(",")}] for lang=${languageId}`);

  const uriObj = runtime.uriForPath(path, authority);
  const results = await Promise.all(handles.map((handle) => {
    const legend = runtime.getProvider("semanticTokens", handle)?.legend ?? null;
    const { promise } = runtime.sendExtPending(
      94,
      "$provideDocumentRangeSemanticTokens",
      [handle, uriObj, range],
      true,
      {
        timeoutMs: timeoutMs + 5000,
        timeoutMessage: "timed out waiting for semanticTokens range reply",
        timeoutResult: null,
      },
    );
    return promise.then((reply) => ({ reply, legend })).catch(() => null);
  }));

  let best: SemanticParsedResult | null = null;
  let bestScore = -1;
  for (const result of results) {
    if (!result || result.reply == null) continue;
    const parsed = parseSemanticTokensReply(result.reply, result.legend, runtime.log, runtime.warn);
    const score = semanticScore(parsed);
    if (score > bestScore) {
      bestScore = score;
      best = parsed;
    }
  }

  if (best) {
    runtime.log(`${runtime.timeLabel()} [semanticTokensRange] picked best from ${results.filter((result) => result?.reply != null).length}/${handles.length} providers, score=${bestScore}`);
    return { ok: true, result: best };
  }

  for (const result of results) {
    if (replyType(result?.reply) === 11) return { ok: false, error: replyError(result?.reply) };
  }
  return { ok: true, result: emptySemanticTokensResult(null) };
}

export async function getSemanticTokensLegend(runtime: SemanticRuntime, languageId: string): Promise<unknown> {
  let handles = runtime.findAllProviderHandles("semanticTokens", languageId);
  if (handles.length === 0) {
    await runtime.waitFor(
      () => runtime.findAllProviderHandles("semanticTokens", languageId).length > 0,
      { timeoutMs: 8000, intervalMs: 100 },
    );
    handles = runtime.findAllProviderHandles("semanticTokens", languageId);
  }
  if (handles.length === 0) return null;
  for (const handle of handles) {
    const entry = runtime.getProvider("semanticTokens", handle);
    if (entry?.legend) return entry.legend;
  }
  return null;
}
