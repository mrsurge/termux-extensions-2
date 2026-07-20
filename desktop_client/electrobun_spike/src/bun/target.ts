import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8089;
const DEFAULT_APP_ID = "file_editor_cm6";
export const MIN_ZOOM_LEVEL = 0.5;
export const MAX_ZOOM_LEVEL = 2;

export type DesktopShellSettings = {
  frameworkHost: string;
  frameworkPort: number;
  zoomLevel: number;
};

type OpenAppData = {
  url?: unknown;
};

type ApiEnvelope = {
  ok?: unknown;
  data?: unknown;
  error?: unknown;
};

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

export async function writeDesktopSettings(
  settings: DesktopShellSettings,
  environment = process.env,
): Promise<DesktopShellSettings> {
  const normalized = {
    frameworkHost: String(settings.frameworkHost || "").trim(),
    frameworkPort: validPort(settings.frameworkPort),
    zoomLevel: validZoom(settings.zoomLevel),
  };
  if (!normalized.frameworkHost) {
    throw new Error("Framework host cannot be empty");
  }

  const path = desktopSettingsPath(environment);
  const temporary = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(temporary, `${JSON.stringify(normalized, null, 2)}\n`);
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return normalized;
}

export function desktopSettingsPath(environment = process.env): string {
  const configHome = environment.XDG_CONFIG_HOME?.trim();
  return join(configHome || join(homedir(), ".config"), "te2", "desktop-shell.json");
}

export async function readDesktopSettings(
  environment = process.env,
): Promise<DesktopShellSettings> {
  const path = desktopSettingsPath(environment);
  let stored: Record<string, unknown> = {};

  try {
    const decoded: unknown = await Bun.file(path).json();
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      stored = decoded as Record<string, unknown>;
    }
  } catch {
    // The regular desktop shell also falls back to the loopback defaults.
  }

  return {
    frameworkHost:
      String(stored.frameworkHost ?? "").trim() || DEFAULT_HOST,
    frameworkPort: validPort(stored.frameworkPort),
    zoomLevel: validZoom(stored.zoomLevel),
  };
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

function openAppUrl(origin: string, appId: string, envelope: ApiEnvelope): URL {
  if (envelope.ok === false) {
    throw new Error(String(envelope.error || "Framework request failed"));
  }

  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as OpenAppData)
      : {};
  const rawUrl =
    typeof data.url === "string" && data.url.trim()
      ? data.url
      : `/app/${encodeURIComponent(appId)}`;
  const target = new URL(rawUrl, `${origin}/`);
  target.searchParams.set("gv_native", "1");
  return target;
}

function directTargetUrl(rawUrl: string): URL {
  const target = new URL(rawUrl);
  if (/^https?:$/.test(target.protocol) && target.pathname.startsWith("/app/")) {
    target.searchParams.set("gv_native", "1");
  }
  return target;
}

export async function resolveTarget(environment = process.env): Promise<{
  appId: string;
  settings: DesktopShellSettings;
  targetUrl: URL;
}> {
  const settings = await readDesktopSettings(environment);
  const appId = environment.TE2_DESKTOP_SPIKE_APP_ID?.trim() || DEFAULT_APP_ID;
  const directUrl = environment.TE2_DESKTOP_SPIKE_URL?.trim();

  if (directUrl) {
    return { appId, settings, targetUrl: directTargetUrl(directUrl) };
  }

  const origin = frameworkOrigin(settings);
  const endpoint = `${origin}/api/apps/${encodeURIComponent(appId)}/open`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ params: {} }),
  });

  let envelope: ApiEnvelope;
  try {
    envelope = (await response.json()) as ApiEnvelope;
  } catch (error) {
    throw new Error(`Framework returned invalid JSON: ${String(error)}`);
  }

  if (!response.ok) {
    throw new Error(
      String(envelope.error || `Framework returned HTTP ${response.status}`),
    );
  }

  return {
    appId,
    settings,
    targetUrl: openAppUrl(origin, appId, envelope),
  };
}
