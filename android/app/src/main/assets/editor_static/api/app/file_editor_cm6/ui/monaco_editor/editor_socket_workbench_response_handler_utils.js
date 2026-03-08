export function handleWorkbenchResponseEvent(data, wbPending, clearTimeoutFn) {
  var rid = data && data.request_id;
  var entry = wbPending.get(rid);
  if (!entry) return;
  wbPending.delete(rid);
  clearTimeoutFn(entry.timer);
  if (data && data.error) entry.reject(new Error(String(data.error)));
  else entry.resolve((data && data.result) || data);
}
