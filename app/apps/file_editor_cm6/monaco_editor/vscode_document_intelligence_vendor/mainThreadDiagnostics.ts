/*
 * TE2 diagnostics vendor shim for the editor-only lane. This mirrors the VS Code
 * MainThreadDiagnostics.$changeMany(owner, entries) marker shape while keeping
 * Explorer/problem-list fanout on TE2's normalized diagnostics/update path.
 * Source: worktrees/vscode-te2-diff/src/vs/workbench/api/browser/mainThreadDiagnostics.ts
 */

interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
}

interface MonacoEditorNamespaceLike {
  getModelMarkers?(opts: { resource: MonacoUriLike }): unknown[];
  setModelMarkers?(model: MonacoModelLike, owner: string, markers: Array<Record<string, unknown>>): void;
}

interface VscodeDiagnosticsApplyDeps {
  model: MonacoModelLike | null | undefined;
  editorNs: MonacoEditorNamespaceLike | null | undefined;
  payload: unknown;
  currentPath: string;
  activeUri: string;
  absPathFromVscodeUri(raw: string): string | null;
  uriToString?(raw: unknown): string;
  markKnownOwner(owner: string): void;
  emitCounts(path: string): void;
  log?(message: string, ...args: unknown[]): void;
}

export interface VscodeDiagnosticsApplyStats {
  applied: number;
  dropNoPath: number;
  dropNoModel: number;
  dropMismatch: number;
}

interface DiagnosticsEntryLike {
  uri: string;
  path: string;
  markers: Array<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function uriObjToString(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (!isRecord(raw)) return '';
  if (typeof raw.external === 'string' && raw.external) return raw.external;
  if (typeof raw.fsPath === 'string' && raw.fsPath) return 'file://' + raw.fsPath;
  const scheme = typeof raw.scheme === 'string' ? raw.scheme : '';
  const authority = typeof raw.authority === 'string' ? raw.authority : '';
  const path = typeof raw.path === 'string' ? raw.path : '';
  if (!scheme || !path) return '';
  return scheme + '://' + authority + path;
}

function markerArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) {
    if (Array.isArray(raw.__json_with_buffers__)) return raw.__json_with_buffers__;
    if (Array.isArray(raw.markers)) return raw.markers;
  }
  return [];
}

function coerceMarker(raw: unknown, extHostId: string): Record<string, unknown> {
  const marker = isRecord(raw) ? { ...raw } : {};
  if (marker.origin === undefined) marker.origin = extHostId;
  return marker;
}

function entriesFromChangeManyPayload(
  payload: unknown,
  absPathFromVscodeUri: (raw: string) => string | null,
  uriToString: (raw: unknown) => string,
  extHostId: string,
): { owner: string; entries: DiagnosticsEntryLike[] } | null {
  const record = isRecord(payload) ? payload : null;
  const args = Array.isArray(record?.args) ? record.args : null;
  if (!args || args.length < 2) return null;
  const owner = typeof args[0] === 'string' ? args[0] : 'unknown';
  const pairs = Array.isArray(args[1]) ? args[1] : [];
  const entries: DiagnosticsEntryLike[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const uri = uriToString(pair[0]);
    const path = uri ? absPathFromVscodeUri(uri) || '' : '';
    if (!uri || !path) continue;
    entries.push({
      uri,
      path,
      markers: markerArray(pair[1]).map((marker) => coerceMarker(marker, extHostId)),
    });
  }
  return { owner, entries };
}

function entriesFromNormalizedPayload(
  payload: unknown,
  absPathFromVscodeUri: (raw: string) => string | null,
  extHostId: string,
): { owner: string; entries: DiagnosticsEntryLike[] } | null {
  const record = isRecord(payload) ? payload : null;
  if (!record) return null;
  const owner = record.owner != null ? String(record.owner) : 'workbench';
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const entries: DiagnosticsEntryLike[] = [];
  for (const rawItem of rawItems) {
    const item = isRecord(rawItem) ? rawItem : null;
    if (!item) continue;
    const uri = String(item.uri || item.resource || '');
    const path = uri ? absPathFromVscodeUri(uri) || '' : '';
    if (!uri || !path) continue;
    entries.push({
      uri,
      path,
      markers: markerArray(item.markers).map((marker) => coerceMarker(marker, extHostId)),
    });
  }
  return { owner, entries };
}

export function applyVscodeDiagnosticsChangeManyToActiveModel(deps: VscodeDiagnosticsApplyDeps): VscodeDiagnosticsApplyStats {
  const stats: VscodeDiagnosticsApplyStats = { applied: 0, dropNoPath: 0, dropNoModel: 0, dropMismatch: 0 };
  const model = deps.model;
  const editorNs = deps.editorNs;
  if (!model || !model.uri || !editorNs || typeof editorNs.setModelMarkers !== 'function') {
    stats.dropNoModel += 1;
    return stats;
  }

  const uriToString = deps.uriToString || uriObjToString;
  const record = isRecord(deps.payload) ? deps.payload : null;
  const group = record?.type === 'diagnostics/changeMany'
    ? entriesFromChangeManyPayload(deps.payload, deps.absPathFromVscodeUri, uriToString, 'te2ExtHost')
    : entriesFromNormalizedPayload(deps.payload, deps.absPathFromVscodeUri, 'te2ExtHost');
  if (!group) return stats;

  const activePath = deps.currentPath || (deps.activeUri ? deps.absPathFromVscodeUri(deps.activeUri) || '' : '');
  for (const entry of group.entries) {
    if (!entry.path) {
      stats.dropNoPath += 1;
      continue;
    }
    if (activePath && entry.path !== activePath) {
      stats.dropMismatch += 1;
      continue;
    }
    deps.markKnownOwner(group.owner);
    editorNs.setModelMarkers(model, group.owner, entry.markers);
    stats.applied += 1;
    deps.emitCounts(entry.path);
    if (deps.log) deps.log('[workbench] setModelMarkers raw owner=' + group.owner + ' count=' + entry.markers.length + ' path=' + entry.path);
  }
  return stats;
}

/*
 * Upstream VS Code reference excerpt:
 * MainThreadDiagnostics.$changeMany(owner, entries) revives marker resources,
 * ensures marker.origin, then calls markerService.changeOne(owner, uri, markers)
 * for each resource. TE2's editor lane keeps that owner/resource/marker shape
 * and only filters to the active model before calling setModelMarkers.
 */
