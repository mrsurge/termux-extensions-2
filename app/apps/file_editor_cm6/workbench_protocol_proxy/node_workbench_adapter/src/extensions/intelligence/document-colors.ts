import type { ProviderDocument } from "../provider-registry";

export interface DocumentColorPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface DocumentColorSendResult {
  promise: Promise<unknown>;
}

export interface DocumentColorRuntime {
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
    kind: "documentColors",
    document: ProviderDocument,
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
    pendingOptions: DocumentColorPendingOptions,
  ) => DocumentColorSendResult;
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

interface DocumentColorSyncCacheEntry {
  signature: string;
  promise?: Promise<unknown>;
  result?: unknown;
}

const documentColorSyncByPath = new Map<
  string,
  DocumentColorSyncCacheEntry
>();

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

function optionalProviderHandle(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const handle = Number(value);
  return Number.isFinite(handle) ? handle : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function textHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

function documentColorSyncSignature(
  input: Record<string, unknown>,
  text: string,
  languageId: string,
  authority: string,
): string {
  const modelVersionId = input.modelVersionId;
  const versionPart =
    modelVersionId == null ? "no-version" : String(modelVersionId);
  return [
    authority,
    languageId,
    versionPart,
    String(text.length),
    textHash(text),
  ].join("|");
}

async function ensureDocumentColorTextSynced(
  runtime: DocumentColorRuntime,
  input: Record<string, unknown>,
  path: string,
  text: string,
  languageId: string,
  authority: string,
  timeoutMs: number,
): Promise<unknown> {
  const signature = documentColorSyncSignature(
    input,
    text,
    languageId,
    authority,
  );
  const cached = documentColorSyncByPath.get(path);
  if (cached && cached.signature === signature) {
    if (cached.promise) return cached.promise;
    return cached.result;
  }

  const promise = Promise.resolve(
    runtime.didChange(
      { path, text, languageId, authority },
      { waitForAck: true, timeoutMs: Math.min(timeoutMs, 5000) },
    ),
  );
  documentColorSyncByPath.set(path, { signature, promise });
  try {
    const result = await promise;
    const latest = documentColorSyncByPath.get(path);
    if (latest && latest.signature === signature) {
      documentColorSyncByPath.set(path, { signature, result });
    }
    return result;
  } catch (error) {
    const latest = documentColorSyncByPath.get(path);
    if (latest && latest.signature === signature) {
      documentColorSyncByPath.delete(path);
    }
    throw error;
  }
}

function colorTupleFromValue(
  value: unknown,
): [number, number, number, number] | null {
  if (Array.isArray(value) && value.length >= 4) {
    return [
      finiteNumber(value[0]),
      finiteNumber(value[1]),
      finiteNumber(value[2]),
      finiteNumber(value[3], 1),
    ];
  }
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  return [
    finiteNumber(record.red),
    finiteNumber(record.green),
    finiteNumber(record.blue),
    finiteNumber(record.alpha, 1),
  ];
}

function normalizeRange(value: unknown): Record<string, number> | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const startLineNumber = finiteNumber(record.startLineNumber, NaN);
  const startColumn = finiteNumber(record.startColumn, NaN);
  const endLineNumber = finiteNumber(record.endLineNumber, NaN);
  const endColumn = finiteNumber(record.endColumn, NaN);
  if (
    !Number.isFinite(startLineNumber) ||
    !Number.isFinite(startColumn) ||
    !Number.isFinite(endLineNumber) ||
    !Number.isFinite(endColumn)
  ) {
    return null;
  }
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

function normalizeRawColorInfo(value: unknown): Record<string, unknown> | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const color = colorTupleFromValue(record.color);
  const range = normalizeRange(record.range);
  if (!color || !range) return null;
  return { color, range };
}

function normalizeTextEdit(value: unknown): Record<string, unknown> | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const range = normalizeRange(record.range);
  const text =
    record.text == null
      ? record.newText == null
        ? null
        : String(record.newText)
      : String(record.text);
  if (!range || text == null) return null;
  return { ...record, range, text };
}

function normalizeColorPresentation(
  value: unknown,
): Record<string, unknown> | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const label = typeof record.label === "string" ? record.label : "";
  if (!label) return null;
  const out: Record<string, unknown> = { label };
  const textEdit = normalizeTextEdit(record.textEdit);
  if (textEdit) out.textEdit = textEdit;
  if (Array.isArray(record.additionalTextEdits)) {
    const edits = record.additionalTextEdits
      .map(normalizeTextEdit)
      .filter((item): item is Record<string, unknown> => !!item);
    if (edits.length) out.additionalTextEdits = edits;
  }
  return out;
}

