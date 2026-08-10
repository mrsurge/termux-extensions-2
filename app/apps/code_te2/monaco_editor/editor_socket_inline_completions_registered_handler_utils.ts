export interface InlineCompletionProviderRegisteredPayload {
  language?: string;
  handle?: unknown;
  supportsHandleEvents?: unknown;
  extensionId?: unknown;
  extensionVersion?: unknown;
  groupId?: unknown;
  yieldsToGroupIds?: unknown;
  excludesGroupIds?: unknown;
  displayName?: unknown;
  debounceDelayMs?: unknown;
  eventHandle?: unknown;
}

interface InlineCompletionProviderRegistrationLike {
  handle: string;
  supportsHandleEvents: boolean;
  extensionId?: string | null;
  extensionVersion?: string | null;
  groupId?: string | null;
  yieldsToGroupIds: string[];
  excludesGroupIds: string[];
  displayName?: string | null;
  debounceDelayMs?: number | null;
  eventHandle?: number | null;
}

function asInlineCompletionProviderRegisteredPayload(value: unknown): InlineCompletionProviderRegisteredPayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as InlineCompletionProviderRegisteredPayload
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function handleInlineCompletionProviderRegistered(
  data: unknown,
  cacheInlineCompletionProviderRegistration: (lang: string, registration: InlineCompletionProviderRegistrationLike) => void,
): void {
  const typedData = asInlineCompletionProviderRegisteredPayload(data);
  const lang = typeof typedData?.language === 'string' ? typedData.language : '';
  const handle = typedData?.handle;
  if (!lang || handle == null) return;
  const handleKey = String(handle).trim();
  if (!handleKey) return;

  cacheInlineCompletionProviderRegistration(lang, {
    handle: handleKey,
    supportsHandleEvents: typedData?.supportsHandleEvents === true,
    extensionId: stringOrNull(typedData?.extensionId),
    extensionVersion: stringOrNull(typedData?.extensionVersion),
    groupId: stringOrNull(typedData?.groupId),
    yieldsToGroupIds: Array.isArray(typedData?.yieldsToGroupIds) ? typedData!.yieldsToGroupIds.map(String).filter(Boolean) : [],
    excludesGroupIds: Array.isArray(typedData?.excludesGroupIds) ? typedData!.excludesGroupIds.map(String).filter(Boolean) : [],
    displayName: stringOrNull(typedData?.displayName),
    debounceDelayMs: numberOrNull(typedData?.debounceDelayMs),
    eventHandle: numberOrNull(typedData?.eventHandle),
  });
}
