import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import inventoryData from "../../../desktop_asset_inventory.json";
import type { AssetStatus, AssetUpdateResult } from "../shared/contracts";
import { te2DataHome } from "./te2-paths";

const ASSET_VERSION_PATH = "/api/editor_version";
const ASSET_BUNDLE_PATH = "/api/editor_assets_bundle";
const CONNECT_TIMEOUT_MS = 3_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

type AssetMapping = {
  kind: "exact" | "prefix";
  source: string;
  destination: string;
};

type AssetInventory = {
  localPrefixes: string[];
  localFiles: string[];
  localMappings: AssetMapping[];
  requiredFiles: string[];
};

export const ASSET_INVENTORY = inventoryData as AssetInventory;

export const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function desktopAssetRoot(environment = process.env): string {
  return join(te2DataHome(environment), "desktop_assets");
}

export function compareAssetVersions(left: string, right: string): number {
  const parts = (value: string) => value.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const leftParts = parts(left);
  const rightParts = parts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function mapLocalAssetPath(requestPath: string): string | null {
  if (
    !ASSET_INVENTORY.localFiles.includes(requestPath) &&
    !ASSET_INVENTORY.localPrefixes.some((prefix) => requestPath.startsWith(prefix))
  ) {
    return null;
  }
  for (const mapping of ASSET_INVENTORY.localMappings) {
    if (mapping.kind === "exact" && requestPath === mapping.source) {
      return mapping.destination;
    }
    if (mapping.kind === "prefix" && requestPath.startsWith(mapping.source)) {
      return `${mapping.destination}${requestPath.slice(mapping.source.length)}`;
    }
  }
  return requestPath;
}

function safeArchivePath(name: string): string | null {
  const posix = name.replaceAll("\\", "/");
  if (posix.startsWith("/") || posix.split("/").includes("..")) return null;
  const parts = posix.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts[0] === "android-shell") return null;
  return parts.join(sep);
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error || new Error("Failed to open asset bundle"));
      else resolvePromise(zipFile);
    });
  });
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error || new Error(`Failed to read ${entry.fileName}`));
      else resolvePromise(stream);
    });
  });
}

async function extractZip(bundlePath: string, destination: string): Promise<void> {
  const zipFile = await openZip(bundlePath);
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };
    zipFile.on("error", fail);
    zipFile.on("end", () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    });
    zipFile.on("entry", (entry) => {
      void (async () => {
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((mode & 0o170000) === 0o120000) {
          throw new Error(`Asset bundle contains a symbolic link: ${entry.fileName}`);
        }
        const safe = safeArchivePath(entry.fileName);
        if (!safe) {
          zipFile.readEntry();
          return;
        }
        const target = join(destination, safe);
        const targetRelative = relative(resolve(destination), resolve(target));
        if (targetRelative.startsWith("..") || targetRelative === "") {
          throw new Error(`Asset bundle path escapes staging: ${entry.fileName}`);
        }
        if (entry.fileName.endsWith("/")) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(dirname(target), { recursive: true });
          await pipeline(await openEntryStream(zipFile, entry), createWriteStream(target));
        }
        zipFile.readEntry();
      })().catch(fail);
    });
    zipFile.readEntry();
  });
}

export class DesktopAssetManager {
  readonly assetRoot: string;
  private updatePromise: Promise<AssetUpdateResult> | null = null;

  constructor(assetRoot = desktopAssetRoot()) {
    this.assetRoot = assetRoot;
  }

  async localVersion(root = this.assetRoot): Promise<string | null> {
    try {
      return (await readFile(join(root, "version.txt"), "utf8")).trim() || null;
    } catch {
      return null;
    }
  }

  async missingRequiredAsset(root = this.assetRoot): Promise<string | null> {
    for (const file of ASSET_INVENTORY.requiredFiles) {
      try {
        await access(join(root, file));
      } catch {
        return file;
      }
    }
    return null;
  }

  async status(browserOrigin: string | null = null): Promise<AssetStatus> {
    const missing = await this.missingRequiredAsset();
    return {
      assetRoot: this.assetRoot,
      localVersion: await this.localVersion(),
      valid: missing === null,
      missingRequiredAsset: missing,
      serverBaseUrl: browserOrigin,
      interceptorAvailable: true,
      interceptorError: null,
    };
  }

