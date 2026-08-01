import type { SidebarShortcut } from "./types.ts";

export const DEVTOOLS_TARGET_WINDOW_NAME_PREFIX = "te2-devtools:";

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function devToolsTargetWindowName(sc: SidebarShortcut): string {
  const enabled = sc.dev_tools === true || sc.devTools === true;
  const targetId = normalized(sc.devtools_target_id || sc.devToolsTargetId);
  if (!enabled || !targetId) return "";
  const targetLabel =
    normalized(sc.devtools_target_label || sc.devToolsTargetLabel) || sc.label;
  return `${DEVTOOLS_TARGET_WINDOW_NAME_PREFIX}${encodeURIComponent(
    JSON.stringify({ targetId, targetLabel }),
  )}`;
}

export function configureDevToolsTargetNavigation(
  iframe: HTMLIFrameElement,
  sc: SidebarShortcut,
  initialUrl = "",
): string {
  const marker = devToolsTargetWindowName(sc);
  if (marker) iframe.name = marker;
  else iframe.removeAttribute("name");
  if (initialUrl) iframe.src = initialUrl;
  return marker;
}

export function shouldRecreateDevToolsTargetFrame(
  loadedMarker: string,
  loaded: boolean,
  sc: SidebarShortcut,
): boolean {
  return loaded && loadedMarker !== devToolsTargetWindowName(sc);
}
