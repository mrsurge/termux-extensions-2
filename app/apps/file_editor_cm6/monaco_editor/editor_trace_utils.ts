interface TraceLike {
  unsaved_reason: string;
  gb_req_total: number;
  gb_req_immediate: number;
  gb_req_debounced: number;
  gb_last_source: string;
}

export function setUnsavedTrace(
  trace: TraceLike,
  reason: string | null | undefined,
  unsaved: boolean,
  onSync: () => void,
): void {
  try {
    const resolvedReason = reason != null ? String(reason) : '-';
    trace.unsaved_reason = resolvedReason + ':' + (unsaved ? '1' : '0');
    onSync();
  } catch (_) {}
}

export function noteGitBaselineRequest(
  trace: TraceLike,
  source: string | null | undefined,
  immediate: boolean,
  onSync: () => void,
): void {
  try {
    const resolvedSource = source != null ? String(source) : 'unknown';
    trace.gb_req_total += 1;
    if (immediate) trace.gb_req_immediate += 1;
    else trace.gb_req_debounced += 1;
    trace.gb_last_source = resolvedSource + (immediate ? ':imm' : ':deb');
    onSync();
  } catch (_) {}
}
