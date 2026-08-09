export interface InlayHintsProviderRegisteredPayload {
  language?: string;
  handle?: unknown;
  supportsResolve?: unknown;
  displayName?: unknown;
  eventHandle?: unknown;
}

interface InlayHintsProviderRegistrationLike {
  handle: string;
  supportsResolve: boolean;
  displayName?: string | null;
  eventHandle?: number | null;
}

function asInlayHintsProviderRegisteredPayload(value: unknown): InlayHintsProviderRegisteredPayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as InlayHintsProviderRegisteredPayload
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function handleInlayHintsProviderRegistered(
  data: unknown,
  cacheInlayHintsProviderRegistration: (lang: string, registration: InlayHintsProviderRegistrationLike) => void,
): void {
  const typedData = asInlayHintsProviderRegisteredPayload(data);
  const lang = typeof typedData?.language === 'string' ? typedData.language : '';
  const handle = typedData?.handle;
  if (!lang || handle == null) return;
  const handleKey = String(handle).trim();
  if (!handleKey) return;

  cacheInlayHintsProviderRegistration(lang, {
    handle: handleKey,
    supportsResolve: typedData?.supportsResolve === true,
    displayName: stringOrNull(typedData?.displayName),
    eventHandle: numberOrNull(typedData?.eventHandle),
  });
}
