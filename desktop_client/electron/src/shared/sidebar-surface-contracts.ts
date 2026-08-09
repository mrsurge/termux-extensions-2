import {
  ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION,
  type ElectronSidebarSurfaceAction,
  type ElectronSidebarSurfaceDescriptor,
  type ElectronSidebarSurfaceDetachRequest,
  type ElectronSidebarSurfaceReconcileRequest,
  type ElectronSidebarSurfaceReference,
} from "./app-view-contracts";

const MAX_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 512;
const MAX_PATH_LENGTH = 4096;
const MAX_URL_LENGTH = 8192;
const MAX_WINDOW_NAME_LENGTH = 8192;
const MAX_RECONCILE_SURFACES = 256;
const APP_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const WINDOW_NAME_PREFIXES = ["te2-devtools:", "te2-run-profile:"];
const SURFACE_ACTIONS = new Set<ElectronSidebarSurfaceAction>([
  "attach",
  "console",
  "devtools",
  "refresh",
  "stop",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
  required = false,
): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) throw new TypeError(`${label} is required`);
  if (normalized.length > maxLength) throw new TypeError(`${label} is too long`);
  return normalized;
}

function strictBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function httpUrl(value: unknown): string {
  const normalized = boundedString(value, "Sidebar surface URL", MAX_URL_LENGTH, true);
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Sidebar surface URL must use HTTP or HTTPS");
  }
  return parsed.href;
}

function windowName(value: unknown): string {
  const normalized = boundedString(
    value,
    "Sidebar surface window name",
    MAX_WINDOW_NAME_LENGTH,
  );
  if (
    normalized &&
    !WINDOW_NAME_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    throw new TypeError("Sidebar surface window name is not a TE2 marker");
  }
  return normalized;
}

export function validateElectronSidebarSurfaceDescriptor(
  value: unknown,
): ElectronSidebarSurfaceDescriptor {
  const raw = record(value, "Sidebar surface descriptor");
  if (raw.version !== ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION) {
    throw new TypeError("Unsupported Sidebar surface descriptor version");
  }
  const appId = boundedString(raw.appId, "Sidebar surface app id", MAX_ID_LENGTH);
  if (appId && !APP_ID_PATTERN.test(appId)) {
    throw new TypeError("Sidebar surface app id is invalid");
  }
  return {
    version: ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION,
    hostId: boundedString(raw.hostId, "Sidebar surface host id", MAX_ID_LENGTH, true),
    surfaceId: boundedString(
      raw.surfaceId,
      "Sidebar surface id",
      MAX_ID_LENGTH,
      true,
    ),
    presentationId: boundedString(
      raw.presentationId,
      "Sidebar surface presentation id",
      MAX_ID_LENGTH,
      true,
    ),
    label: boundedString(raw.label, "Sidebar surface label", MAX_LABEL_LENGTH, true),
    url: httpUrl(raw.url),
    windowName: windowName(raw.windowName),
    appId,
    projectPath: boundedString(
      raw.projectPath,
      "Sidebar surface project path",
      MAX_PATH_LENGTH,
    ),
    profileId: boundedString(raw.profileId, "Sidebar surface profile id", MAX_ID_LENGTH),
    shellId: boundedString(raw.shellId, "Sidebar surface shell id", MAX_ID_LENGTH),
    devRuntime: strictBoolean(raw.devRuntime, "Sidebar surface devRuntime"),
    devTools: strictBoolean(raw.devTools, "Sidebar surface devTools"),
    consoleWorkerId: boundedString(
      raw.consoleWorkerId,
      "Sidebar surface console worker id",
      MAX_ID_LENGTH,
    ),
  };
}

export function validateElectronSidebarSurfaceDetachRequest(
  value: unknown,
): ElectronSidebarSurfaceDetachRequest {
  const raw = record(value, "Sidebar surface detach request");
  return {
    descriptor: validateElectronSidebarSurfaceDescriptor(raw.descriptor),
    focus: strictBoolean(raw.focus, "Sidebar surface focus"),
  };
}

export function validateElectronSidebarSurfaceReference(
  value: unknown,
): ElectronSidebarSurfaceReference {
  const raw = record(value, "Sidebar surface reference");
  const presentationId = raw.presentationId === undefined
    ? undefined
    : boundedString(
      raw.presentationId,
      "Sidebar surface presentation id",
      MAX_ID_LENGTH,
    );
  return {
    surfaceId: boundedString(raw.surfaceId, "Sidebar surface id", MAX_ID_LENGTH, true),
    ...(presentationId ? { presentationId } : {}),
  };
}

export function validateElectronSidebarSurfaceReconcileRequest(
  value: unknown,
): ElectronSidebarSurfaceReconcileRequest {
  const raw = record(value, "Sidebar surface reconcile request");
  if (!Array.isArray(raw.surfaceIds)) {
    throw new TypeError("Sidebar surface ids must be an array");
  }
  const surfaceIds: string[] = [];
  const seen = new Set<string>();
  for (const item of raw.surfaceIds) {
    const id = boundedString(item, "Sidebar surface id", MAX_ID_LENGTH, true);
    if (seen.has(id)) continue;
    surfaceIds.push(id);
    seen.add(id);
    if (surfaceIds.length > MAX_RECONCILE_SURFACES) {
      throw new TypeError("Too many Sidebar surfaces");
    }
  }
  return { surfaceIds };
}

export function validateElectronSidebarSurfaceAction(
  value: unknown,
): ElectronSidebarSurfaceAction {
  if (typeof value === "string" && SURFACE_ACTIONS.has(value as ElectronSidebarSurfaceAction)) {
    return value as ElectronSidebarSurfaceAction;
  }
  throw new TypeError("Unsupported Sidebar surface action");
}