async function documentColorHandles(
  runtime: DocumentColorRuntime,
  input: Record<string, unknown>,
  document: ProviderDocument,
  timeoutMs: number,
): Promise<number[]> {
  const providerHandle = optionalProviderHandle(input.providerHandle);
  if (providerHandle !== null) return [providerHandle];
  let handles = runtime.findAllProviderHandles("documentColors", document);
  if (handles.length === 0) {
    await runtime.waitFor(
      () =>
        runtime.findAllProviderHandles("documentColors", document).length >
        0,
      { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 },
    );
    handles = runtime.findAllProviderHandles("documentColors", document);
  }
  return handles;
}

export async function provideDocumentColors(
  runtime: DocumentColorRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const timeoutMs = finiteNumber(input.timeoutMs, 10000);
  const languageId =
    String(input.languageId || "") ||
    runtime.languageIdFromPath(path) ||
    "plaintext";
  const document: ProviderDocument = {
    languageId,
    scheme: runtime.documentScheme(),
    authority,
    path,
  };

  if (input.text != null && path) {
    try {
      const syncResult = await ensureDocumentColorTextSynced(
        runtime,
        input,
        path,
        String(input.text),
        languageId,
        authority,
        timeoutMs,
      );
      const result = isRecord(syncResult) ? syncResult : {};
      runtime.log(
        `[documentColors] pre-flight didChange ack path=${path} ver=${String(result.versionId ?? "?")} type=${String(result.ackType ?? "?")}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.warn("[documentColors] pre-flight didChange failed", message);
      return { ok: false, error: `didChange_ack_failed: ${message}` };
    }
  }

  const handles = await documentColorHandles(
    runtime,
    input,
    document,
    timeoutMs,
  );
  if (handles.length === 0) {
    return {
      ok: false,
      error: `no document color provider for language '${languageId}'`,
    };
  }

  const uriObj = runtime.uriForPath(path, authority);
  const replies = await Promise.all(
    handles.map((handle) => {
      const { promise } = runtime.sendExtPending(
        runtime.languageFeaturesRpcId,
        "$provideDocumentColors",
        [handle, uriObj],
        true,
        {
          timeoutMs: timeoutMs + 5000,
          timeoutMessage: "timed out waiting for document colors reply",
          timeoutResult: null,
        },
      );
      return promise.catch((error) => {
        runtime.warn("[documentColors] provider failed", error);
        return null;
      });
    }),
  );

  const colors: Record<string, unknown>[] = [];
  let succeeded = 0;
  for (const reply of replies) {
    if (replyType(reply) === 9) {
      succeeded += 1;
      const raw = replyResult(reply);
      if (!Array.isArray(raw)) continue;
      for (const item of raw) {
        const normalized = normalizeRawColorInfo(item);
        if (normalized) colors.push(normalized);
      }
      continue;
    }
    if (replyType(reply) === 11) {
      runtime.warn("[documentColors] provider returned error", replyError(reply));
    }
  }

  runtime.log(
    `[documentColors] merged ${colors.length} colors from ${succeeded}/${handles.length} providers`,
  );
  return { ok: true, result: { colors, providerCount: succeeded } };
}

export async function provideColorPresentations(
  runtime: DocumentColorRuntime,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const timeoutMs = finiteNumber(input.timeoutMs, 10000);
  const languageId =
    String(input.languageId || "") ||
    runtime.languageIdFromPath(path) ||
    "plaintext";
  const colorInfo = normalizeRawColorInfo(input.colorInfo);
  if (!colorInfo) return { ok: false, error: "invalid colorInfo" };

  const handles = await documentColorHandles(
    runtime,
    input,
    languageId,
    timeoutMs,
  );
  if (handles.length === 0) {
    return {
      ok: false,
      error: `no document color provider for language '${languageId}'`,
    };
  }

  const uriObj = runtime.uriForPath(path, authority);
  const replies = await Promise.all(
    handles.map((handle) => {
      const { promise } = runtime.sendExtPending(
        runtime.languageFeaturesRpcId,
        "$provideColorPresentations",
        [handle, uriObj, colorInfo],
        true,
        {
          timeoutMs: timeoutMs + 5000,
          timeoutMessage: "timed out waiting for color presentations reply",
          timeoutResult: null,
        },
      );
      return promise.catch((error) => {
        runtime.warn("[colorPresentations] provider failed", error);
        return null;
      });
    }),
  );

  const presentations: Record<string, unknown>[] = [];
  let succeeded = 0;
  for (const reply of replies) {
    if (replyType(reply) === 9) {
      succeeded += 1;
      const raw = replyResult(reply);
      if (!Array.isArray(raw)) continue;
      for (const item of raw) {
        const normalized = normalizeColorPresentation(item);
        if (normalized) presentations.push(normalized);
      }
      continue;
    }
    if (replyType(reply) === 11) {
      runtime.warn(
        "[colorPresentations] provider returned error",
        replyError(reply),
      );
    }
  }

  runtime.log(
    `[colorPresentations] merged ${presentations.length} presentations from ${succeeded}/${handles.length} providers`,
  );
  return { ok: true, result: { presentations, providerCount: succeeded } };
}
