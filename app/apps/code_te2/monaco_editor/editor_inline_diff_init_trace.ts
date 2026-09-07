interface InlineDiffInitTraceEntry {
  at: number;
  stage: string;
  detail: Record<string, unknown>;
}

type TraceWindow = Window & {
  __te2InlineDiffInitTrace?: InlineDiffInitTraceEntry[];
};

// Console telemetry is volatile; keep cold-start evidence before it connects.
export function traceInlineDiffInit(stage: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const win = window as TraceWindow;
  const entries = win.__te2InlineDiffInitTrace ??= [];
  entries.push({ at: Date.now(), stage, detail });
  if (entries.length > 64) entries.splice(0, entries.length - 64);
  console.log('[InlineDiffInit]', stage, detail);
}
