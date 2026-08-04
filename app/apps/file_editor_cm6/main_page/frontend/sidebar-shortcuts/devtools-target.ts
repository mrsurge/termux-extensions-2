import type {
  RunProfileRuntimeMetadata,
  RunProfileSurfaceDescriptor,
  SidebarShortcut,
} from "./types.ts";

export const DEVTOOLS_TARGET_WINDOW_NAME_PREFIX = "te2-devtools:";
export const RUN_PROFILE_RUNTIME_WINDOW_NAME_PREFIX = "te2-run-profile:";

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function runProfileSurface(sc: SidebarShortcut): RunProfileSurfaceDescriptor | null {
  const candidate = sc.run_profile_surface || sc.runProfileSurface;
  return candidate && typeof candidate === "object"
    ? candidate as RunProfileSurfaceDescriptor
    : null;
}

function currentFrameworkOrigin(): string {
  try {
    return typeof window !== "undefined" ? window.location.origin : "";
  } catch (_) {
    return "";
  }
}

export function runProfileRuntimeMetadata(
  sc: SidebarShortcut,
  frameworkOrigin = currentFrameworkOrigin(),
): RunProfileRuntimeMetadata | null {
  const surface = runProfileSurface(sc);
  const devTools = sc.dev_tools === true || sc.devTools === true;
  const devRuntime = surface?.devRuntime === true;
  const configuredTargetId = normalized(
    sc.devtools_target_id || sc.devToolsTargetId,
  );
  const surfaceId = normalized(surface?.surfaceId) || configuredTargetId;
  if ((!devTools && !devRuntime) || !surfaceId) return null;
  const profileId = normalized(surface?.profileId);
  return {
    surfaceId,
    profileId,
    devRuntime,
    devTools,
    workerLabel: surfaceId,
    frameworkOrigin: normalized(frameworkOrigin),
  };
}

export function devToolsTargetWindowName(
  sc: SidebarShortcut,
  frameworkOrigin = currentFrameworkOrigin(),
): string {
  const runtime = runProfileRuntimeMetadata(sc, frameworkOrigin);
  if (!runtime) return "";
  const targetId = normalized(sc.devtools_target_id || sc.devToolsTargetId) ||
    runtime.surfaceId;
  const targetLabel =
    normalized(sc.devtools_target_label || sc.devToolsTargetLabel) || sc.label;
  const prefix = runtime.devTools
    ? DEVTOOLS_TARGET_WINDOW_NAME_PREFIX
    : RUN_PROFILE_RUNTIME_WINDOW_NAME_PREFIX;
  return `${prefix}${encodeURIComponent(
    JSON.stringify({ ...runtime, targetId, targetLabel }),
  )}`;
}

export function configureDevToolsTargetNavigation(
  iframe: HTMLIFrameElement,
  sc: SidebarShortcut,
  initialUrl = "",
): string {
  const marker = devToolsTargetWindowName(
    sc,
    iframe.ownerDocument.defaultView?.location.origin || "",
  );
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
