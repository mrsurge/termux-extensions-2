import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ElectronSidebarPresentationMode,
  ElectronSidebarPresentationState,
} from "../shared/app-view-contracts";
import { te2ConfigHome } from "./te2-paths";

const PRESENTATION_MODES = new Set<ElectronSidebarPresentationMode>([
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
  const presentationEntries = Object.entries(
    rawPresentations as Record<string, unknown>,
  ).sort(
    ([left], [right]) =>
      Number(containsLegacyCodeTe2Identity(left)) -
      Number(containsLegacyCodeTe2Identity(right)),
  );
  for (const [rawId, rawMode] of presentationEntries) {
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

export function desktopSidebarPresentationPath(
  environment = process.env,
): string {
  return join(te2ConfigHome(environment), "sidebar-presentation.json");
}

export async function readDesktopSidebarPresentationState(
  environment = process.env,
): Promise<ElectronSidebarPresentationState> {
  try {
    const value = JSON.parse(
      await readFile(desktopSidebarPresentationPath(environment), "utf8"),
    ) as unknown;
    const normalized = validateDesktopSidebarPresentationState(value);
    if (containsLegacyCodeTe2Identity(value)) {
      try {
        await writeDesktopSidebarPresentationState(normalized, environment);
      } catch {
        // Keep the canonical in-memory state and retry persistence on next read.
      }
    }
    return normalized;
  } catch {
    return emptyDesktopSidebarPresentationState();
  }
}

export async function writeDesktopSidebarPresentationState(
  value: unknown,
  environment = process.env,
): Promise<ElectronSidebarPresentationState> {
  const normalized = validateDesktopSidebarPresentationState(value);
  const path = desktopSidebarPresentationPath(environment);
  const temporary = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return normalized;
}
