import type { SidebarAppDockSlot } from "./types.ts";
import {
  isAndroidNativePage,
  readAndroidSidebarPresentationState,
  writeAndroidSidebarPresentationState,
} from "../native-client-bridge.ts";

export const SIDEBAR_PRESENTATION_STATE_VERSION = 1 as const;
export const SIDEBAR_PRESENTATION_STORAGE_KEY =
  "te2.sidebar.presentation.v2";
const LEGACY_SIDEBAR_PRESENTATION_STORAGE_KEY =
  "te2.sidebar.presentation.v1";
const SIDEBAR_PRESENTATION_STORE_VERSION = 2 as const;
const MAX_PRESENTATION_PROJECTS = 32;

export type SidebarPresentationMode = "embedded" | "hidden" | "detached";

export interface SidebarClientPresentationState {
  version: typeof SIDEBAR_PRESENTATION_STATE_VERSION;
  order: string[];
  foregroundHostId: string;
  lastAgentHostId: string;
  lastAgentPresentationId: string;
  presentations: Record<string, SidebarPresentationMode>;
}

export interface SidebarMentionTarget {
  clientId: string;
  hostId: string;
  presentationId: string;
}

interface ElectronPresentationBridge {
  readSidebarPresentationState?: (projectPath: string) => Promise<unknown>;
  writeSidebarPresentationState?: (
    projectPath: string,
    state: SidebarClientPresentationState,
  ) => Promise<unknown>;
}

interface AndroidPresentationBridge {
  readSidebarPresentationState?: (
    projectPath: string,
    clientInstanceId: string,
  ) => Promise<{ found: boolean; state?: unknown }>;
  writeSidebarPresentationState?: (
    projectPath: string,
    clientInstanceId: string,
    state: SidebarClientPresentationState,
  ) => Promise<unknown>;
}

interface PresentationWindow {
  localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  location?: Pick<Location, "origin" | "search">;
  te2Electron?: ElectronPresentationBridge;
  te2AndroidPresentation?: AndroidPresentationBridge;
}

interface SidebarPresentationProjectStore {
  version: typeof SIDEBAR_PRESENTATION_STORE_VERSION;
  projects: Record<
    string,
    { updatedAt: number; state: SidebarClientPresentationState }
  >;
}

const PRESENTATION_MODES = new Set<SidebarPresentationMode>([
  "embedded",
  "hidden",
  "detached",
]);
const MAX_PRESENTATION_IDS = 256;
const MAX_ID_LENGTH = 512;
const LEGACY_CODE_TE2_IDENTITY =
  /(^|[^A-Za-z0-9_])file_editor_cm6(?=$|[^A-Za-z0-9_])/g;

function canonicalizeCodeTe2Identity(value: string): string {
  return value.replace(
    LEGACY_CODE_TE2_IDENTITY,
    (_match, prefix: string) => `${prefix}code_te2`,
  );
}

function containsLegacyCodeTe2Identity(value: unknown): boolean {
  if (typeof value === "string") {
    LEGACY_CODE_TE2_IDENTITY.lastIndex = 0;
    return LEGACY_CODE_TE2_IDENTITY.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsLegacyCodeTe2Identity);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        containsLegacyCodeTe2Identity(key) ||
        containsLegacyCodeTe2Identity(item),
    );
  }
  return false;
}

function normalizeId(value: unknown): string {
  return typeof value === "string"
    ? canonicalizeCodeTe2Identity(value.trim()).slice(0, MAX_ID_LENGTH)
    : "";
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = normalizeId(item);
    if (!id || seen.has(id)) continue;
    result.push(id);
    seen.add(id);
    if (result.length >= MAX_PRESENTATION_IDS) break;
  }
  return result;
}

function normalizeMode(value: unknown): SidebarPresentationMode | null {
  return typeof value === "string" &&
    PRESENTATION_MODES.has(value as SidebarPresentationMode)
    ? (value as SidebarPresentationMode)
    : null;
}

export function emptySidebarPresentationState(): SidebarClientPresentationState {
  return {
    version: SIDEBAR_PRESENTATION_STATE_VERSION,
    order: [],
    foregroundHostId: "",
    lastAgentHostId: "",
    lastAgentPresentationId: "",
    presentations: {},
  };
}

