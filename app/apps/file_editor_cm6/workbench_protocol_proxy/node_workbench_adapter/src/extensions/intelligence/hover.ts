import type { ProviderDocument } from "../provider-registry";

export interface HoverPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timeoutResult?: unknown;
}

export interface HoverSendResult {
  promise: Promise<unknown>;
}

export interface HoverRuntime {
  ensureConnected: () => void;
  languageFeaturesRpcId: number;
  defaultAuthority: () => string;
  documentScheme: () => string;
  languageIdFromPath: (filePath: string) => string;
  updateActiveDocument: (path: string, uriObj: unknown, languageId: string) => void;
  findAllProviderHandles: (
    kind: "hover",
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
    pendingOptions: HoverPendingOptions,
  ) => HoverSendResult;
  log: (...args: unknown[]) => void;
}

export interface HoverSingleParams {
  providerHandle: number;
  path: string;
  lineNumber: number;
  column: number;
  authority: string;
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

function hoverId(reply: unknown): unknown {
  const result = replyResult(reply);
  return field(result, "id");
}

function hoverRange(reply: unknown): unknown {
  const result = replyResult(reply);
  return field(result, "range");
}

function hoverContents(reply: unknown): unknown[] {
  const result = replyResult(reply);
  const contents = field(result, "contents");
  return Array.isArray(contents) ? contents : [];
}

export async function provideHover(runtime: HoverRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const authority = String(input.authority ?? runtime.defaultAuthority());
  const path = String(input.path ?? "");
  const lineNumber = Number(input.lineNumber ?? 1);
  const column = Number(input.column ?? 1);
  const timeoutMs = Number(input.timeoutMs ?? 8000);
  const languageId = String(input.languageId || "") || runtime.languageIdFromPath(path) || "plaintext";
  const document: ProviderDocument = {
    languageId,
    scheme: runtime.documentScheme(),
    authority,
    path,
  };

  if (input.providerHandle != null) {
    return provideHoverSingle(runtime, {
      providerHandle: Number(input.providerHandle),
      path,
      lineNumber,
      column,
      authority,
    });
  }

  let handles = runtime.findAllProviderHandles("hover", document);
  if (handles.length === 0) {
    await runtime.waitFor(
      () => runtime.findAllProviderHandles("hover", document).length > 0,
      { timeoutMs, intervalMs: 50 },
    );
    handles = runtime.findAllProviderHandles("hover", document);
  }
  if (handles.length === 0) return { ok: false, error: `no hover provider for language '${languageId}'` };

  runtime.log(`[hover] path=${path} languageId=${languageId} handles=[${handles.join(",")}]`);

  const uriObj = runtime.uriForPath(path, authority);
  runtime.updateActiveDocument(path, uriObj, languageId);

  const pending = handles.map((handle) => {
    const { promise } = runtime.sendExtPending(
      runtime.languageFeaturesRpcId,
      "$provideHover",
      [handle, uriObj, { lineNumber, column }, undefined],
      true,
      {
        timeoutMs: 15000,
        timeoutMessage: "timed out waiting for hover reply",
        timeoutResult: { type: 7 },
      },
    );
    return { handle, promise };
  });

  const results = await Promise.all(pending.map((entry) => entry.promise));

  let mergedContents: unknown[] = [];
  let mergedRange: unknown = null;
  for (let index = 0; index < results.length; index += 1) {
    const pendingEntry = pending[index];
    if (!pendingEntry) continue;
    const reply = results[index];
    runtime.log(
      `[hover:debug] handle=${pendingEntry.handle} repType=${replyType(reply)} hasResult=${replyResult(reply) != null} result=${JSON.stringify(replyResult(reply))?.slice(0, 300)}`,
    );
    if (replyType(reply) === 9 && replyResult(reply) != null) {
      if (!mergedRange && hoverRange(reply)) mergedRange = hoverRange(reply);
      mergedContents.push(...hoverContents(reply));
    }
  }

  if (mergedContents.length > 0) {
    const firstId = results.find((reply) => hoverId(reply) != null);
    return {
      ok: true,
      result: {
        range: mergedRange,
        contents: mergedContents,
        id: hoverId(firstId) ?? 0,
      },
    };
  }

  const firstError = results.find((reply) => replyType(reply) === 11);
  if (firstError) return { ok: false, error: replyError(firstError) };
  return { ok: true, result: null };
}

export async function provideHoverSingle(
  runtime: HoverRuntime,
  params: HoverSingleParams,
): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const uriObj = runtime.uriForPath(params.path, params.authority);
  const { promise } = runtime.sendExtPending(
    runtime.languageFeaturesRpcId,
    "$provideHover",
    [params.providerHandle, uriObj, { lineNumber: params.lineNumber, column: params.column }, undefined],
    true,
    {
      timeoutMs: 15000,
      timeoutMessage: "timed out waiting for hover reply",
    },
  );
  const reply = await promise;
  runtime.log(`[hover:debug] single handle=${params.providerHandle} repType=${replyType(reply)} hasResult=${replyResult(reply) != null}`);
  if (replyType(reply) === 9) return { ok: true, result: replyResult(reply) };
  if (replyType(reply) === 11) return { ok: false, error: replyError(reply) };
  return { ok: false, error: reply };
}
