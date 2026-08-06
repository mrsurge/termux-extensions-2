import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
  ElectronSidebarPresentationMode,
  ElectronSidebarPresentationState,
} from "../shared/app-view-contracts";

const PRESENTATION_MODES = new Set<ElectronSidebarPresentationMode>([
  "embedded",
  "hidden",
  "detached",
]);
const MAX_PRESENTATION_IDS = 256;
const MAX_ID_LENGTH = 512;

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
    ? value.trim().slice(0, MAX_ID_LENGTH)
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
  for (const [rawId, rawMode] of Object.entries(
    rawPresentations as Record<string, unknown>,
  )) {
    const id = normalizedId(rawId);
    if (!id) continue;
    if (
      typeof rawMode !== "string" ||
      !PRESENTATION_MODES.has(rawMode as ElectronSidebarPresentationMode)
    ) {
      throw new Error(`Invalid Sidebar presentation mode for ${id}`);
    }
    if (Object.keys(presentations).length >= MAX_PRESENTATION_IDS) break;
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
  const configHome = environment.XDG_CONFIG_HOME?.trim();
  return join(
    configHome || join(homedir(), ".config"),
    "te2",
    "sidebar-presentation.json",
  );
}

export async function readDesktopSidebarPresentationState(
  environment = process.env,
): Promise<ElectronSidebarPresentationState> {
  try {
    return validateDesktopSidebarPresentationState(
      JSON.parse(
        await readFile(desktopSidebarPresentationPath(environment), "utf8"),
      ),
    );
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
