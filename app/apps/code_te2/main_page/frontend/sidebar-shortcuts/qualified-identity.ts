export interface SidebarWindowIdentity {
  mainPageId: string;
  sidebarStateId: string;
  sidebarWindowId: string;
}

export function readSidebarWindowIdentity(result: Record<string, unknown>): SidebarWindowIdentity {
  const { mainPageId, sidebarStateId, sidebarWindowId } = result;
  if (typeof mainPageId !== 'string' || !/^[A-Za-z0-9]{4}$/.test(mainPageId)
      || typeof sidebarStateId !== 'string' || !/^[A-Za-z0-9]{4}$/.test(sidebarStateId)
      || typeof sidebarWindowId !== 'string'
      || !/^[A-Za-z0-9_-]+:[A-Za-z0-9]{4}\.[A-Za-z0-9]{4}$/.test(sidebarWindowId)
      || !sidebarWindowId.endsWith(`:${sidebarStateId}.${mainPageId}`)) {
    throw new Error('Backend did not register a qualified sidebar window identity');
  }
  return { mainPageId, sidebarStateId, sidebarWindowId };
}

/** Applied only to the local presentation URL, never the shared restore URL. */
export function applySidebarWindowIdentity(url: URL, identity: SidebarWindowIdentity): void {
  for (const [key, value] of Object.entries<string>({ ...readSidebarWindowIdentity({ ...identity }) })) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('te2_console_worker_id', identity.sidebarWindowId);
}
