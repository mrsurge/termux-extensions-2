type TraceValue = string | number | boolean | null;
type TraceFields = Record<string, TraceValue>;

interface TraceEvent {
  phase: string;
  at: number;
  fields: TraceFields;
}

const MAX_EVENTS = 64;
const MAX_PENDING = 24;
let enabled: boolean | null = null;
let logged = 0;
const pending: TraceEvent[] = [];

// The backend's selected-theme reply decides whether pre-reply boot milestones
// are published. Keep the pre-decision buffer small and never retain text.
export function configureColdBootTrace(runtimeDebug: unknown): void {
  enabled = runtimeDebug === true;
  if (enabled) {
    for (const event of pending) emit(event);
  }
  pending.length = 0;
}

function emit(event: TraceEvent): void {
  if (logged >= MAX_EVENTS) return;
  logged += 1;
  console.info('[cold_boot_trace]', event);
}

export function traceColdBoot(phase: string, fields: TraceFields): void {
  if (enabled === false || logged >= MAX_EVENTS) return;
  const event: TraceEvent = { phase, at: Date.now(), fields };
  if (enabled === true) {
    emit(event);
  } else if (pending.length < MAX_PENDING) {
    pending.push(event);
  }
}

export function firstInvalidFullSemanticToken(
  data: Uint32Array,
  lineCount: number,
  getLineLength: (lineNumber: number) => number,
): { line: number; start: number; end: number; lineLength: number } | null {
  let line = 0;
  let start = 0;
  const count = Math.min(Math.floor(data.length / 5), 50_000);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 5;
    const deltaLine = data[offset];
    line += deltaLine;
    start = deltaLine === 0 ? start + data[offset + 1] : data[offset + 1];
    const end = start + data[offset + 2];
    const lineLength = line < lineCount ? getLineLength(line + 1) : -1;
    if (lineLength < 0 || end > lineLength) {
      return { line: line + 1, start, end, lineLength };
    }
  }
  return null;
}

export function coldBootTraceEnabled(): boolean {
  return enabled === true && logged < MAX_EVENTS;
}
