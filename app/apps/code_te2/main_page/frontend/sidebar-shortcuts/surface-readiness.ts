import type { SidebarShortcut, SidebarAppDockSlot } from './types.ts';

/** Persisted membership never admits navigation without current backend proof. */
export function extensionSurfaceReady(
  shortcut: SidebarShortcut,
  slot: SidebarAppDockSlot | null,
): boolean {
  const surface = shortcut.webviewSurface || shortcut.webview_surface;
  if (surface?.dto !== 'ExtensionWebviewSurface') return true;
  const current = slot?.webviewSurface || slot?.webview_surface;
  return !!slot && current?.surfaceId === surface.surfaceId &&
    slot.url === shortcut.url && slot.readiness?.status === 'ready';
}
