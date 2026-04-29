/*
 * Adapted from:
 * - worktrees/vscode-te2-diff/src/vs/workbench/api/browser/mainThreadDiagnostics.ts
 *
 * TE2 vendors the editor diagnostics ingestion seam locally. The stored
 * owner/resource semantics mirror VS Code, while Monaco standalone remains the
 * renderer sink for the active model's markers/decorations.
 */

import { VendorMarkerService } from './markerService.ts';
import type {
  MarkerCodeLike,
  MarkerDataLike,
  RelatedInformationLike,
  UriComponentsLike,
} from './markers.ts';

export interface DiagnosticsChangeManyPayloadLike {
  type?: string;
  args?: unknown[];
}

export interface VendorMainThreadDiagnosticsApplyStats {
  owner: string;
  changedResources: number;
  droppedNoUri: number;
  resources: string[];
}

interface VendorMainThreadDiagnosticsDeps {
  markerService: VendorMarkerService;
  extHostId?: string;
  uriToString?(raw: unknown): string;
  log?(message: string, ...args: unknown[]): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function uriObjToString(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (!isRecord(raw)) return '';
  const typedRaw = raw as UriComponentsLike;
  if (typeof typedRaw.external === 'string' && typedRaw.external) return typedRaw.external;
  if (typeof typedRaw.fsPath === 'string' && typedRaw.fsPath) return 'file://' + typedRaw.fsPath;
  const scheme = typeof typedRaw.scheme === 'string' ? typedRaw.scheme : '';
  const authority = typeof typedRaw.authority === 'string' ? typedRaw.authority : '';
  const path = typeof typedRaw.path === 'string' ? typedRaw.path : '';
  if (!scheme || !path) return '';
  return scheme + '://' + authority + path;
}

function asDiagnosticsChangeManyPayloadLike(value: unknown): DiagnosticsChangeManyPayloadLike | null {
  return isRecord(value) ? value as DiagnosticsChangeManyPayloadLike : null;
}

function reviveRelatedInformation(
  raw: unknown,
  uriToStringFn: (raw: unknown) => string,
): RelatedInformationLike[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const revived: RelatedInformationLike[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const resource = uriToStringFn(item.resource);
    if (!resource) continue;
    revived.push({
      resource,
      message: typeof item.message === 'string' ? item.message : '',
      startLineNumber: Number.isFinite(Number(item.startLineNumber)) ? Number(item.startLineNumber) : 1,
      startColumn: Number.isFinite(Number(item.startColumn)) ? Number(item.startColumn) : 1,
      endLineNumber: Number.isFinite(Number(item.endLineNumber)) ? Number(item.endLineNumber) : 1,
      endColumn: Number.isFinite(Number(item.endColumn)) ? Number(item.endColumn) : 1,
    });
  }
  return revived.length ? revived : undefined;
}

function reviveCode(
  raw: unknown,
  uriToStringFn: (raw: unknown) => string,
): MarkerCodeLike | undefined {
  if (typeof raw === 'string') return raw;
  if (!isRecord(raw)) return undefined;
  const value = typeof raw.value === 'string' ? raw.value : '';
  const target = uriToStringFn(raw.target);
  if (!value || !target) return undefined;
  return { value, target };
}

function reviveMarkerData(
  raw: unknown,
  extHostId: string,
  uriToStringFn: (raw: unknown) => string,
): MarkerDataLike | null {
  if (!isRecord(raw)) return null;
  return {
    code: reviveCode(raw.code, uriToStringFn),
    severity: Number.isFinite(Number(raw.severity)) ? Number(raw.severity) : undefined,
    message: typeof raw.message === 'string' ? raw.message : '',
    source: typeof raw.source === 'string' ? raw.source : undefined,
    startLineNumber: Number.isFinite(Number(raw.startLineNumber)) ? Number(raw.startLineNumber) : 1,
    startColumn: Number.isFinite(Number(raw.startColumn)) ? Number(raw.startColumn) : 1,
    endLineNumber: Number.isFinite(Number(raw.endLineNumber)) ? Number(raw.endLineNumber) : 1,
    endColumn: Number.isFinite(Number(raw.endColumn)) ? Number(raw.endColumn) : 1,
    modelVersionId: Number.isFinite(Number(raw.modelVersionId)) ? Number(raw.modelVersionId) : undefined,
    relatedInformation: reviveRelatedInformation(raw.relatedInformation, uriToStringFn),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is number => Number.isFinite(Number(tag))).map((tag) => Number(tag)) : undefined,
    origin: typeof raw.origin === 'string' && raw.origin ? raw.origin : extHostId,
  };
}

function parseChangeManyPayload(
  payload: unknown,
  extHostId: string,
  uriToStringFn: (raw: unknown) => string,
): { owner: string; entries: Array<{ resource: string; markers: MarkerDataLike[] }> } | null {
  const typedPayload = asDiagnosticsChangeManyPayloadLike(payload);
  if (!typedPayload || typedPayload.type !== 'diagnostics/changeMany' || !Array.isArray(typedPayload.args) || typedPayload.args.length < 2) {
    return null;
  }

  const owner = typeof typedPayload.args[0] === 'string' && typedPayload.args[0]
    ? typedPayload.args[0]
    : 'unknown';
  const pairs = Array.isArray(typedPayload.args[1]) ? typedPayload.args[1] : [];
  const entries: Array<{ resource: string; markers: MarkerDataLike[] }> = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const resource = uriToStringFn(pair[0]);
    if (!resource) continue;
    const rawMarkers = Array.isArray(pair[1]) ? pair[1] : [];
    const markers = rawMarkers
      .map((marker) => reviveMarkerData(marker, extHostId, uriToStringFn))
      .filter((marker): marker is MarkerDataLike => !!marker);
    entries.push({ resource, markers });
  }
  return { owner, entries };
}

export class VendorMainThreadDiagnostics {
  private readonly markerService: VendorMarkerService;
  private readonly extHostId: string;
  private readonly uriToStringFn: (raw: unknown) => string;
  private readonly logFn?: (message: string, ...args: unknown[]) => void;

  constructor(deps: VendorMainThreadDiagnosticsDeps) {
    this.markerService = deps.markerService;
    this.extHostId = typeof deps.extHostId === 'string' && deps.extHostId ? deps.extHostId : 'te2ExtHost1';
    this.uriToStringFn = deps.uriToString || uriObjToString;
    this.logFn = deps.log;
  }

  applyChangeMany(payload: unknown): VendorMainThreadDiagnosticsApplyStats | null {
    const parsed = parseChangeManyPayload(payload, this.extHostId, this.uriToStringFn);
    if (!parsed) return null;

    let droppedNoUri = 0;
    const resources: string[] = [];
    for (const entry of parsed.entries) {
      if (!entry.resource) {
        droppedNoUri += 1;
        continue;
      }
      this.markerService.changeOne(parsed.owner, entry.resource, entry.markers);
      resources.push(entry.resource);
      if (this.logFn) {
        this.logFn(
          '[workbench] diagnostics changeOne owner=' + parsed.owner + ' resource=' + entry.resource + ' count=' + entry.markers.length,
        );
      }
    }

    return {
      owner: parsed.owner,
      changedResources: resources.length,
      droppedNoUri,
      resources,
    };
  }
}
