export function isCacheStatePayloadForCurrentPath(payload, currentPath) {
  if (!payload || !payload.path || !currentPath) return false;
  return String(payload.path) === String(currentPath);
}

export function isCacheStateClean(payload) {
  return !!(payload && payload.unsaved === false);
}

export function isCacheStateUnsaved(payload) {
  return !!(payload && payload.unsaved === true);
}