  async resolveLocalAsset(requestPath: string): Promise<string | null> {
    const mapped = mapLocalAssetPath(requestPath);
    if (!mapped) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(mapped).replace(/^\/+/, "");
    } catch {
      return null;
    }
    const root = resolve(this.assetRoot);
    const target = resolve(root, normalize(decoded));
    const targetRelative = relative(root, target);
    if (!decoded || targetRelative.startsWith("..") || targetRelative === "") return null;
    try {
      return (await stat(target)).isFile() ? target : null;
    } catch {
      return null;
    }
  }

  contentType(path: string): string {
    return MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
  }

  updateFromServer(
    baseUrl: string,
    browserOrigin: string,
    force = false,
  ): Promise<AssetUpdateResult> {
    if (this.updatePromise) return this.updatePromise;
    this.updatePromise = this.performUpdate(baseUrl, browserOrigin, force).finally(() => {
      this.updatePromise = null;
    });
    return this.updatePromise;
  }

  private async performUpdate(
    baseUrl: string,
    browserOrigin: string,
    force: boolean,
  ): Promise<AssetUpdateResult> {
    const localVersion = await this.localVersion();
    let serverVersion: string | null = null;
    try {
      const response = await fetch(new URL(ASSET_VERSION_PATH, `${baseUrl}/`), {
        headers: { Accept: "text/plain" },
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Asset version check returned HTTP ${response.status}`);
      serverVersion = (await response.text()).trim();
      if (!serverVersion) throw new Error("Asset version check returned an empty version");
      if (localVersion) {
        const comparison = compareAssetVersions(serverVersion, localVersion);
        if (comparison < 0) {
          throw new Error(`Refusing asset downgrade from ${localVersion} to ${serverVersion}`);
        }
        if (comparison === 0 && (await this.missingRequiredAsset()) === null && !force) {
          return {
            ...(await this.status(browserOrigin)),
            ok: true,
            updated: false,
            serverVersion,
            error: null,
          };
        }
      }
      await this.downloadAndInstall(baseUrl, localVersion);
      return {
        ...(await this.status(browserOrigin)),
        ok: true,
        updated: true,
        serverVersion,
        error: null,
      };
    } catch (error) {
      return {
        ...(await this.status(browserOrigin)),
        ok: false,
        updated: false,
        serverVersion,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async downloadAndInstall(baseUrl: string, localVersion: string | null): Promise<void> {
    const parent = dirname(this.assetRoot);
    const leaf = this.assetRoot.split(sep).at(-1);
    const staging = join(parent, `.${leaf}.staging`);
    const backup = join(parent, `.${leaf}.backup`);
    const bundle = join(parent, `.desktop-assets-${process.pid}-${Date.now()}.zip`);
    await mkdir(parent, { recursive: true });
    await Promise.all([
      rm(staging, { recursive: true, force: true }),
      rm(backup, { recursive: true, force: true }),
    ]);
    try {
      const response = await fetch(new URL(ASSET_BUNDLE_PATH, `${baseUrl}/`), {
        headers: { Accept: "application/zip" },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Asset download returned HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(bundle));
      await mkdir(staging, { recursive: true });
      await extractZip(bundle, staging);
      const stagedVersion = await this.localVersion(staging);
      if (!stagedVersion) throw new Error("Asset bundle is missing version.txt");
      const missing = await this.missingRequiredAsset(staging);
      if (missing) throw new Error(`Asset bundle is missing required file: ${missing}`);
      if (localVersion && compareAssetVersions(stagedVersion, localVersion) < 0) {
        throw new Error(`Refusing staged asset downgrade from ${localVersion} to ${stagedVersion}`);
      }
      try {
        await rename(this.assetRoot, backup);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await rename(staging, this.assetRoot);
      } catch (error) {
        try {
          await rename(backup, this.assetRoot);
        } catch {
          // Preserve the install error when no backup existed.
        }
        throw error;
      }
      await rm(backup, { recursive: true, force: true });
    } finally {
      await Promise.all([
        rm(bundle, { force: true }),
        rm(staging, { recursive: true, force: true }),
      ]);
    }
  }
}
