/*
 * Adapted from:
 * - worktrees/vscode-te2-diff/src/vs/platform/markers/common/markerService.ts
 * - app/static/vendor/monaco-editor-core/esm/vs/platform/markers/common/markerService.js
 *
 * TE2 uses this local vendor store to mirror VS Code owner/resource diagnostics
 * semantics before projecting the active resource into Monaco's own marker service.
 */

import {
  MarkerSeverity,
  type MarkerDataLike,
  type MarkerLike,
  type MarkerReadOptionsLike,
  type MarkerStatisticsLike,
  type ResourceMarkerLike,
} from './markers.ts';

type MarkerChangeListener = (resources: readonly string[]) => void;

function sanitizePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function acceptMarkerSeverity(marker: MarkerLike, severities: number | undefined): boolean {
  return severities === undefined || (severities & Number(marker.severity || 0)) === Number(marker.severity || 0);
}

function toMarker(owner: string, resource: string, data: MarkerDataLike): MarkerLike | null {
  const message = typeof data.message === 'string' ? data.message : '';
  if (!message) return null;
  const startLineNumber = sanitizePositiveInt(data.startLineNumber, 1);
  const startColumn = sanitizePositiveInt(data.startColumn, 1);
  const endLineNumber = Math.max(sanitizePositiveInt(data.endLineNumber, startLineNumber), startLineNumber);
  const endColumn = sanitizePositiveInt(data.endColumn, startColumn);
  return {
    owner,
    resource,
    code: data.code,
    severity: Number.isFinite(Number(data.severity)) ? Number(data.severity) : MarkerSeverity.Error,
    message,
    source: typeof data.source === 'string' ? data.source : undefined,
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
    modelVersionId: Number.isFinite(Number(data.modelVersionId)) ? Number(data.modelVersionId) : undefined,
    relatedInformation: Array.isArray(data.relatedInformation) ? data.relatedInformation.slice() : undefined,
    tags: Array.isArray(data.tags) ? data.tags.slice() : undefined,
    origin: typeof data.origin === 'string' ? data.origin : undefined,
  };
}

export class VendorMarkerService {
  private readonly byResource = new Map<string, Map<string, MarkerLike[]>>();
  private readonly byOwner = new Map<string, Map<string, MarkerLike[]>>();
  private readonly listeners = new Set<MarkerChangeListener>();

