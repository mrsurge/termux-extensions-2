import { Buffer } from "node:buffer";

export interface DiagnosticsSnapshotStats {
  owners: number;
  resources: number;
  bytes: number;
}

interface DiagnosticsSnapshotEntry {
  owner: string;
  resource: unknown;
  markers: unknown[];
  bytes: number;
}

interface DiagnosticsSnapshotOptions {
  uriToString: (resource: unknown) => string;
  maxResources?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_RESOURCES = 512;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function estimateBytes(resource: unknown, markers: unknown[]): number {
  try {
    return Buffer.byteLength(JSON.stringify([resource, markers]), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Retains the latest extension-host diagnostic payload per owner/resource.
 *
 * A WBA frontend can connect after the extension host has already published
 * diagnostics for a retained logical document. The live broadcast cannot help
 * that late client, so the existing explicit `te2.resync` transaction replays
 * this bounded snapshot alongside provider and workspace state.
 */
export class DiagnosticsSnapshotStore {
  private readonly uriToString: (resource: unknown) => string;
  private readonly maxResources: number;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, DiagnosticsSnapshotEntry>();
  private totalBytes = 0;

  constructor(options: DiagnosticsSnapshotOptions) {
    this.uriToString = options.uriToString;
    this.maxResources = Math.max(
      1,
      Math.floor(options.maxResources ?? DEFAULT_MAX_RESOURCES),
    );
    this.maxBytes = Math.max(1024, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  }

  apply(event: unknown): boolean {
    if (!isRecord(event) || event.type !== "diagnostics/changeMany") return false;
    const args = Array.isArray(event.args) ? event.args : [];
    const owner = typeof args[0] === "string" ? args[0].trim() : "";
    const pairs = Array.isArray(args[1]) ? args[1] : [];
    if (!owner) return false;

    let changed = false;
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const resource = pair[0];
      const resourceKey = this.uriToString(resource);
      const markers = Array.isArray(pair[1]) ? pair[1].slice() : [];
      if (!resourceKey) continue;
      const key = `${owner}\u0000${resourceKey}`;
      const previous = this.entries.get(key);
      if (previous) {
        this.totalBytes -= previous.bytes;
        this.entries.delete(key);
      }

      changed = true;
      if (!markers.length) continue;
      const bytes = estimateBytes(resource, markers);
      if (!Number.isFinite(bytes) || bytes > this.maxBytes) continue;
      this.entries.set(key, { owner, resource, markers, bytes });
      this.totalBytes += bytes;
      this.evictToBounds();
    }
    return changed;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  buildResyncEvents(nowMs: () => number = Date.now): Record<string, unknown>[] {
    const byOwner = new Map<string, Array<[unknown, unknown[]]>>();
    for (const entry of this.entries.values()) {
      const pairs = byOwner.get(entry.owner) ?? [];
      pairs.push([entry.resource, entry.markers]);
      byOwner.set(entry.owner, pairs);
    }
    return Array.from(byOwner, ([owner, pairs]) => ({
      type: "diagnostics/changeMany",
      ts_ms: nowMs(),
      args: [owner, pairs],
      resync: true,
    }));
  }

  stats(): DiagnosticsSnapshotStats {
    return {
      owners: new Set(Array.from(this.entries.values(), (entry) => entry.owner)).size,
      resources: this.entries.size,
      bytes: this.totalBytes,
    };
  }

  private evictToBounds(): void {
    while (this.entries.size > this.maxResources || this.totalBytes > this.maxBytes) {
      const oldest = this.entries.entries().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value[0]);
      this.totalBytes -= oldest.value[1].bytes;
    }
  }
}
