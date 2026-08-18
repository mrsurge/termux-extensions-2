import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DESKTOP_SETTINGS_VERSION,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  type DesktopFrameworkBookmark,
  type DesktopFrameworkBookmarkView,
  type DesktopShellSettings,
} from "../shared/contracts";
import { te2ConfigHome } from "./te2-paths";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8089;
export const MAX_FRAMEWORK_BOOKMARKS = 16;
export const MAX_FRAMEWORK_BOOKMARK_NAME_LENGTH = 64;

type FrameworkEndpoint = Pick<
  DesktopShellSettings,
  "frameworkHost" | "frameworkPort"
>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : DEFAULT_PORT;
}

function validatePort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Framework port must be an integer between 1 and 65535");
  }
  return port;
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

function validateBookmarkName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("Bookmark name cannot be empty");
  if (name.length > MAX_FRAMEWORK_BOOKMARK_NAME_LENGTH) {
    throw new Error(
      `Bookmark name cannot exceed ${MAX_FRAMEWORK_BOOKMARK_NAME_LENGTH} characters`,
    );
  }
  if (/\p{Cc}/u.test(name)) {
    throw new Error("Bookmark name cannot contain control characters");
  }
  return name;
}

export function validateFrameworkEndpoint(endpoint: {
  frameworkHost: unknown;
  frameworkPort: unknown;
}): FrameworkEndpoint & { frameworkBaseUrl: string } {
  const frameworkHost = String(endpoint.frameworkHost ?? "").trim();
  if (!frameworkHost) throw new Error("Framework host cannot be empty");
  const frameworkPort = validatePort(endpoint.frameworkPort);
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(frameworkHost)
    ? frameworkHost
    : `http://${frameworkHost}`;
  const parsed = new URL(candidate);
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
    throw new Error("Framework host must be an HTTP or HTTPS host");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Framework host must not include credentials");
  }
  parsed.port = String(frameworkPort);
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return {
    frameworkHost,
    frameworkPort,
    frameworkBaseUrl: parsed.origin,
  };
}

function decodeFrameworkBookmarks(value: unknown): DesktopFrameworkBookmark[] {
  if (!Array.isArray(value)) return [];
  const bookmarks: DesktopFrameworkBookmark[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (bookmarks.length >= MAX_FRAMEWORK_BOOKMARKS) break;
    if (!isRecord(item)) continue;
    try {
      const name = validateBookmarkName(item.name);
      const key = name.toLowerCase();
      if (names.has(key)) continue;
      const endpoint = validateFrameworkEndpoint({
        frameworkHost: item.frameworkHost,
        frameworkPort: item.frameworkPort,
      });
      names.add(key);
      bookmarks.push({
        name,
        frameworkHost: endpoint.frameworkHost,
        frameworkPort: endpoint.frameworkPort,
      });
    } catch {
      // One malformed bookmark must not make the desktop settings unreadable.
    }
  }
  return bookmarks;
}

export function frameworkBookmarkViews(
  bookmarks: readonly DesktopFrameworkBookmark[],
): DesktopFrameworkBookmarkView[] {
  return decodeFrameworkBookmarks(bookmarks).map((bookmark) => ({
    ...bookmark,
    frameworkBaseUrl: frameworkOrigin(bookmark),
  }));
}

export function upsertFrameworkBookmark(
  bookmarks: readonly DesktopFrameworkBookmark[],
  value: unknown,
): DesktopFrameworkBookmark[] {
  if (!isRecord(value)) throw new Error("Bookmark must be an object");
  const current = decodeFrameworkBookmarks(bookmarks);
  const name = validateBookmarkName(value.name);
  const endpoint = validateFrameworkEndpoint({
    frameworkHost: value.frameworkHost,
    frameworkPort: value.frameworkPort,
  });
  const bookmark: DesktopFrameworkBookmark = {
    name,
    frameworkHost: endpoint.frameworkHost,
    frameworkPort: endpoint.frameworkPort,
  };
  const index = current.findIndex(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (index >= 0) {
    current[index] = bookmark;
    return current;
  }
  if (current.length >= MAX_FRAMEWORK_BOOKMARKS) {
    throw new Error(`Only ${MAX_FRAMEWORK_BOOKMARKS} framework bookmarks are allowed`);
  }
  return [...current, bookmark];
}

export function deleteFrameworkBookmark(
  bookmarks: readonly DesktopFrameworkBookmark[],
  nameValue: unknown,
): DesktopFrameworkBookmark[] {
  const name = validateBookmarkName(nameValue);
  const key = name.toLowerCase();
  return decodeFrameworkBookmarks(bookmarks).filter(
    (bookmark) => bookmark.name.toLowerCase() !== key,
  );
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
    version: DESKTOP_SETTINGS_VERSION,
    frameworkHost: String(stored.frameworkHost ?? "").trim() || DEFAULT_HOST,
    frameworkPort: readPort(stored.frameworkPort),
    frameworkBookmarks: decodeFrameworkBookmarks(stored.frameworkBookmarks),
    zoomLevel: validZoom(stored.zoomLevel),
  };
}

export async function writeDesktopSettings(
  settings: DesktopShellSettings,
  environment = process.env,
): Promise<DesktopShellSettings> {
  const endpoint = validateFrameworkEndpoint(settings);
  const normalized: DesktopShellSettings = {
    version: DESKTOP_SETTINGS_VERSION,
    frameworkHost: endpoint.frameworkHost,
    frameworkPort: endpoint.frameworkPort,
    frameworkBookmarks: decodeFrameworkBookmarks(settings.frameworkBookmarks),
    zoomLevel: validZoom(settings.zoomLevel),
  };

  const path = desktopSettingsPath(environment);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return normalized;
}

export function frameworkOrigin(settings: FrameworkEndpoint): string {
  return validateFrameworkEndpoint(settings).frameworkBaseUrl;
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
