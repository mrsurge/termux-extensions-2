let pageClientId: string | null = null;

export function getPageClientId(windowRef: Window = window): string {
  if (pageClientId) return pageClientId;
  const randomUuid = windowRef.crypto?.randomUUID?.bind(windowRef.crypto);
  pageClientId = randomUuid
    ? `als_client_${randomUuid()}`
    : `als_client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return pageClientId;
}
