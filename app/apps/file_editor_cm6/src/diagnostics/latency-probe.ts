export type DiagnosticsLatencyFields = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface DiagnosticsLatencyRecord extends DiagnosticsLatencyFields {
  sequence: number;
  kind: string;
  atMs: number;
}

export interface DiagnosticsLatencySnapshot {
  enabled: boolean;
  capacity: number;
  dropped: number;
  records: DiagnosticsLatencyRecord[];
}

export interface DiagnosticsLatencyProbeApi {
  start: () => DiagnosticsLatencySnapshot;
  snapshot: () => DiagnosticsLatencySnapshot;
  stop: () => DiagnosticsLatencySnapshot;
  clear: () => DiagnosticsLatencySnapshot;
}

interface OpenTrace {
  startedAtMs: number;
  path: string;
}

declare global {
  interface Window {
    __te2DiagnosticsOpenProbe?: DiagnosticsLatencyProbeApi;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class DiagnosticsLatencyProbe {
  readonly capacity: number;
  private enabled = false;
  private dropped = 0;
  private sequence = 0;
  private records: DiagnosticsLatencyRecord[] = [];
  private openTraces = new Map<string, OpenTrace>();

  constructor(capacity = 512) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  start(): DiagnosticsLatencySnapshot {
    this.enabled = true;
    return this.snapshot();
  }

  stop(): DiagnosticsLatencySnapshot {
    this.enabled = false;
    return this.snapshot();
  }

  clear(): DiagnosticsLatencySnapshot {
    this.records.length = 0;
    this.openTraces.clear();
    this.dropped = 0;
    this.sequence = 0;
    return this.snapshot();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  record(kind: string, fields: DiagnosticsLatencyFields = {}): void {
    if (!this.enabled) return;
    this.sequence += 1;
    const record: DiagnosticsLatencyRecord = {
      ...fields,
      sequence: this.sequence,
      kind,
      atMs: nowMs(),
    };
    if (this.records.length >= this.capacity) {
      this.records.shift();
      this.dropped += 1;
    }
    this.records.push(record);
  }

  beginOpen(requestId: string, path: string): void {
    if (!this.enabled || !requestId) return;
    this.openTraces.set(requestId, { startedAtMs: nowMs(), path });
    this.record('open_stage', {
      requestId,
      path,
      stage: 'host_intent',
      totalMs: 0,
    });
  }

  recordOpenStage(
    requestId: string,
    stage: string,
    fields: DiagnosticsLatencyFields = {},
  ): void {
    if (!this.enabled || !requestId) return;
    const trace = this.openTraces.get(requestId);
    this.record('open_stage', {
      requestId,
      path: trace?.path,
      stage,
      totalMs: trace ? nowMs() - trace.startedAtMs : undefined,
      ...fields,
    });
  }

  finishOpen(
    requestId: string,
    stage: string,
    fields: DiagnosticsLatencyFields = {},
  ): void {
    this.recordOpenStage(requestId, stage, fields);
    this.openTraces.delete(requestId);
  }

  snapshot(): DiagnosticsLatencySnapshot {
    return {
      enabled: this.enabled,
      capacity: this.capacity,
      dropped: this.dropped,
      records: this.records.map((record) => ({ ...record })),
    };
  }
}

const diagnosticsLatencyProbe = new DiagnosticsLatencyProbe();

export function installDiagnosticsLatencyProbe(): DiagnosticsLatencyProbeApi {
  const api: DiagnosticsLatencyProbeApi = {
    start: () => diagnosticsLatencyProbe.start(),
    snapshot: () => diagnosticsLatencyProbe.snapshot(),
    stop: () => diagnosticsLatencyProbe.stop(),
    clear: () => diagnosticsLatencyProbe.clear(),
  };
  window.__te2DiagnosticsOpenProbe = api;
  return api;
}

export function diagnosticsLatencyProbeEnabled(): boolean {
  return diagnosticsLatencyProbe.isEnabled();
}

export function recordDiagnosticsLatency(
  kind: string,
  fields: DiagnosticsLatencyFields = {},
): void {
  diagnosticsLatencyProbe.record(kind, fields);
}

export function beginDiagnosticsOpenTrace(requestId: string, path: string): void {
  diagnosticsLatencyProbe.beginOpen(requestId, path);
}

export function recordDiagnosticsOpenStage(
  requestId: string,
  stage: string,
  fields: DiagnosticsLatencyFields = {},
): void {
  diagnosticsLatencyProbe.recordOpenStage(requestId, stage, fields);
}

export function finishDiagnosticsOpenTrace(
  requestId: string,
  stage: string,
  fields: DiagnosticsLatencyFields = {},
): void {
  diagnosticsLatencyProbe.finishOpen(requestId, stage, fields);
}

export function measureDiagnosticsLatency<T>(
  kind: string,
  fields: DiagnosticsLatencyFields,
  operation: () => T,
): T {
  if (!diagnosticsLatencyProbe.isEnabled()) return operation();
  const startedAtMs = nowMs();
  try {
    return operation();
  } finally {
    diagnosticsLatencyProbe.record(kind, {
      ...fields,
      durationMs: nowMs() - startedAtMs,
    });
  }
}

export function diagnosticsPayloadStats(
  payload: Record<string, unknown>,
): { files: number; markers: number } {
  const values = Object.values(payload);
  let markers = 0;
  for (const value of values) {
    if (Array.isArray(value)) markers += value.length;
  }
  return {
    files: values.length,
    markers,
  };
}

export function rpcWireByteLength(value: unknown): number | null {
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  return null;
}
