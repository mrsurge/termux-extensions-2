interface TraceEvent {
  phase: string;
  sequence: number;
  unixMs: number;
  monoMs: number;
  [key: string]: unknown;
}

let enabled = false;
let sequence = 0;
const events: TraceEvent[] = [];

// Enabled only by a debug WBA's provider metadata, never by document content.
// Read through the existing browser console; no timer, network, or text capture.
export function configureCompletionTrace(active: boolean): void {
  enabled = active;
  if (!active) events.length = 0;
  if (typeof window !== "undefined") {
    const target = window as unknown as Record<string, unknown>;
    if (active) target.__te2CompletionTrace = {
      snapshot: () => ({ enabled, events: events.map(event => ({ ...event })) }),
      clear: () => { events.length = 0; },
    };
    else delete target.__te2CompletionTrace;
  }
}

export function traceCompletion(phase: string, fields: Record<string, unknown> = {}): number {
  if (!enabled) return 0;
  const id = ++sequence;
  events.push({ ...fields, phase, sequence: id, unixMs: Date.now(), monoMs: performance.now() });
  if (events.length > 128) events.shift();
  return id;
}