export function normalizeSidebarPresentationState(
  value: unknown,
): SidebarClientPresentationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySidebarPresentationState();
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== SIDEBAR_PRESENTATION_STATE_VERSION) {
    return emptySidebarPresentationState();
  }
  const order = uniqueIds(raw.order);
  const rawPresentations =
    raw.presentations &&
    typeof raw.presentations === "object" &&
    !Array.isArray(raw.presentations)
      ? (raw.presentations as Record<string, unknown>)
      : {};
  const presentations: Record<string, SidebarPresentationMode> = {};
  const presentationEntries = Object.entries(rawPresentations).sort(
    ([left], [right]) =>
      Number(containsLegacyCodeTe2Identity(left)) -
      Number(containsLegacyCodeTe2Identity(right)),
  );
  for (const [rawId, rawMode] of presentationEntries) {
    const id = normalizeId(rawId);
    const mode = normalizeMode(rawMode);
    if (!id || !mode || Object.keys(presentations).length >= MAX_PRESENTATION_IDS) {
      continue;
    }
    if (id in presentations && containsLegacyCodeTe2Identity(rawId)) continue;
    presentations[id] = mode;
  }
  return {
    version: SIDEBAR_PRESENTATION_STATE_VERSION,
    order,
    foregroundHostId: normalizeId(raw.foregroundHostId),
    lastAgentHostId: normalizeId(raw.lastAgentHostId),
    lastAgentPresentationId: normalizeId(raw.lastAgentPresentationId),
    presentations,
  };
}

function chooseForegroundFallback(
  previous: SidebarClientPresentationState,
  order: string[],
  authoritativeIds: ReadonlySet<string>,
): string {
  if (authoritativeIds.has(previous.foregroundHostId)) {
    return previous.foregroundHostId;
  }
  const removedIndex = previous.order.indexOf(previous.foregroundHostId);
  if (removedIndex >= 0) {
    for (let index = removedIndex + 1; index < previous.order.length; index += 1) {
      const candidate = previous.order[index];
      if (authoritativeIds.has(candidate)) return candidate;
    }
    for (let index = removedIndex - 1; index >= 0; index -= 1) {
      const candidate = previous.order[index];
      if (authoritativeIds.has(candidate)) return candidate;
    }
  }
  if (authoritativeIds.has(previous.lastAgentHostId)) {
    return previous.lastAgentHostId;
  }
  return order[0] || "";
}

export function reconcileSidebarPresentationState(
  value: unknown,
  authoritativeHostIds: readonly string[],
  options: { authoritative?: boolean } = {},
): SidebarClientPresentationState {
  const previous = normalizeSidebarPresentationState(value);
  if (options.authoritative === false) return previous;
  const canonicalIds = uniqueIds(authoritativeHostIds).sort((left, right) =>
    left.localeCompare(right),
  );
  const authoritativeIds = new Set(canonicalIds);
  const survivingOrder = previous.order.filter((id) => authoritativeIds.has(id));
  const survivingIds = new Set(survivingOrder);
  const order = [
    ...survivingOrder,
    ...canonicalIds.filter((id) => !survivingIds.has(id)),
  ];
  const foregroundHostId = chooseForegroundFallback(
    previous,
    order,
    authoritativeIds,
  );
  const lastAgentHostId = authoritativeIds.has(previous.lastAgentHostId)
    ? previous.lastAgentHostId
    : "";
  const presentations: Record<string, SidebarPresentationMode> = {};
  for (const id of order) {
    presentations[id] = previous.presentations[id] || "embedded";
  }
  return {
    version: SIDEBAR_PRESENTATION_STATE_VERSION,
    order,
    foregroundHostId,
    lastAgentHostId,
    lastAgentPresentationId: lastAgentHostId
      ? previous.lastAgentPresentationId
      : "",
    presentations,
  };
}

export function reorderSidebarPresentationState(
  value: unknown,
  requestedOrder: readonly string[],
): SidebarClientPresentationState {
  const previous = normalizeSidebarPresentationState(value);
  const existingIds = new Set(previous.order);
  const requested = uniqueIds(requestedOrder).filter((id) =>
    existingIds.has(id),
  );
  const seen = new Set(requested);
  return {
    ...previous,
    order: [
      ...requested,
      ...previous.order.filter((id) => !seen.has(id)),
    ],
  };
}

