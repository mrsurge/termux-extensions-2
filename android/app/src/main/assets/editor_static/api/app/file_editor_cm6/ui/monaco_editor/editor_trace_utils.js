export function setUnsavedTrace(trace, reason, unsaved, onSync) {
  try {
    var r = reason != null ? String(reason) : '-';
    trace.unsaved_reason = r + ':' + (unsaved ? '1' : '0');
    onSync();
  } catch (_) {}
}

export function noteGitBaselineRequest(trace, source, immediate, onSync) {
  try {
    var src = source != null ? String(source) : 'unknown';
    trace.gb_req_total += 1;
    if (immediate) trace.gb_req_immediate += 1;
    else trace.gb_req_debounced += 1;
    trace.gb_last_source = src + (immediate ? ':imm' : ':deb');
    onSync();
  } catch (_) {}
}
