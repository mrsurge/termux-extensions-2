export const SIDEBAR_PRESENTATION_STATE_VERSION = 1 as const;
export const SIDEBAR_PRESENTATION_STORAGE_KEY =
  "te2.sidebar.presentation.v1";

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
  readSidebarPresentationState?: () => Promise<unknown>;
  writeSidebarPresentationState?: (
    state: SidebarClientPresentationState,
  ) => Promise<unknown>;
}

interface PresentationWindow {
  localStorage?: Pick<Storage, "getItem" | "setItem">;
  te2Electron?: ElectronPresentationBridge;
}

const PRESENTATION_MODES = new Set<SidebarPresentationMode>([
  "embedded",
  "hidden",
  "detached",
]);
const MAX_PRESENTATION_IDS = 256;
const MAX_ID_LENGTH = 512;

function normalizeId(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_ID_LENGTH)
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
  for (const [rawId, rawMode] of Object.entries(rawPresentations)) {
    const id = normalizeId(rawId);
    const mode = normalizeMode(rawMode);
    if (!id || !mode || Object.keys(presentations).length >= MAX_PRESENTATION_IDS) {
      continue;
    }
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
): SidebarClientPresentationState {
  const previous = normalizeSidebarPresentationState(value);
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
  } = {},
): SidebarClientPresentationState {
  const previous = normalizeSidebarPresentationState(value);
  const normalizedHostId = normalizeId(hostId);
  if (!normalizedHostId || !previous.order.includes(normalizedHostId)) {
    return previous;
  }
  const presentationId = normalizeId(options.presentationId);
  return {
    ...previous,
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

export async function loadSidebarPresentationState(
  runtimeWindow: PresentationWindow = window,
): Promise<SidebarClientPresentationState> {
  const electronReader = runtimeWindow.te2Electron?.readSidebarPresentationState;
  if (typeof electronReader === "function") {
    return normalizeSidebarPresentationState(await electronReader());
  }
  const raw = runtimeWindow.localStorage?.getItem(
    SIDEBAR_PRESENTATION_STORAGE_KEY,
  );
  if (!raw) return emptySidebarPresentationState();
  try {
    return normalizeSidebarPresentationState(JSON.parse(raw));
  } catch {
    return emptySidebarPresentationState();
  }
}

export async function saveSidebarPresentationState(
  state: SidebarClientPresentationState,
  runtimeWindow: PresentationWindow = window,
): Promise<void> {
  const normalized = normalizeSidebarPresentationState(state);
  const electronWriter = runtimeWindow.te2Electron?.writeSidebarPresentationState;
  if (typeof electronWriter === "function") {
    await electronWriter(normalized);
    return;
  }
  runtimeWindow.localStorage?.setItem(
    SIDEBAR_PRESENTATION_STORAGE_KEY,
    JSON.stringify(normalized),
  );
}
