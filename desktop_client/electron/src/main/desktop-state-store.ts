import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type {
  ElectronEditorSurfaceMode,
  ElectronEditorSurfacePresentation,
  ElectronSidebarPresentationMode,
  ElectronSidebarPresentationState,
} from "../shared/app-view-contracts";
import { te2ConfigHome } from "./te2-paths";

const CLIENT_ID_PATTERN = /^client_[a-z0-9]{20,64}$/;
const PRESENTATION_MODES = new Set<ElectronSidebarPresentationMode>([
  "embedded",
  "hidden",
  "detached",
]);
const EDITOR_MODES = new Set<ElectronEditorSurfaceMode>([
  "closed",
  "docked",
  "collapsed",
  "detached",
]);
const MAX_PRESENTATION_IDS = 256;
const MAX_ID_LENGTH = 512;
const MAX_EDITOR_PROJECTS = 64;
const MAX_SIDEBAR_PROJECTS = 32;
const MIN_DOCK_SIZE = 320;
const MAX_DOCK_SIZE = 1200;
const LEGACY_CODE_TE2_IDENTITY =
  /(^|[^A-Za-z0-9_])file_editor_cm6(?=$|[^A-Za-z0-9_])/g;

export type ElectronDesktopIdentities = {
  primaryClientInstanceId: string;
  secondaryClientInstanceId: string;
};

export type ElectronDesktopState = {
  version: 1;
  identities: ElectronDesktopIdentities;
  sidebar: ElectronSidebarPresentationStore;
  editorSurfaces: {
    secondary: {
      projects: Record<string, ElectronEditorSurfacePresentation>;
    };
  };
};

type ElectronSidebarPresentationStore = {
  version: 2;
  projects: Record<string, ElectronSidebarPresentationState>;
  legacy: ElectronSidebarPresentationState | null;
};

type LegacyClientIdentity = {
  version: 1;
  clientInstanceId: string;
};

let stateQueue: Promise<void> = Promise.resolve();

function withStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = stateQueue.then(operation, operation);
  stateQueue = result.then(() => undefined, () => undefined);
  return result;
}

