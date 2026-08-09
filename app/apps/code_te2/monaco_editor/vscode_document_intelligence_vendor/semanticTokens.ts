/*
 * TE2 semantic-token vendor shim. The live exports mirror the VS Code
 * MainThreadDocumentSemanticTokensProvider / MainThreadDocumentRangeSemanticTokensProvider
 * adapter contract while accepting the JSON-safe DTO shape emitted by the WBA.
 * Sources:
 * - worktrees/vscode-te2-diff/src/vs/workbench/api/browser/mainThreadLanguageFeatures.ts
 * - worktrees/vscode-te2-diff/src/vs/editor/common/services/semanticTokensDto.ts
 */

interface VscodeSemanticBridgeModel {
  uri?: { toString(): string };
  getLanguageId?(): string;
  getValue?(): string;
  getVersionId?(): number;
}

interface VscodeSemanticRangeLike {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
}

interface SemanticTokensDeltaDtoLike {
  start?: number;
  deleteCount?: number;
  data?: unknown;
}

interface VscodeSemanticTokensDtoLike {
  id?: number | string;
  resultId?: number | string;
  type?: 'full' | 'delta' | number | string;
  data?: unknown;
  deltas?: unknown;
  edits?: unknown;
}

export interface VscodeWorkbenchSemanticTokensDeps {
  model: VscodeSemanticBridgeModel | null | undefined;
  languageId: string;
  lastResultId?: string | null;
  adapterTimeoutMs?: number;
  callTimeoutMs?: number;
  getCurrentPath(): string | null;
  absPathFromVscodeUri(raw: string): string | null;
  callWorkbenchSemanticTokens(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

export interface VscodeWorkbenchSemanticTokensRangeDeps {
  model: VscodeSemanticBridgeModel | null | undefined;
  languageId: string;
  range: VscodeSemanticRangeLike | null | undefined;
  adapterTimeoutMs?: number;
  callTimeoutMs?: number;
  getCurrentPath(): string | null;
  absPathFromVscodeUri(raw: string): string | null;
  callWorkbenchSemanticTokensRange(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  return null;
}

function asNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function modelUriString(model: VscodeSemanticBridgeModel | null | undefined): string {
  try {
    return model && model.uri && typeof model.uri.toString === 'function'
      ? String(model.uri.toString())
      : '';
  } catch (_) {
    return '';
  }
}

function modelText(model: VscodeSemanticBridgeModel | null | undefined): string | undefined {
  try {
    return model && typeof model.getValue === 'function' ? String(model.getValue()) : undefined;
  } catch (_) {
    return undefined;
  }
}

function modelVersion(model: VscodeSemanticBridgeModel | null | undefined): number | undefined {
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
    if (current.ok === true || inner.dto !== undefined || inner.type !== undefined || inner.data !== undefined || inner.edits !== undefined || inner.deltas !== undefined) {
      current = inner;
      continue;
    }
    break;
  }
  return current;
}

function dtoFromPayload(payload: Record<string, unknown> | null): VscodeSemanticTokensDtoLike | null {
  if (!payload) return null;
  if (isRecord(payload.dto)) return payload.dto as VscodeSemanticTokensDtoLike;
  if (payload.type != null && (payload.data != null || payload.deltas != null || payload.edits != null)) {
    return payload as VscodeSemanticTokensDtoLike;
  }
  return null;
}

function uint32ArrayFrom(value: unknown): Uint32Array {
  const values = asArray(value) || [];
  return new Uint32Array(values.map((item) => asNumber(item)));
}

function deltaEditsFromDto(dto: VscodeSemanticTokensDtoLike): Array<{ start: number; deleteCount: number; data?: Uint32Array }> {
  const rawEdits = asArray(dto.deltas) || asArray(dto.edits) || [];
  const edits: Array<{ start: number; deleteCount: number; data?: Uint32Array }> = [];
  for (const raw of rawEdits) {
    const edit = isRecord(raw) ? raw as SemanticTokensDeltaDtoLike : {};
    const normalized: { start: number; deleteCount: number; data?: Uint32Array } = {
      start: asNumber(edit.start),
      deleteCount: asNumber(edit.deleteCount),
    };
    if (edit.data != null) normalized.data = uint32ArrayFrom(edit.data);
    edits.push(normalized);
  }
  return edits;
}

function documentTokensFromDto(dto: VscodeSemanticTokensDtoLike | null): { resultId: string; data: Uint32Array } | { resultId: string; edits: Array<{ start: number; deleteCount: number; data?: Uint32Array }> } | null {
  if (!dto) return null;
  const resultId = String(dto.id ?? dto.resultId ?? '');
  const type = dto.type;
  if (type === 'delta' || type === 2 || dto.deltas != null || dto.edits != null) {
    return {
      resultId,
      edits: deltaEditsFromDto(dto),
    };
  }
  return {
    resultId,
    data: uint32ArrayFrom(dto.data),
  };
}

function rangeTokensFromDto(dto: VscodeSemanticTokensDtoLike | null): { resultId: string; data: Uint32Array } | null {
  if (!dto) return null;
  const type = dto.type;
  if (type === 'delta' || type === 2 || dto.deltas != null || dto.edits != null) {
    throw new Error('Unexpected');
  }
  return {
    resultId: String(dto.id ?? dto.resultId ?? ''),
    data: uint32ArrayFrom(dto.data),
  };
}

export async function provideWorkbenchDocumentSemanticTokensFromVscodeMainThread(
  deps: VscodeWorkbenchSemanticTokensDeps,
): Promise<{ resultId: string; data: Uint32Array } | { resultId: string; edits: Array<{ start: number; deleteCount: number; data?: Uint32Array }> } | null> {
  const uri = modelUriString(deps.model);
  const path = uri ? (deps.absPathFromVscodeUri(uri) || String(deps.getCurrentPath() || '')) : String(deps.getCurrentPath() || '');
  if (!uri || !path) return null;

  const languageId = String(deps.model && deps.model.getLanguageId ? deps.model.getLanguageId() : deps.languageId || 'plaintext');
  const previousResultId = deps.lastResultId ? String(deps.lastResultId) : '0';
  const params: Record<string, unknown> = {
    uri,
    path,
    languageId,
    previousResultId,
    timeoutMs: Number.isFinite(Number(deps.adapterTimeoutMs)) ? Number(deps.adapterTimeoutMs) : 10000,
  };
  const text = modelText(deps.model);
  if (text !== undefined) params.text = text;
  const version = modelVersion(deps.model);
  if (version !== undefined) params.modelVersionId = version;

  const response = await deps.callWorkbenchSemanticTokens(params, {
    timeoutMs: Number.isFinite(Number(deps.callTimeoutMs)) ? Number(deps.callTimeoutMs) : 12000,
  });
  return documentTokensFromDto(dtoFromPayload(peelWorkbenchPayload(response)));
}

export async function provideWorkbenchDocumentRangeSemanticTokensFromVscodeMainThread(
  deps: VscodeWorkbenchSemanticTokensRangeDeps,
): Promise<{ resultId: string; data: Uint32Array } | null> {
  const uri = modelUriString(deps.model);
  const path = uri ? (deps.absPathFromVscodeUri(uri) || String(deps.getCurrentPath() || '')) : String(deps.getCurrentPath() || '');
  if (!uri || !path || !deps.range) return null;

  const languageId = String(deps.model && deps.model.getLanguageId ? deps.model.getLanguageId() : deps.languageId || 'plaintext');
  const params: Record<string, unknown> = {
    uri,
    path,
    languageId,
    range: {
      startLineNumber: deps.range.startLineNumber,
      startColumn: deps.range.startColumn,
      endLineNumber: deps.range.endLineNumber,
      endColumn: deps.range.endColumn,
    },
    timeoutMs: Number.isFinite(Number(deps.adapterTimeoutMs)) ? Number(deps.adapterTimeoutMs) : 10000,
  };
  const text = modelText(deps.model);
  if (text !== undefined) params.text = text;
  const version = modelVersion(deps.model);
  if (version !== undefined) params.modelVersionId = version;

  const response = await deps.callWorkbenchSemanticTokensRange(params, {
    timeoutMs: Number.isFinite(Number(deps.callTimeoutMs)) ? Number(deps.callTimeoutMs) : 12000,
  });
  return rangeTokensFromDto(dtoFromPayload(peelWorkbenchPayload(response)));
}

/*
 * Upstream VS Code reference excerpt:
 * MainThreadDocumentSemanticTokensProvider.provideDocumentSemanticTokens(...)
 * calls $provideDocumentSemanticTokens(handle, model.uri, lastResultId, token),
 * decodes ISemanticTokensDto with decodeSemanticTokensDto(...), and returns
 * { resultId: String(dto.id), data: dto.data } for full DTOs or
 * { resultId: String(dto.id), edits: dto.deltas } for delta DTOs.
 * MainThreadDocumentRangeSemanticTokensProvider expects only a full DTO.
 */