export function activateSidebarPresentation(
  value: unknown,
  hostId: string,
  options: {
    agent?: boolean;
    presentationId?: string;
    revealHidden?: boolean;
  } = {},
): SidebarClientPresentationState {
  const previous = normalizeSidebarPresentationState(value);
  const normalizedHostId = normalizeId(hostId);
  if (!normalizedHostId || !previous.order.includes(normalizedHostId)) {
    return previous;
  }
  const presentationId = normalizeId(options.presentationId);
  const presentations =
    options.revealHidden === true && previous.presentations[normalizedHostId] === "hidden"
      ? { ...previous.presentations, [normalizedHostId]: "embedded" as const }
      : previous.presentations;
  return {
    ...previous,
    presentations,
    foregroundHostId: normalizedHostId,
    lastAgentHostId: options.agent
      ? normalizedHostId
      : previous.lastAgentHostId,
    lastAgentPresentationId: options.agent
      ? presentationId
      : previous.lastAgentPresentationId,
  };
}

export function clearSidebarPresentationForeground(
  value: unknown,
): SidebarClientPresentationState {
  return {
    ...normalizeSidebarPresentationState(value),
    foregroundHostId: "",
  };
}

export function setSidebarPresentationMode(
  value: unknown,
  hostId: string,
  mode: SidebarPresentationMode,
): SidebarClientPresentationState {
  const previous = normalizeSidebarPresentationState(value);
  const normalizedHostId = normalizeId(hostId);
  const normalizedMode = normalizeMode(mode);
  if (
    !normalizedHostId ||
    !normalizedMode ||
    !previous.order.includes(normalizedHostId)
  ) {
    return previous;
  }
  return {
    ...previous,
    presentations: {
      ...previous.presentations,
      [normalizedHostId]: normalizedMode,
    },
  };
}

export function bindSidebarAgentPresentation(
  value: unknown,
  hostId: string,
  presentationId: string,
): SidebarClientPresentationState {
  const previous = normalizeSidebarPresentationState(value);
  const normalizedHostId = normalizeId(hostId);
  if (!normalizedHostId || previous.lastAgentHostId !== normalizedHostId) {
    return previous;
  }
  return {
    ...previous,
    lastAgentPresentationId: normalizeId(presentationId),
  };
}

export function resolveSidebarMentionTarget(
  value: unknown,
  clientId: string,
  agentHostIds: readonly string[],
  presentationIds: Readonly<Record<string, string>>,
): SidebarMentionTarget | null {
  const state = normalizeSidebarPresentationState(value);
  const normalizedClientId = normalizeId(clientId);
  const agents = new Set(uniqueIds(agentHostIds));
  const hostId = agents.has(state.lastAgentHostId)
    ? state.lastAgentHostId
    : agents.has(state.foregroundHostId)
      ? state.foregroundHostId
      : "";
  if (!normalizedClientId || !hostId || !state.order.includes(hostId)) {
    return null;
  }
  const currentPresentationId = normalizeId(presentationIds[hostId]);
  const presentationId =
    hostId === state.lastAgentHostId
      ? normalizeId(state.lastAgentPresentationId) || currentPresentationId
      : currentPresentationId;
  if (!presentationId) return null;
  return {
    clientId: normalizedClientId,
    hostId,
    presentationId,
  };
}

