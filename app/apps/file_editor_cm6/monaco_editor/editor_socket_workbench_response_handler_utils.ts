interface WorkbenchPendingEntry {
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface WorkbenchResponsePayload {
  request_id?: string;
  error?: unknown;
  result?: unknown;
}

function asWorkbenchResponsePayload(value: unknown): WorkbenchResponsePayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as WorkbenchResponsePayload
    : null;
}

export function handleWorkbenchResponseEvent(
  data: unknown,
  wbPending: Map<string, WorkbenchPendingEntry>,
  clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void,
): void {
  const typedData = asWorkbenchResponsePayload(data);
  const requestId = typedData?.request_id;
  if (!requestId) return;
  const entry = wbPending.get(requestId);
  if (!entry) return;
  wbPending.delete(requestId);
  clearTimeoutFn(entry.timer);
  if (typedData && typedData.error) entry.reject(new Error(String(typedData.error)));
  else entry.resolve(typedData?.result ?? typedData);
}
