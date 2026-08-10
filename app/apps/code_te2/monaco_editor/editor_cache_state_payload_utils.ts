import type { EditorCacheStatePayload } from './editor_save_mirror_contract.ts';

function asCacheStatePayload(value: unknown): EditorCacheStatePayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorCacheStatePayload
    : null;
}

export function isCacheStatePayloadForCurrentPath(
  payload: unknown,
  currentPath: string | null | undefined,
): payload is EditorCacheStatePayload {
  const typedPayload = asCacheStatePayload(payload);
  if (!typedPayload || !typedPayload.path || !currentPath) return false;
  return String(typedPayload.path) === String(currentPath);
}

export function isCacheStateClean(payload: unknown): payload is EditorCacheStatePayload {
  const typedPayload = asCacheStatePayload(payload);
  return !!(typedPayload && typedPayload.unsaved === false);
}

export function isCacheStateUnsaved(payload: unknown): payload is EditorCacheStatePayload {
  const typedPayload = asCacheStatePayload(payload);
  return !!(typedPayload && typedPayload.unsaved === true);
}