export function sidebarPresentationStatesEqual(
  left: SidebarClientPresentationState,
  right: SidebarClientPresentationState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function durableSidebarPresentationState(
  value: unknown,
): SidebarClientPresentationState {
  return {
    ...normalizeSidebarPresentationState(value),
    lastAgentPresentationId: "",
  };
}

function normalizedProjectPath(value: unknown): string {
  const projectPath = normalizeId(value);
  if (!projectPath) return "";
  return projectPath === "/" ? projectPath : projectPath.replace(/\/+$/, "");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sidebarSlotProjectPath(slot: SidebarAppDockSlot): string {
  const direct = normalizedProjectPath(slot.projectPath || slot.project_path);
  if (direct) return direct;
  const webview = objectValue(slot.webviewSurface || slot.webview_surface);
  const webviewProject = normalizedProjectPath(
    webview.projectPath || webview.project_path,
  );
  if (webviewProject) return webviewProject;
  const runProfile = objectValue(
    slot.runProfileSurface || slot.run_profile_surface,
  );
  return normalizedProjectPath(
    runProfile.projectPath || runProfile.project_path,
  );
}

export function projectSidebarDockSlots(
  slots: readonly SidebarAppDockSlot[],
  projectPath: string,
): SidebarAppDockSlot[] {
  const activeProject = normalizedProjectPath(projectPath);
  return slots.filter((slot) => {
    const slotProject = sidebarSlotProjectPath(slot);
    return !slotProject || (!!activeProject && slotProject === activeProject);
  });
}

function selectedFrameworkOrigin(runtimeWindow: PresentationWindow): string {
  const search = runtimeWindow.location?.search || "";
  try {
    const configured = new URLSearchParams(search).get("te2_framework_origin");
    if (configured) {
      const parsed = new URL(configured);
      if (/^https?:$/.test(parsed.protocol)) return parsed.origin;
    }
  } catch {}
  return runtimeWindow.location?.origin || "browser";
}

function projectStorageKey(
  projectPath: string,
  runtimeWindow: PresentationWindow,
): string {
  return `${selectedFrameworkOrigin(runtimeWindow)}\u0000${normalizedProjectPath(projectPath)}`;
}

function androidPresentationBridge(
  runtimeWindow: PresentationWindow,
): AndroidPresentationBridge | null {
  if (runtimeWindow.te2AndroidPresentation) {
    return runtimeWindow.te2AndroidPresentation;
  }
  if (
    typeof window !== "undefined" &&
    runtimeWindow === window &&
    isAndroidNativePage()
  ) {
    return {
      readSidebarPresentationState: readAndroidSidebarPresentationState,
      writeSidebarPresentationState: writeAndroidSidebarPresentationState,
    };
  }
  return null;
}

function emptyPresentationProjectStore(): SidebarPresentationProjectStore {
  return { version: SIDEBAR_PRESENTATION_STORE_VERSION, projects: {} };
}

function normalizePresentationProjectStore(
  value: unknown,
): SidebarPresentationProjectStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyPresentationProjectStore();
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== SIDEBAR_PRESENTATION_STORE_VERSION
    || !raw.projects
    || typeof raw.projects !== "object"
    || Array.isArray(raw.projects)
  ) {
    return emptyPresentationProjectStore();
  }
  const entries = Object.entries(raw.projects as Record<string, unknown>)
    .map(([key, value]) => {
      if (!key || key.length > 2048 || !value || typeof value !== "object") {
        return null;
      }
      const record = value as Record<string, unknown>;
      return [
        key,
        {
          updatedAt: Number.isFinite(Number(record.updatedAt))
            ? Number(record.updatedAt)
            : 0,
          state: durableSidebarPresentationState(record.state),
        },
      ] as const;
    })
    .filter((entry): entry is readonly [string, {
      updatedAt: number;
      state: SidebarClientPresentationState;
    }] => entry !== null)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    .slice(-MAX_PRESENTATION_PROJECTS);
  return {
    version: SIDEBAR_PRESENTATION_STORE_VERSION,
    projects: Object.fromEntries(entries),
  };
}

async function loadBrowserSidebarPresentationState(
  projectPath: string,
  runtimeWindow: PresentationWindow,
): Promise<SidebarClientPresentationState> {
  const normalizedProject = normalizedProjectPath(projectPath);
  if (!normalizedProject) return emptySidebarPresentationState();
  const raw = runtimeWindow.localStorage?.getItem(
    SIDEBAR_PRESENTATION_STORAGE_KEY,
  );
  try {
    const store = normalizePresentationProjectStore(raw ? JSON.parse(raw) : null);
    const key = projectStorageKey(normalizedProject, runtimeWindow);
    if (store.projects[key]) {
      const persisted = store.projects[key].state;
      try {
        await saveBrowserSidebarPresentationState(
          persisted,
          normalizedProject,
          runtimeWindow,
        );
      } catch {}
      return persisted;
    }
    const legacyRaw = runtimeWindow.localStorage?.getItem(
      LEGACY_SIDEBAR_PRESENTATION_STORAGE_KEY,
    );
    if (legacyRaw) {
      const legacy = durableSidebarPresentationState(JSON.parse(legacyRaw));
      await saveBrowserSidebarPresentationState(
        legacy,
        normalizedProject,
        runtimeWindow,
      );
      runtimeWindow.localStorage?.removeItem(
        LEGACY_SIDEBAR_PRESENTATION_STORAGE_KEY,
      );
      return legacy;
    }
    return emptySidebarPresentationState();
  } catch {
    return emptySidebarPresentationState();
  }
}

