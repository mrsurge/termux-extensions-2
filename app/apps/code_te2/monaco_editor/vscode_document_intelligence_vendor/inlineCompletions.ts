/*
 * TE2 inline-completions vendor shim. The live export preserves the ext-host
 * IdentifiableInlineCompletions DTO shape all the way to the Monaco provider
 * boundary, mirroring the upstream VS Code main-thread contract as closely as
 * the current TE2 transport allows.
 */

interface VscodeInlineModelLike {
  uri?: { toString(): string };
  getLanguageId?(): string;
  getValue?(): string;
  getVersionId?(): number;
}

interface VscodeInlinePositionLike {
  lineNumber?: number;
  column?: number;
}

export interface VscodeWorkbenchInlineCompletionsDeps {
  model: VscodeInlineModelLike | null | undefined;
  position: VscodeInlinePositionLike | null | undefined;
  languageId: string;
  providerHandle: string;
  context: Record<string, unknown> | null | undefined;
  adapterTimeoutMs?: number;
  callTimeoutMs?: number;
  getCurrentPath(): string | null;
  absPathFromVscodeUri(raw: string): string | null;
  callWorkbenchInlineCompletions(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

export interface VscodeWorkbenchInlineCompletionsFreeDeps {
  providerHandle: string;
  pid: number;
  reason: Record<string, unknown>;
  callWorkbenchInlineCompletionsFree(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

export interface VscodeWorkbenchInlineCompletionsDidShowDeps {
  providerHandle: string;
  pid: number;
  idx: number;
  updatedInsertText: string;
  callWorkbenchInlineCompletionsDidShow(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function modelUriString(model: VscodeInlineModelLike | null | undefined): string {
  try {
    return model && model.uri && typeof model.uri.toString === 'function'
      ? String(model.uri.toString())
      : '';
  } catch (_) {
    return '';
  }
}

function modelText(model: VscodeInlineModelLike | null | undefined): string | undefined {
  try {
    return model && typeof model.getValue === 'function' ? String(model.getValue()) : undefined;
  } catch (_) {
    return undefined;
  }
}

function modelVersion(model: VscodeInlineModelLike | null | undefined): number | undefined {
  try {
    const version = model && typeof model.getVersionId === 'function' ? Number(model.getVersionId()) : NaN;
    return Number.isFinite(version) ? version : undefined;
  } catch (_) {
    return undefined;
  }
}

function peelWorkbenchPayload(value: unknown): Record<string, unknown> | null {
  let current = isRecord(value) ? value : null;
  for (let i = 0; current && i < 4; i += 1) {
    const inner = isRecord(current.result) ? current.result : null;
    if (!inner) break;
    if (current.ok === true || inner.dto !== undefined || inner.items !== undefined || inner.pid !== undefined) {
      current = inner;
      continue;
    }
    break;
  }
  return current;
}

function dtoFromPayload(payload: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  if (isRecord(payload.dto)) return payload.dto;
  if (payload.dto === null) return undefined;
  if (Array.isArray(payload.items) && payload.pid != null) return payload;
  return undefined;
}

export async function provideWorkbenchInlineCompletionsFromVscodeMainThread(
  deps: VscodeWorkbenchInlineCompletionsDeps,
): Promise<Record<string, unknown> | undefined> {
  const uri = modelUriString(deps.model);
  const path = uri ? (deps.absPathFromVscodeUri(uri) || String(deps.getCurrentPath() || '')) : String(deps.getCurrentPath() || '');
  if (!uri || !path) return undefined;

  const languageId = String(deps.model && deps.model.getLanguageId ? deps.model.getLanguageId() : deps.languageId || 'plaintext');
  const params: Record<string, unknown> = {
    uri,
    path,
    languageId,
    providerHandle: deps.providerHandle,
    lineNumber: Number(deps.position?.lineNumber ?? 1),
    column: Number(deps.position?.column ?? 1),
    context: isRecord(deps.context) ? deps.context : {},
    timeoutMs: Number.isFinite(Number(deps.adapterTimeoutMs)) ? Number(deps.adapterTimeoutMs) : 10000,
  };
  const text = modelText(deps.model);
  if (text !== undefined) params.text = text;
  const version = modelVersion(deps.model);
  if (version !== undefined) params.modelVersionId = version;

  const response = await deps.callWorkbenchInlineCompletions(params, {
    timeoutMs: Number.isFinite(Number(deps.callTimeoutMs)) ? Number(deps.callTimeoutMs) : 12000,
  });
  return dtoFromPayload(peelWorkbenchPayload(response));
}

export async function freeWorkbenchInlineCompletionsFromVscodeMainThread(
  deps: VscodeWorkbenchInlineCompletionsFreeDeps,
): Promise<void> {
  await deps.callWorkbenchInlineCompletionsFree(
    {
      providerHandle: deps.providerHandle,
      pid: deps.pid,
      reason: deps.reason,
    },
    { timeoutMs: 5000 },
  );
}

export async function notifyWorkbenchInlineCompletionDidShowFromVscodeMainThread(
  deps: VscodeWorkbenchInlineCompletionsDidShowDeps,
): Promise<void> {
  await deps.callWorkbenchInlineCompletionsDidShow(
    {
      providerHandle: deps.providerHandle,
      pid: deps.pid,
      idx: deps.idx,
      updatedInsertText: deps.updatedInsertText,
    },
    { timeoutMs: 5000 },
  );
}
