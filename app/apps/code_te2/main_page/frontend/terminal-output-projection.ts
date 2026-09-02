export interface TerminalOutputRecord {
  data: Uint8Array;
  startOffset: number;
  endOffset: number;
}

export type TerminalOutputReconciliation =
  | { kind: 'covered'; nextOffset: number }
  | { kind: 'write'; data: Uint8Array; nextOffset: number }
  | { kind: 'gap'; expectedOffset: number; receivedOffset: number };


export function coerceTerminalOffset(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}


export function coerceTerminalBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}


export function coerceTerminalOutput(value: unknown): TerminalOutputRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const data = coerceTerminalBytes(record.data);
  const startOffset = coerceTerminalOffset(record.start_offset);
  const endOffset = coerceTerminalOffset(record.end_offset);
  if (
    !data
    || startOffset === null
    || endOffset === null
    || endOffset < startOffset
    || endOffset - startOffset !== data.byteLength
  ) {
    return null;
  }
  return { data, startOffset, endOffset };
}


export function reconcileTerminalOutput(
  appliedOffset: number,
  record: TerminalOutputRecord,
): TerminalOutputReconciliation {
  if (record.endOffset <= appliedOffset) {
    return { kind: 'covered', nextOffset: appliedOffset };
  }
  if (record.startOffset > appliedOffset) {
    return {
      kind: 'gap',
      expectedOffset: appliedOffset,
      receivedOffset: record.startOffset,
    };
  }
  const consumed = Math.max(0, appliedOffset - record.startOffset);
  return {
    kind: 'write',
    data: consumed ? record.data.subarray(consumed) : record.data,
    nextOffset: record.endOffset,
  };
}
