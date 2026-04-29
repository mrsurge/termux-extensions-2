/*
 * TE2 inlay-hints vendor shim. The live exports preserve the ext-host inlay
 * hint DTO shape until the Monaco provider boundary, mirroring the upstream
 * VS Code main-thread contract closely enough for the current transport.
 */

interface VscodeInlayModelLike {
  uri?: { toString(): string };
  getLanguageId?(): string;
}

interface VscodeInlayRangeLike {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
}

export interface VscodeWorkbenchInlayHintsDeps {
  model: VscodeInlayModelLike | null | undefined;
  range: VscodeInlayRangeLike | null | undefined;
  languageId: string;
  providerHandle: string;
  adapterTimeoutMs?: number;
  callTimeoutMs?: number;
  getCurrentPath(): string | null;
  absPathFromVscodeUri(raw: string): string | null;
  callWorkbenchInlayHints(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
  callWorkbenchInlayHintsRelease(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

export interface VscodeWorkbenchInlayHintResolveDeps {
  providerHandle: string;
  hint: Record<string, unknown>;
  callWorkbenchInlayHintsResolve(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

export interface VscodeWorkbenchInlayHintsReleaseDeps {
  providerHandle: string;
  cacheId: number;
  callWorkbenchInlayHintsRelease(
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function modelUriString(model: VscodeInlayModelLike | null | undefined): string {
  try {
    return model && model.uri && typeof model.uri.toString === 'function'
      ? String(model.uri.toString())
      : '';
  } catch (_) {
    return '';
  }
}

function normalizeRange(range: VscodeInlayRangeLike | null | undefined): Record<string, number> | null {
  if (!range) return null;
  const startLineNumber = Number(range.startLineNumber ?? NaN);
  const startColumn = Number(range.startColumn ?? NaN);
  const endLineNumber = Number(range.endLineNumber ?? NaN);
  const endColumn = Number(range.endColumn ?? NaN);
  if (![startLineNumber, startColumn, endLineNumber, endColumn].every((part) => Number.isFinite(part))) {
    return null;
  }
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

function peelWorkbenchPayload(value: unknown): Record<string, unknown> | null {
  let current = isRecord(value) ? value : null;
  for (let i = 0; current && i < 4; i += 1) {
    const inner = isRecord(current.result) ? current.result : null;
    if (!inner) break;
    if (current.ok === true || inner.dto !== undefined || inner.hints !== undefined || inner.cacheId !== undefined) {
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
  if (Array.isArray(payload.hints)) return payload;
  return undefined;
}

function cloneLabelPart(value: unknown): unknown {
  return isRecord(value) ? { ...value } : value;
}

function cloneHint(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const hint: Record<string, unknown> = { ...value };
  if (Array.isArray(value.label)) {
    hint.label = value.label.map(cloneLabelPart);
  }
  return hint;
}

function chainedCacheId(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = Number(value[0]);
  const second = Number(value[1]);
  return Number.isFinite(first) && Number.isFinite(second) ? [first, second] : null;
}

export async function provideWorkbenchInlayHintsFromVscodeMainThread(
  deps: VscodeWorkbenchInlayHintsDeps,
): Promise<{ hints: Record<string, unknown>[]; dispose(): void } | undefined> {
  const uri = modelUriString(deps.model);
  const path = uri ? (deps.absPathFromVscodeUri(uri) || String(deps.getCurrentPath() || '')) : String(deps.getCurrentPath() || '');
  const range = normalizeRange(deps.range);
  if (!uri || !path || !range) return undefined;

  const languageId = String(deps.model && deps.model.getLanguageId ? deps.model.getLanguageId() : deps.languageId || 'plaintext');
  const params: Record<string, unknown> = {
    uri,
    path,
    languageId,
    providerHandle: deps.providerHandle,
    range,
    timeoutMs: Number.isFinite(Number(deps.adapterTimeoutMs)) ? Number(deps.adapterTimeoutMs) : 10000,
  };

  const response = await deps.callWorkbenchInlayHints(params, {
    timeoutMs: Number.isFinite(Number(deps.callTimeoutMs)) ? Number(deps.callTimeoutMs) : 12000,
  });
  const dto = dtoFromPayload(peelWorkbenchPayload(response));
  if (!dto || !Array.isArray(dto.hints)) return undefined;

  const hints = dto.hints
    .map(cloneHint)
    .filter((hint): hint is Record<string, unknown> => !!hint);
  const cacheId = Number(dto.cacheId);
  return {
    hints,
    dispose() {
      if (!Number.isFinite(cacheId)) return;
      void releaseWorkbenchInlayHintsFromVscodeMainThread({
        providerHandle: deps.providerHandle,
        cacheId,
        callWorkbenchInlayHintsRelease(params2, opts) {
          return deps.callWorkbenchInlayHintsRelease(params2, opts);
        },
      }).catch(() => {});
    },
  };
}

export async function resolveWorkbenchInlayHintFromVscodeMainThread(
  deps: VscodeWorkbenchInlayHintResolveDeps,
): Promise<Record<string, unknown>> {
  const cacheId = chainedCacheId(deps.hint.cacheId);
  if (!cacheId) return deps.hint;
  const response = await deps.callWorkbenchInlayHintsResolve(
    {
      providerHandle: deps.providerHandle,
      cacheId,
    },
    { timeoutMs: 5000 },
  );
  const dto = dtoFromPayload(peelWorkbenchPayload(response));
  if (!dto) return deps.hint;
  const merged = cloneHint(deps.hint) || { ...deps.hint };
  const resolved = cloneHint(dto) || { ...dto };
  return {
    ...merged,
    ...resolved,
    label: resolved.label !== undefined ? resolved.label : merged.label,
    tooltip: resolved.tooltip !== undefined ? resolved.tooltip : merged.tooltip,
    textEdits: resolved.textEdits !== undefined ? resolved.textEdits : merged.textEdits,
    cacheId: resolved.cacheId !== undefined ? resolved.cacheId : merged.cacheId,
  };
}

export async function releaseWorkbenchInlayHintsFromVscodeMainThread(
  deps: VscodeWorkbenchInlayHintsReleaseDeps,
): Promise<void> {
  await deps.callWorkbenchInlayHintsRelease(
    {
      providerHandle: deps.providerHandle,
      cacheId: deps.cacheId,
    },
    { timeoutMs: 5000 },
  );
}