async function saveBrowserSidebarPresentationState(
  state: SidebarClientPresentationState,
  projectPath: string,
  runtimeWindow: PresentationWindow,
): Promise<void> {
  const normalizedProject = normalizedProjectPath(projectPath);
  if (!normalizedProject) return;
  const normalized = durableSidebarPresentationState(state);
  let store = emptyPresentationProjectStore();
  const raw = runtimeWindow.localStorage?.getItem(SIDEBAR_PRESENTATION_STORAGE_KEY);
  try {
    store = normalizePresentationProjectStore(raw ? JSON.parse(raw) : null);
  } catch {}
  const key = projectStorageKey(normalizedProject, runtimeWindow);
  delete store.projects[key];
  store.projects[key] = { updatedAt: Date.now(), state: normalized };
  const retained = Object.entries(store.projects)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    .slice(-MAX_PRESENTATION_PROJECTS);
  store.projects = Object.fromEntries(retained);
  runtimeWindow.localStorage?.setItem(
    SIDEBAR_PRESENTATION_STORAGE_KEY,
    JSON.stringify(store),
  );
}

function hasDurablePresentationState(
  state: SidebarClientPresentationState,
): boolean {
  return (
    state.order.length > 0 ||
    Object.keys(state.presentations).length > 0 ||
    !!state.foregroundHostId ||
    !!state.lastAgentHostId
  );
}

export async function loadSidebarPresentationState(
  projectPath: string,
  runtimeWindow: PresentationWindow = window,
  clientInstanceId = "",
): Promise<SidebarClientPresentationState> {
  const normalizedProject = normalizedProjectPath(projectPath);
  if (!normalizedProject) return emptySidebarPresentationState();
  const electronReader = runtimeWindow.te2Electron?.readSidebarPresentationState;
  if (typeof electronReader === "function") {
    return durableSidebarPresentationState(await electronReader(normalizedProject));
  }
  const androidBridge = androidPresentationBridge(runtimeWindow);
  const androidReader = androidBridge?.readSidebarPresentationState;
  if (typeof androidReader === "function" && clientInstanceId) {
    const loaded = await androidReader(normalizedProject, clientInstanceId);
    if (loaded.found) return durableSidebarPresentationState(loaded.state);
    const legacy = await loadBrowserSidebarPresentationState(
      normalizedProject,
      runtimeWindow,
    );
    if (hasDurablePresentationState(legacy)) {
      const writer = androidBridge?.writeSidebarPresentationState;
      if (typeof writer === "function") {
        await writer(normalizedProject, clientInstanceId, legacy);
      }
    }
    return legacy;
  }
  return loadBrowserSidebarPresentationState(normalizedProject, runtimeWindow);
}

export async function saveSidebarPresentationState(
  state: SidebarClientPresentationState,
  projectPath: string,
  runtimeWindow: PresentationWindow = window,
  clientInstanceId = "",
): Promise<void> {
  const normalizedProject = normalizedProjectPath(projectPath);
  if (!normalizedProject) return;
  const normalized = durableSidebarPresentationState(state);
  const electronWriter = runtimeWindow.te2Electron?.writeSidebarPresentationState;
  if (typeof electronWriter === "function") {
    await electronWriter(normalizedProject, normalized);
    return;
  }
  const androidWriter = androidPresentationBridge(runtimeWindow)
    ?.writeSidebarPresentationState;
  if (typeof androidWriter === "function" && clientInstanceId) {
    await androidWriter(normalizedProject, clientInstanceId, normalized);
    return;
  }
  await saveBrowserSidebarPresentationState(
    normalized,
    normalizedProject,
    runtimeWindow,
  );
}