function generatedClientId(): string {
  return `client_${randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function normalizedClientId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!CLIENT_ID_PATTERN.test(normalized)) {
    throw new Error("Desktop client identity is invalid");
  }
  return normalized;
}

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
  if (Array.isArray(value)) return value.some(containsLegacyCodeTe2Identity);
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        containsLegacyCodeTe2Identity(key) ||
        containsLegacyCodeTe2Identity(item),
    );
  }
  return false;
}

function normalizedId(value: unknown): string {
  return typeof value === "string"
    ? canonicalizeCodeTe2Identity(value.trim()).slice(0, MAX_ID_LENGTH)
    : "";
}

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = normalizedId(item);
    if (!id || seen.has(id)) continue;
    result.push(id);
    seen.add(id);
    if (result.length >= MAX_PRESENTATION_IDS) break;
  }
  return result;
}

export function emptyDesktopSidebarPresentationState(): ElectronSidebarPresentationState {
  return {
    version: 1,
    order: [],
    foregroundHostId: "",
    lastAgentHostId: "",
    lastAgentPresentationId: "",
    presentations: {},
  };
}

export function validateDesktopSidebarPresentationState(
  value: unknown,
): ElectronSidebarPresentationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sidebar presentation state must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error("Unsupported Sidebar presentation state version");
  }
  const rawPresentations = raw.presentations;
  if (
    !rawPresentations ||
    typeof rawPresentations !== "object" ||
    Array.isArray(rawPresentations)
  ) {
    throw new Error("Sidebar presentations must be an object");
  }
  const presentations: Record<string, ElectronSidebarPresentationMode> = {};
  const entries = Object.entries(rawPresentations as Record<string, unknown>).sort(
    ([left], [right]) =>
      Number(containsLegacyCodeTe2Identity(left)) -
      Number(containsLegacyCodeTe2Identity(right)),
  );
  for (const [rawId, rawMode] of entries) {
    const id = normalizedId(rawId);
    if (!id) continue;
    if (
      typeof rawMode !== "string" ||
      !PRESENTATION_MODES.has(rawMode as ElectronSidebarPresentationMode)
    ) {
      throw new Error(`Invalid Sidebar presentation mode for ${id}`);
    }
    if (Object.keys(presentations).length >= MAX_PRESENTATION_IDS) break;
    if (id in presentations && containsLegacyCodeTe2Identity(rawId)) continue;
    presentations[id] = rawMode as ElectronSidebarPresentationMode;
  }
  return {
    version: 1,
    order: normalizedIds(raw.order),
    foregroundHostId: normalizedId(raw.foregroundHostId),
    lastAgentHostId: normalizedId(raw.lastAgentHostId),
    lastAgentPresentationId: normalizedId(raw.lastAgentPresentationId),
    presentations,
  };
}

function durableDesktopSidebarPresentationState(
  value: unknown,
): ElectronSidebarPresentationState {
  return {
    ...validateDesktopSidebarPresentationState(value),
    lastAgentPresentationId: "",
  };
}

function emptyDesktopSidebarPresentationStore(
  legacy: ElectronSidebarPresentationState | null = null,
): ElectronSidebarPresentationStore {
  return { version: 2, projects: {}, legacy };
}

function validateDesktopSidebarPresentationStore(
  value: unknown,
): ElectronSidebarPresentationStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyDesktopSidebarPresentationStore();
  }
  const raw = value as Record<string, unknown>;
  if (raw.version === 1) {
    return emptyDesktopSidebarPresentationStore(
      durableDesktopSidebarPresentationState(raw),
    );
  }
  if (
    raw.version !== 2
    || !raw.projects
    || typeof raw.projects !== "object"
    || Array.isArray(raw.projects)
  ) {
    throw new Error("Unsupported Sidebar presentation store version");
  }
  const projects: Record<string, ElectronSidebarPresentationState> = {};
  for (const [key, state] of Object.entries(
    raw.projects as Record<string, unknown>,
  ).slice(-MAX_SIDEBAR_PROJECTS)) {
    if (!key || key.length > 4096) continue;
    projects[key] = durableDesktopSidebarPresentationState(state);
  }
  const legacy = raw.legacy === null || raw.legacy === undefined
    ? null
    : durableDesktopSidebarPresentationState(raw.legacy);
  return { version: 2, projects, legacy };
}

function defaultEditorPresentation(): ElectronEditorSurfacePresentation {
  return {
    mode: "closed",
    dockSize: 480,
    detachedBounds: { x: 100, y: 100, width: 980, height: 720 },
    maximized: false,
  };
}

function finiteInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
}

export function validateElectronEditorSurfacePresentation(
  value: unknown,
): ElectronEditorSurfacePresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Editor surface presentation must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.mode !== "string" ||
    !EDITOR_MODES.has(raw.mode as ElectronEditorSurfaceMode)
  ) {
    throw new Error("Editor surface presentation mode is invalid");
  }
  const defaults = defaultEditorPresentation();
  const bounds = raw.detachedBounds && typeof raw.detachedBounds === "object"
    ? raw.detachedBounds as Record<string, unknown>
    : {};
  return {
    mode: raw.mode as ElectronEditorSurfaceMode,
    dockSize: Math.max(
      MIN_DOCK_SIZE,
      Math.min(MAX_DOCK_SIZE, finiteInteger(raw.dockSize, defaults.dockSize)),
    ),
    detachedBounds: {
      x: finiteInteger(bounds.x, defaults.detachedBounds.x),
      y: finiteInteger(bounds.y, defaults.detachedBounds.y),
      width: Math.max(440, finiteInteger(bounds.width, defaults.detachedBounds.width)),
      height: Math.max(300, finiteInteger(bounds.height, defaults.detachedBounds.height)),
    },
    maximized: raw.maximized === true,
  };
}

function validateDesktopState(value: unknown): ElectronDesktopState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Desktop state must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error("Unsupported desktop state version");
  const identities = raw.identities as Record<string, unknown> | null;
  const editorSurfaces = raw.editorSurfaces as Record<string, unknown> | null;
  const secondary = editorSurfaces?.secondary as Record<string, unknown> | null;
  if (!identities || !secondary) throw new Error("Desktop state is incomplete");
  const rawProjects = secondary.projects;
  if (!rawProjects || typeof rawProjects !== "object" || Array.isArray(rawProjects)) {
    throw new Error("Desktop editor project state must be an object");
  }
  const projects: Record<string, ElectronEditorSurfacePresentation> = {};
  for (const [key, presentation] of Object.entries(rawProjects as Record<string, unknown>)) {
    if (!key || key.length > 4096) continue;
    projects[key] = validateElectronEditorSurfacePresentation(presentation);
    if (Object.keys(projects).length >= MAX_EDITOR_PROJECTS) break;
  }
  const primaryClientInstanceId = normalizedClientId(
    identities.primaryClientInstanceId,
  );
  const secondaryClientInstanceId = normalizedClientId(
    identities.secondaryClientInstanceId,
  );
  if (primaryClientInstanceId === secondaryClientInstanceId) {
    throw new Error("Desktop editor client identities must be distinct");
  }
  return {
    version: 1,
    identities: {
      primaryClientInstanceId,
      secondaryClientInstanceId,
    },
    sidebar: validateDesktopSidebarPresentationStore(raw.sidebar),
    editorSurfaces: { secondary: { projects } },
  };
}

function createDesktopState(
  primaryClientInstanceId = generatedClientId(),
  sidebar = emptyDesktopSidebarPresentationState(),
): ElectronDesktopState {
  return {
    version: 1,
    identities: {
      primaryClientInstanceId,
      secondaryClientInstanceId: generatedClientId(),
    },
    sidebar: emptyDesktopSidebarPresentationStore(sidebar),
    editorSurfaces: { secondary: { projects: {} } },
  };
}

export function desktopStatePath(environment = process.env): string {
  return join(te2ConfigHome(environment), "desktop-state.json");
}

export function legacyDesktopClientIdentityPath(environment = process.env): string {
  return join(te2ConfigHome(environment), "desktop-client-identity.json");
}

export function legacyDesktopSidebarPresentationPath(environment = process.env): string {
  return join(te2ConfigHome(environment), "sidebar-presentation.json");
}

async function readLegacyIdentity(environment: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const raw = JSON.parse(
      await readFile(legacyDesktopClientIdentityPath(environment), "utf8"),
    ) as LegacyClientIdentity;
    return raw.version === 1 ? normalizedClientId(raw.clientInstanceId) : null;
  } catch {
    return null;
  }
}

async function readLegacySidebar(
  environment: NodeJS.ProcessEnv,
): Promise<ElectronSidebarPresentationState> {
  try {
    return validateDesktopSidebarPresentationState(
      JSON.parse(
        await readFile(legacyDesktopSidebarPresentationPath(environment), "utf8"),
      ),
    );
  } catch {
    return emptyDesktopSidebarPresentationState();
  }
}

async function writeDesktopStateUnlocked(
  state: ElectronDesktopState,
  environment: NodeJS.ProcessEnv,
): Promise<ElectronDesktopState> {
  const normalized = validateDesktopState(state);
  const path = desktopStatePath(environment);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return normalized;
}

async function readDesktopStateUnlocked(
  environment: NodeJS.ProcessEnv,
): Promise<ElectronDesktopState> {
  try {
    const decoded = JSON.parse(
      await readFile(desktopStatePath(environment), "utf8"),
    ) as unknown;
    const normalized = validateDesktopState(decoded);
    if (JSON.stringify(decoded) !== JSON.stringify(normalized)) {
      return writeDesktopStateUnlocked(normalized, environment);
    }
    return normalized;
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    const state = createDesktopState(
      (await readLegacyIdentity(environment)) || generatedClientId(),
      await readLegacySidebar(environment),
    );
    const written = await writeDesktopStateUnlocked(state, environment);
    await Promise.all([
      rm(legacyDesktopClientIdentityPath(environment), { force: true }),
      rm(legacyDesktopSidebarPresentationPath(environment), { force: true }),
    ]);
    return written;
  }
}

export function readDesktopState(
  environment = process.env,
): Promise<ElectronDesktopState> {
  return withStateLock(() => readDesktopStateUnlocked(environment));
}

export function readDesktopIdentities(
  environment = process.env,
): Promise<ElectronDesktopIdentities> {
  return withStateLock(async () => ({
    ...(await readDesktopStateUnlocked(environment)).identities,
  }));
}

export function resetDesktopIdentities(
  environment = process.env,
): Promise<ElectronDesktopIdentities> {
  return withStateLock(async () => {
    const state = await readDesktopStateUnlocked(environment);
    state.identities = {
      primaryClientInstanceId: generatedClientId(),
      secondaryClientInstanceId: generatedClientId(),
    };
    state.editorSurfaces.secondary.projects = {};
    const written = await writeDesktopStateUnlocked(state, environment);
    return { ...written.identities };
  });
}

export function readDesktopSidebarState(
  frameworkOrigin: string,
  projectPath: string,
  environment = process.env,
): Promise<ElectronSidebarPresentationState> {
  const key = desktopEditorProjectKey(frameworkOrigin, projectPath);
  return withStateLock(async () => {
    const state = await readDesktopStateUnlocked(environment);
    const stored = state.sidebar.projects[key];
    if (stored) return { ...stored, presentations: { ...stored.presentations } };
    if (state.sidebar.legacy) {
      const migrated = state.sidebar.legacy;
      state.sidebar.legacy = null;
      state.sidebar.projects[key] = migrated;
      await writeDesktopStateUnlocked(state, environment);
      return { ...migrated, presentations: { ...migrated.presentations } };
    }
    return emptyDesktopSidebarPresentationState();
  });
}

export function writeDesktopSidebarState(
  frameworkOrigin: string,
  projectPath: string,
  value: unknown,
  environment = process.env,
): Promise<ElectronSidebarPresentationState> {
  const key = desktopEditorProjectKey(frameworkOrigin, projectPath);
  return withStateLock(async () => {
    const state = await readDesktopStateUnlocked(environment);
    const normalized = durableDesktopSidebarPresentationState(value);
    delete state.sidebar.projects[key];
    state.sidebar.projects[key] = normalized;
    state.sidebar.projects = Object.fromEntries(
      Object.entries(state.sidebar.projects).slice(-MAX_SIDEBAR_PROJECTS),
    );
    state.sidebar.legacy = null;
    const written = await writeDesktopStateUnlocked(state, environment);
    const stored = written.sidebar.projects[key] || normalized;
    return { ...stored, presentations: { ...stored.presentations } };
  });
}

export function desktopEditorProjectKey(
  frameworkOrigin: string,
  projectPath: string,
): string {
  const originUrl = new URL(frameworkOrigin);
  if (!/^https?:$/.test(originUrl.protocol) || originUrl.username || originUrl.password) {
    throw new Error("Secondary editor framework origin is invalid");
  }
  if (!isAbsolute(projectPath)) {
    throw new Error("Secondary editor project path must be absolute");
  }
  return `${originUrl.origin}\u0000${resolve(projectPath)}`;
}

export function readSecondaryEditorPresentation(
  frameworkOrigin: string,
  projectPath: string,
  environment = process.env,
): Promise<ElectronEditorSurfacePresentation> {
  const key = desktopEditorProjectKey(frameworkOrigin, projectPath);
  return withStateLock(async () => {
    const state = await readDesktopStateUnlocked(environment);
    return {
      ...(state.editorSurfaces.secondary.projects[key] || defaultEditorPresentation()),
      detachedBounds: {
        ...(state.editorSurfaces.secondary.projects[key]?.detachedBounds ||
          defaultEditorPresentation().detachedBounds),
      },
    };
  });
}

export function writeSecondaryEditorPresentation(
  frameworkOrigin: string,
  projectPath: string,
  value: unknown,
  environment = process.env,
): Promise<ElectronEditorSurfacePresentation> {
  const key = desktopEditorProjectKey(frameworkOrigin, projectPath);
  const normalized = validateElectronEditorSurfacePresentation(value);
  return withStateLock(async () => {
    const state = await readDesktopStateUnlocked(environment);
    const current = state.editorSurfaces.secondary.projects;
    delete current[key];
    current[key] = normalized;
    const entries = Object.entries(current).slice(-MAX_EDITOR_PROJECTS);
    state.editorSurfaces.secondary.projects = Object.fromEntries(entries);
    await writeDesktopStateUnlocked(state, environment);
    return {
      ...normalized,
      detachedBounds: { ...normalized.detachedBounds },
    };
  });
}

export function clampEditorWindowBounds(
  bounds: Electron.Rectangle,
  workArea: Electron.Rectangle,
): Electron.Rectangle {
  const width = Math.min(Math.max(440, Math.round(bounds.width)), workArea.width);
  const height = Math.min(Math.max(300, Math.round(bounds.height)), workArea.height);
  return {
    x: Math.min(Math.max(Math.round(bounds.x), workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(Math.round(bounds.y), workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}
