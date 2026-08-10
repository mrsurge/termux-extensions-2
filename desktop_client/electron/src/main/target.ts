import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  type DesktopShellSettings,
} from "../shared/contracts";
import { te2ConfigHome } from "./te2-paths";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8089;

function validPort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : DEFAULT_PORT;
}

export function validZoom(value: unknown): number {
  const zoom = Number(value);
  return Number.isFinite(zoom)
    ? Math.round(Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, zoom)) * 10) / 10
    : 1;
}

export function desktopSettingsPath(environment = process.env): string {
  return join(te2ConfigHome(environment), "desktop-shell.json");
}

export async function readDesktopSettings(
  environment = process.env,
): Promise<DesktopShellSettings> {
  let stored: Record<string, unknown> = {};
  try {
    const decoded: unknown = JSON.parse(
      await readFile(desktopSettingsPath(environment), "utf8"),
    );
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      stored = decoded as Record<string, unknown>;
    }
  } catch {
    // The desktop shell falls back to the framework's loopback defaults.
  }
  return {
    frameworkHost: String(stored.frameworkHost ?? "").trim() || DEFAULT_HOST,
    frameworkPort: validPort(stored.frameworkPort),
    zoomLevel: validZoom(stored.zoomLevel),
  };
}

export async function writeDesktopSettings(
  settings: DesktopShellSettings,
  environment = process.env,
): Promise<DesktopShellSettings> {
  const normalized = {
    frameworkHost: String(settings.frameworkHost || "").trim(),
    frameworkPort: validPort(settings.frameworkPort),
    zoomLevel: validZoom(settings.zoomLevel),
  };
  if (!normalized.frameworkHost) throw new Error("Framework host cannot be empty");

  const path = desktopSettingsPath(environment);
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

export function frameworkOrigin(settings: DesktopShellSettings): string {
  const rawHost = settings.frameworkHost.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(rawHost)
    ? rawHost
    : `http://${rawHost}`;
  const parsed = new URL(candidate);
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
    throw new Error("Framework host must be an HTTP or HTTPS host");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Framework host must not include credentials");
  }
  parsed.port = String(settings.frameworkPort);
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.origin;
}

export function projectFrameworkUrl(
  rawUrl: string,
  configuredOrigin: string,
  browserOrigin: string,
): URL {
  const target = new URL(rawUrl, `${configuredOrigin}/`);
  if (target.origin !== configuredOrigin || browserOrigin === configuredOrigin) {
    return target;
  }
  return new URL(`${target.pathname}${target.search}${target.hash}`, `${browserOrigin}/`);
}