  onMarkerChanged(listener: MarkerChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChanged(resources: string[]): void {
    if (!resources.length || !this.listeners.size) return;
    const deduped = Array.from(new Set(resources));
    for (const listener of this.listeners) {
      try {
        listener(deduped);
      } catch (_) {}
    }
  }

  private setOwnerResource(owner: string, resource: string, markers: MarkerLike[]): void {
    let resourceOwners = this.byResource.get(resource);
    if (!resourceOwners) {
      resourceOwners = new Map<string, MarkerLike[]>();
      this.byResource.set(resource, resourceOwners);
    }
    resourceOwners.set(owner, markers);

    let ownerResources = this.byOwner.get(owner);
    if (!ownerResources) {
      ownerResources = new Map<string, MarkerLike[]>();
      this.byOwner.set(owner, ownerResources);
    }
    ownerResources.set(resource, markers);
  }

  private deleteOwnerResource(owner: string, resource: string): boolean {
    let removed = false;

    const resourceOwners = this.byResource.get(resource);
    if (resourceOwners && resourceOwners.delete(owner)) {
      removed = true;
      if (!resourceOwners.size) this.byResource.delete(resource);
    }

    const ownerResources = this.byOwner.get(owner);
    if (ownerResources && ownerResources.delete(resource)) {
      removed = true;
      if (!ownerResources.size) this.byOwner.delete(owner);
    }

    return removed;
  }

  changeOne(owner: string, resource: string, markerData: MarkerDataLike[]): void {
    const nextMarkers = Array.isArray(markerData)
      ? markerData.map((item) => toMarker(owner, resource, item)).filter((item): item is MarkerLike => !!item)
      : [];

    if (!nextMarkers.length) {
      if (this.deleteOwnerResource(owner, resource)) {
        this.emitChanged([resource]);
      }
      return;
    }

    this.setOwnerResource(owner, resource, nextMarkers);
    this.emitChanged([resource]);
  }

  changeAll(owner: string, data: ResourceMarkerLike[]): void {
    const changedResources: string[] = [];
    const oldResources = this.byOwner.get(owner);
    if (oldResources) {
      for (const resource of Array.from(oldResources.keys())) {
        if (this.deleteOwnerResource(owner, resource)) {
          changedResources.push(resource);
        }
      }
    }

    const grouped = new Map<string, MarkerDataLike[]>();
    for (const entry of Array.isArray(data) ? data : []) {
      const resource = typeof entry?.resource === 'string' ? entry.resource : '';
      if (!resource) continue;
      const bucket = grouped.get(resource) || [];
      bucket.push(entry.marker);
      grouped.set(resource, bucket);
    }

    for (const [resource, markers] of grouped.entries()) {
      const nextMarkers = markers.map((item) => toMarker(owner, resource, item)).filter((item): item is MarkerLike => !!item);
      if (nextMarkers.length) {
        this.setOwnerResource(owner, resource, nextMarkers);
      } else {
        this.deleteOwnerResource(owner, resource);
      }
      changedResources.push(resource);
    }

    this.emitChanged(changedResources);
  }

  remove(owner: string, resources: string[]): void {
    const changedResources: string[] = [];
    for (const resource of Array.isArray(resources) ? resources : []) {
      if (typeof resource !== 'string' || !resource) continue;
      if (this.deleteOwnerResource(owner, resource)) changedResources.push(resource);
    }
    this.emitChanged(changedResources);
  }

  read(filter: MarkerReadOptionsLike = {}): MarkerLike[] {
    const owner = typeof filter.owner === 'string' ? filter.owner : '';
    const resource = typeof filter.resource === 'string' ? filter.resource : '';
    const severities = Number.isFinite(Number(filter.severities)) ? Number(filter.severities) : undefined;
    const take = Number.isFinite(Number(filter.take)) && Number(filter.take) >= 0 ? Number(filter.take) : -1;

    const result: MarkerLike[] = [];
    const pushIfAccepted = (marker: MarkerLike): boolean => {
      if (!acceptMarkerSeverity(marker, severities)) return false;
      result.push(marker);
      return take > 0 && result.length >= take;
    };

    if (owner && resource) {
      const markers = this.byResource.get(resource)?.get(owner) || [];
      for (const marker of markers) {
        if (pushIfAccepted(marker)) break;
      }
      return result;
    }

    if (resource) {
      const resourceOwners = this.byResource.get(resource);
      if (!resourceOwners) return result;
      for (const markers of resourceOwners.values()) {
        for (const marker of markers) {
          if (pushIfAccepted(marker)) return result;
        }
      }
      return result;
    }

    if (owner) {
      const ownerResources = this.byOwner.get(owner);
      if (!ownerResources) return result;
      for (const markers of ownerResources.values()) {
        for (const marker of markers) {
          if (pushIfAccepted(marker)) return result;
        }
      }
      return result;
    }

    for (const resourceOwners of this.byResource.values()) {
      for (const markers of resourceOwners.values()) {
        for (const marker of markers) {
          if (pushIfAccepted(marker)) return result;
        }
      }
    }
    return result;
  }

  getStatistics(): MarkerStatisticsLike {
    const stats: MarkerStatisticsLike = {
      errors: 0,
      warnings: 0,
      infos: 0,
      unknowns: 0,
    };
    for (const marker of this.read()) {
      if (marker.severity === MarkerSeverity.Error) stats.errors += 1;
      else if (marker.severity === MarkerSeverity.Warning) stats.warnings += 1;
      else if (marker.severity === MarkerSeverity.Info) stats.infos += 1;
      else stats.unknowns += 1;
    }
    return stats;
  }
}
