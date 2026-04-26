export interface ExtensionCatalogRuntime {
  env: Record<string, string | undefined>;
  readTextFile: (path: string) => Promise<string>;
  joinPath: (...parts: string[]) => string;
  sha1Short: (text: string) => string;
  randomUuid: () => string;
  logMetrics: (type: string, data: Record<string, unknown>) => void;
  log: (...args: unknown[]) => void;
}

export interface ExtensionSnapshotOptions {
  env: Record<string, string | undefined>;
  excludeIds: string[];
  log: (...args: unknown[]) => void;
}

export interface ExtHostInitOptions {
  authority: string | null;
  commit: string | null;
  envData: unknown;
  scannedExtensions: unknown[];
  folder: string | null;
  useRemote: boolean;
  productVersion: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function boolValue(value: unknown): boolean {
  return Boolean(value);
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function envFlagEnabled(env: Record<string, string | undefined>, name: string, defaultValue: string): boolean {
  const raw = String(env[name] ?? defaultValue).toLowerCase().trim();
  return !(raw === "0" || raw === "false" || raw === "no");
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function activationEventsFrom(ext: unknown, manifest: Record<string, unknown>): unknown[] {
  const manifestEvents = manifest.activationEvents;
  if (Array.isArray(manifestEvents)) return manifestEvents;
  const extEvents = field(ext, "activationEvents");
  return Array.isArray(extEvents) ? extEvents : [];
}

export function extensionIdentifierFrom(ext: unknown): string | null {
  const ident = field(ext, "identifier");
  if (typeof ident === "string") return ident;
  if (isRecord(ident)) {
    if (typeof ident.value === "string") return ident.value;
    if (typeof ident.id === "string") return ident.id;
  }
  const id = field(ext, "id") ?? field(ext, "extensionId") ?? field(ident, "value") ?? field(ident, "id");
  if (typeof id === "string" && id) return id;
  return null;
}

export function sanitizeExtensionForInit(
  ext: unknown,
  authority: string | null,
  env: Record<string, string | undefined> = {},
): Record<string, unknown> | null {
  if (!isRecord(ext)) return null;

  const identifier = extensionIdentifierFrom(ext);
  const packageJson = recordField(ext, "packageJSON");
  const manifest = packageJson ?? ext;
  const name = manifest.name;
  const publisher = manifest.publisher;
  const version = manifest.version;
  const engines = manifest.engines;
  const main = typeof manifest.main === "string" ? manifest.main : undefined;
  const browser = typeof manifest.browser === "string" ? manifest.browser : undefined;
  const activationEvents = activationEventsFrom(ext, manifest);

  const loc =
    recordField(ext, "extensionLocation") ??
    recordField(ext, "location") ??
    recordField(manifest, "extensionLocation");
  const locPath = loc ? stringValue(loc.path) ?? stringValue(loc.fsPath) : null;
  const locScheme = loc ? stringValue(loc.scheme) : null;
  const locAuthority = loc ? stringValue(loc.authority) : null;

  let extensionLocation: Record<string, unknown> | null = null;
  if (authority) {
    if (locPath) {
      extensionLocation = { $mid: 1, scheme: "vscode-remote", authority, path: locPath, query: loc?.query, fragment: loc?.fragment };
    }
  } else if (loc && locScheme && locPath) {
    extensionLocation = { $mid: 1, scheme: locScheme, authority: locAuthority ?? undefined, path: locPath, query: loc.query, fragment: loc.fragment };
  }

  const metadata = recordField(ext, "metadata");
  const id = field(ext, "id") || field(ext, "extensionId") || (publisher && name ? `${String(publisher)}.${String(name)}` : null) || identifier;
  const targetPlatform = field(metadata, "targetPlatform") || field(ext, "targetPlatform") || "unknown";
  const includeContributes = String(env.TE2_EXT_INCLUDE_CONTRIB || "1") !== "0";
  const contributes = includeContributes ? manifest.contributes : undefined;
  const extIdentifier = recordField(ext, "identifier");
  const uuid = field(extIdentifier, "uuid") ?? field(ext, "uuid") ?? undefined;

  return {
    name,
    publisher,
    version,
    engines,
    main,
    browser,
    activationEvents,
    contributes,
    id,
    identifier: {
      value: String(id),
      _lower: String(id).toLowerCase(),
      id: String(id),
      uuid,
    },
    uuid,
    isBuiltin: boolValue(ext.isBuiltin),
    isUserBuiltin: boolValue(ext.isUserBuiltin),
    isUnderDevelopment: boolValue(ext.isUnderDevelopment),
    publisherDisplayName: field(metadata, "publisherDisplayName") ?? field(ext, "publisherDisplayName"),
    targetPlatform,
    extensionLocation,
    preRelease: boolValue(field(metadata, "preRelease") ?? field(ext, "preRelease")),
    extensionDependencies: Array.isArray(manifest.extensionDependencies) ? manifest.extensionDependencies : undefined,
    extensionPack: Array.isArray(manifest.extensionPack) ? manifest.extensionPack : undefined,
  };
}

export function buildExtensionsSnapshot(scannedExtensions: unknown[], options: ExtensionSnapshotOptions): Record<string, unknown> {
  const includeBuiltin = envFlagEnabled(options.env, "TE2_INCLUDE_BUILTIN_EXTS", "");
  const base = Array.isArray(scannedExtensions)
    ? scannedExtensions.filter((ext) => includeBuiltin || field(ext, "isBuiltin") === false)
    : [];
  const afterExclude = options.excludeIds.length
    ? base.filter((ext) => {
        const ident = extensionIdentifierFrom(ext) ?? "";
        return !options.excludeIds.includes(String(ident));
      })
    : base;

  const all = afterExclude.filter((ext) => {
    if (field(ext, "isBuiltin") === false) return true;
    const ident = String(extensionIdentifierFrom(ext) ?? "").toLowerCase();
    if (ident.endsWith("-language-features")) return true;
    if (ident.startsWith("vscode.theme-")) return true;
    if (ident === "vscode.configuration-editing") return true;

    const manifest = recordField(ext, "packageJSON") ?? (isRecord(ext) ? ext : {});
    const contributes = recordField(manifest, "contributes");
    if (contributes && (contributes.grammars || contributes.languages)) {
      const activationEvents = Array.isArray(field(ext, "activationEvents")) ? field(ext, "activationEvents") as unknown[] : [];
      const hasStarActivation = activationEvents.includes("*");
      const hasOnLanguage = activationEvents.some((event) => typeof event === "string" && event.startsWith("onLanguage"));
      if (activationEvents.length === 0 || (!hasStarActivation && hasOnLanguage) || activationEvents.every((event) => typeof event === "string" && event.startsWith("onLanguage"))) {
        return true;
      }
    }
    if (contributes && contributes.themes && !contributes.commands) return true;
    return false;
  });

  options.log(`[extensions] snapshot: ${base.length} scanned -> ${afterExclude.length} after exclude -> ${all.length} after language filter`);
  const activationEvents: Record<string, unknown> = {};
  const myExtensions: string[] = [];
  const seenMy = new Set<string>();
  for (const ext of all) {
    const ident = extensionIdentifierFrom(ext);
    if (!ident) continue;
    const events = field(ext, "activationEvents");
    activationEvents[String(ident)] = Array.isArray(events) ? events : [];
    const eligible = includeBuiltin || field(ext, "isBuiltin") === false;
    if (eligible) {
      const dedupeKey = String(ident).toLowerCase();
      if (!seenMy.has(dedupeKey)) {
        seenMy.add(dedupeKey);
        myExtensions.push(ident);
      }
    }
  }
  return { versionId: 1, allExtensions: all, activationEvents, myExtensions };
}

export async function scanExtensionsFromDisk(runtime: ExtensionCatalogRuntime, authority: string | null): Promise<Record<string, unknown>[]> {
  const home = runtime.env.HOME || runtime.env.USERPROFILE || "";
  const jsonPath = runtime.env.TE2_EXTENSIONS_JSON || (home ? runtime.joinPath(home, ".config/code-server/extensions/extensions.json") : null);
  if (!jsonPath) throw new Error("No HOME for extensions.json");
  const raw = await runtime.readTextFile(jsonPath);
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) return [];

  const out: Record<string, unknown>[] = [];
  let pkgCount = 0;
  let totalPkgBytes = 0;
  let maxPkgBytes = 0;
  let maxPkgPath: string | null = null;
  let totalActivationEvents = 0;
  let totalContribKeys = 0;

  for (const entry of entries) {
    try {
      const loc = recordField(entry, "location");
      const locPath = loc ? stringValue(loc.path) ?? stringValue(loc.fsPath) : null;
      if (!locPath) continue;
      const pkgPath = runtime.joinPath(locPath, "package.json");
      const pkgRaw = await runtime.readTextFile(pkgPath);
      const pkgBytes = new TextEncoder().encode(pkgRaw).length;
      totalPkgBytes += pkgBytes;
      pkgCount += 1;
      if (pkgBytes > maxPkgBytes) {
        maxPkgBytes = pkgBytes;
        maxPkgPath = pkgPath;
      }
      const manifest = JSON.parse(pkgRaw);
      if (Array.isArray(manifest?.activationEvents)) totalActivationEvents += manifest.activationEvents.length;
      if (manifest?.contributes && typeof manifest.contributes === "object") {
        try {
          totalContribKeys += Object.keys(manifest.contributes).length;
        } catch {
          // ignore malformed contributes
        }
      }
      const entryIdentifier = recordField(entry, "identifier");
      const metadata = recordField(entry, "metadata");
      const rawExt = {
        ...manifest,
        id: stringValue(field(entryIdentifier, "id")) || `${String(manifest.publisher)}.${String(manifest.name)}`,
        identifier: {
          ...(entryIdentifier ?? {}),
          uuid: field(entryIdentifier, "uuid") ?? field(metadata, "id") ?? undefined,
        },
        uuid: field(entryIdentifier, "uuid") ?? field(metadata, "id") ?? undefined,
        location: loc,
        extensionLocation: loc,
        metadata,
        targetPlatform: field(entry, "targetPlatform"),
        isBuiltin: false,
        isUserBuiltin: false,
        isUnderDevelopment: false,
      };
      const sanitized = sanitizeExtensionForInit(rawExt, authority, runtime.env);
      if (sanitized) out.push(sanitized);
    } catch {
      // Skip malformed entries.
    }
  }
  runtime.logMetrics("metrics/extensions_scan", {
    count: pkgCount,
    total_pkg_bytes: totalPkgBytes,
    max_pkg_bytes: maxPkgBytes,
    max_pkg_path: maxPkgPath,
    total_activation_events: totalActivationEvents,
    total_contrib_keys: totalContribKeys,
  });
  return out;
}

export function workspaceFromFolder(runtime: ExtensionCatalogRuntime, folder: string | null): Record<string, unknown> | null {
  if (!folder) return null;
  const rootPath = String(folder);
  const name = rootPath.split("/").filter(Boolean).slice(-1)[0] || rootPath;
  const id = runtime.sha1Short(rootPath);
  return { configuration: null, id, name, transient: false };
}

export function buildExtHostInitData(runtime: ExtensionCatalogRuntime, options: ExtHostInitOptions): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const envData = isRecord(options.envData) ? options.envData : {};
  const productVersion = typeof options.productVersion === "string" && options.productVersion.trim()
    ? options.productVersion.trim()
    : "0";
  const initData = {
    version: productVersion,
    quality: "stable",
    commit: options.commit ?? undefined,
    date: nowIso,
    parentPid: Number(envData.pid ?? 0) || 0,
    environment: {
      isExtensionDevelopmentDebug: false,
      appRoot: envData.appRoot ?? undefined,
      appName: "code-server",
      appHost: options.useRemote ? "web" : "node",
      appUriScheme: "code-oss",
      isExtensionTelemetryLoggingOnly: false,
      appLanguage: "en",
      extensionDevelopmentLocationURI: undefined,
      extensionTestsLocationURI: undefined,
      globalStorageHome: envData.globalStorageHome,
      workspaceStorageHome: envData.workspaceStorageHome,
      useHostProxy: Boolean(envData.useHostProxy),
    },
    workspace: workspaceFromFolder(runtime, options.folder),
    remote: { isRemote: !!options.useRemote, authority: options.useRemote ? options.authority : undefined, connectionData: null },
    consoleForward: { includeStack: false, logNative: false },
    extensions: buildExtensionsSnapshot(options.scannedExtensions, {
      env: runtime.env,
      excludeIds: String(runtime.env.TE2_EXT_EXCLUDE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
      log: runtime.log,
    }),
    telemetryInfo: {
      sessionId: runtime.randomUuid(),
      machineId: runtime.randomUuid(),
      sqmId: runtime.randomUuid(),
      devDeviceId: runtime.randomUuid(),
      firstSessionDate: nowIso,
      msftInternal: false,
    },
    logLevel: 2,
    loggers: [],
    logsLocation: envData.extensionHostLogsPath ?? envData.logsPath,
    autoStart: true,
    uiKind: options.useRemote ? 2 : 1,
  };
  const extSnap = isRecord(initData.extensions) ? initData.extensions : {};
  runtime.logMetrics("metrics/ext_init", {
    all_extensions: Array.isArray(extSnap.allExtensions) ? extSnap.allExtensions.length : 0,
    my_extensions: Array.isArray(extSnap.myExtensions) ? extSnap.myExtensions.length : 0,
    activation_events_keys: isRecord(extSnap.activationEvents) ? Object.keys(extSnap.activationEvents).length : 0,
  });
  return initData;
}

export async function buildLanguageCatalog(
  runtime: ExtensionCatalogRuntime,
  extensions: unknown[],
): Promise<Record<string, unknown>> {
  const readConfigurationRaw = async (ext: unknown, relativePath: string): Promise<string | null> => {
    try {
      if (typeof relativePath !== "string" || !relativePath.trim()) return null;
      const extLocation = recordField(ext, "extensionLocation");
      const basePath = extLocation ? stringValue(extLocation.path) : null;
      if (!basePath) return null;
      const configPath = runtime.joinPath(basePath, relativePath);
      return await runtime.readTextFile(configPath);
    } catch {
      return null;
    }
  };

  const mergedById = new Map<string, Record<string, unknown>>();
  for (const ext of Array.isArray(extensions) ? extensions : []) {
    const contributes = recordField(ext, "contributes");
    const languages = contributes && Array.isArray(contributes.languages) ? contributes.languages : [];
    if (!languages.length) continue;
    const extId = extensionIdentifierFrom(ext) ?? String(field(ext, "id") ?? "");
    const priority = field(ext, "isBuiltin") === false ? 1 : 0;

    for (const rawLanguage of languages) {
      const language = isRecord(rawLanguage) ? rawLanguage : null;
      const id = typeof language?.id === "string" ? String(language.id).trim() : "";
      if (!id) continue;
      const configurationPath = typeof language?.configuration === "string" ? String(language.configuration) : "";
      const configurationRaw = configurationPath ? await readConfigurationRaw(ext, configurationPath) : null;
      const normalized: Record<string, unknown> = {
        id,
        aliases: arrayOfStrings(language?.aliases),
        extensions: arrayOfStrings(language?.extensions),
        filenames: arrayOfStrings(language?.filenames),
        mimetypes: arrayOfStrings(language?.mimetypes),
        configuration: configurationPath || undefined,
        configuration_raw: configurationRaw || undefined,
        extension: extId,
        source: field(ext, "isBuiltin") === false ? "user" : "builtin",
        _priority: priority,
      };

      const existing = mergedById.get(id);
      if (!existing || priority >= Number(existing._priority || 0)) {
        mergedById.set(id, normalized);
        continue;
      }

      for (const key of ["aliases", "extensions", "filenames", "mimetypes"]) {
        if (!Array.isArray(existing[key]) || !existing[key].length) existing[key] = normalized[key];
      }
      if (!existing.configuration_raw && normalized.configuration_raw) {
        existing.configuration = normalized.configuration;
        existing.configuration_raw = normalized.configuration_raw;
      }
    }
  }

  const languages = Array.from(mergedById.values()).map((entry) => {
    const { _priority, ...rest } = entry;
    return rest;
  });
  if (!languages.length) return { ok: false, error: "language catalog unavailable" };
  return { ok: true, languages };
}
