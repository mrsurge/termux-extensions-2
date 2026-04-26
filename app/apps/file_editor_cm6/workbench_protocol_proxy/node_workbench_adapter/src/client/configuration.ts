export interface RawExtensionConfigDefaults {
  contents: Record<string, unknown>;
  keys: string[];
}

export interface ConfigurationRuntime {
  env: Record<string, string | undefined>;
  extensions: unknown[];
  rawExtensionConfigs: RawExtensionConfigDefaults | null;
  readTextFileSync: (path: string) => string;
  joinPath: (...parts: string[]) => string;
  uriForPath: (path: string, authority: string | null) => Record<string, unknown>;
  log: (...args: unknown[]) => void;
}

interface ConfigurationBuckets {
  all: Record<string, unknown>;
  application: Record<string, unknown>;
  applicationMachine: Record<string, unknown>;
  machine: Record<string, unknown>;
  machineOverridable: Record<string, unknown>;
  window: Record<string, unknown>;
  resource: Record<string, unknown>;
  languageOverridable: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function visitConfigurationNodes(node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!isRecord(node)) return;
  visit(node);
  if (Array.isArray(node.allOf)) {
    for (const child of node.allOf) visitConfigurationNodes(child, visit);
  }
}

function emptyConfigSection(): Record<string, unknown> {
  return { contents: {}, overrides: [], keys: [] };
}

function assignFlatSetting(target: Record<string, unknown>, flatKey: string, value: unknown): boolean {
  const dotIdx = flatKey.indexOf(".");
  if (dotIdx <= 0) return false;
  const section = flatKey.substring(0, dotIdx);
  const prop = flatKey.substring(dotIdx + 1);
  if (!isRecord(target[section])) target[section] = {};
  const parts = prop.split(".");
  let cursor = target[section] as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i] ?? "";
    if (!isRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] ?? ""] = value;
  return true;
}

function parseSettingsObject(parsed: unknown): { contents: Record<string, unknown>; overrides: unknown[]; keys: string[] } {
  const contents: Record<string, unknown> = {};
  const overrides: unknown[] = [];
  const keys: string[] = [];
  if (!isRecord(parsed)) return { contents, overrides, keys };

  for (const [flatKey, value] of Object.entries(parsed)) {
    if (flatKey.startsWith("[") && flatKey.endsWith("]")) {
      if (isRecord(value)) {
        const lang = flatKey.slice(1, -1);
        const overrideKeys = Object.keys(value);
        const overrideContents: Record<string, unknown> = {};
        for (const [overrideKey, overrideValue] of Object.entries(value)) {
          if (!assignFlatSetting(overrideContents, overrideKey, overrideValue)) {
            overrideContents[overrideKey] = overrideValue;
          }
        }
        overrides.push({ identifiers: [lang], keys: overrideKeys, contents: overrideContents });
      }
      continue;
    }
    if (assignFlatSetting(contents, flatKey, value) && !keys.includes(flatKey)) {
      keys.push(flatKey);
    }
  }
  return { contents, overrides, keys };
}

function collectExtensionConfigurationBuckets(extensions: unknown[]): ConfigurationBuckets {
  const buckets: ConfigurationBuckets = {
    all: {},
    application: {},
    applicationMachine: {},
    machine: {},
    machineOverridable: {},
    window: {},
    resource: {},
    languageOverridable: {},
  };
  const addProp = (fullKey: string, rawSchema: unknown): void => {
    if (!fullKey || typeof fullKey !== "string") return;
    if (!isRecord(rawSchema)) return;
    const schema = cloneJsonValue(rawSchema);
    if (!isRecord(schema)) return;
    const scope = String(schema.scope || "window");
    buckets.all[fullKey] = schema;
    switch (scope) {
      case "application":
        buckets.application[fullKey] = schema;
        break;
      case "application-machine":
        buckets.applicationMachine[fullKey] = schema;
        break;
      case "machine":
        buckets.machine[fullKey] = schema;
        break;
      case "machine-overridable":
        buckets.machineOverridable[fullKey] = schema;
        break;
      case "resource":
        buckets.resource[fullKey] = schema;
        break;
      case "language-overridable":
        buckets.resource[fullKey] = schema;
        buckets.languageOverridable[fullKey] = schema;
        break;
      case "window":
      default:
        buckets.window[fullKey] = schema;
        break;
    }
  };

  for (const ext of Array.isArray(extensions) ? extensions : []) {
    if (!isRecord(ext)) continue;
    const packageJson = isRecord(ext.packageJSON) ? ext.packageJSON : null;
    const manifest = packageJson ?? ext;
    const contributes = isRecord(manifest.contributes) ? manifest.contributes : null;
    let configs = contributes?.configuration;
    if (!configs) continue;
    const configList = Array.isArray(configs) ? configs : [configs];
    for (const cfg of configList) {
      visitConfigurationNodes(cfg, (node) => {
        const props = isRecord(node.properties) ? node.properties : null;
        if (!props) return;
        for (const [fullKey, rawSchema] of Object.entries(props)) addProp(fullKey, rawSchema);
      });
    }
  }
  return buckets;
}

function settingsSchemaFlags(): Record<string, unknown> {
  return {
    additionalProperties: true,
    allowTrailingCommas: true,
    allowComments: true,
  };
}

function settingsOverridePatternProperties(): Record<string, unknown> {
  return {
    "^(\\[([^\\]]+)\\])+$": {
      type: "object",
      description: "Configure editor settings to be overridden for a language.",
      errorMessage: "This setting does not support per-language configuration.",
      $ref: "vscode://schemas/settings/resourceLanguage",
    },
  };
}

function mergeSchemaPropertySets(...maps: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  return Object.assign({}, ...maps.filter((map): map is Record<string, unknown> => !!map && typeof map === "object"));
}

export function buildSettingsSchema(runtime: ConfigurationRuntime, kind: string): Record<string, unknown> | null {
  const buckets = collectExtensionConfigurationBuckets(runtime.extensions);
  const flags = settingsSchemaFlags();
  const patternProperties = settingsOverridePatternProperties();
  switch (kind) {
    case "settings/default":
      return { properties: mergeSchemaPropertySets(buckets.all), patternProperties, ...flags };
    case "settings/user":
      return {
        properties: mergeSchemaPropertySets(
          buckets.application,
          buckets.applicationMachine,
          buckets.machine,
          buckets.machineOverridable,
          buckets.window,
          buckets.resource,
        ),
        patternProperties,
        ...flags,
      };
    case "settings/profile":
      return { properties: mergeSchemaPropertySets(buckets.machine, buckets.machineOverridable, buckets.window, buckets.resource), patternProperties, ...flags };
    case "settings/machine":
      return {
        properties: mergeSchemaPropertySets(
          buckets.applicationMachine,
          buckets.machine,
          buckets.machineOverridable,
          buckets.window,
          buckets.resource,
        ),
        patternProperties,
        ...flags,
      };
    case "settings/workspace":
      return { properties: mergeSchemaPropertySets(buckets.machineOverridable, buckets.window, buckets.resource), patternProperties, ...flags };
    case "settings/folder":
      return { properties: mergeSchemaPropertySets(buckets.machineOverridable, buckets.resource), patternProperties, ...flags };
    case "settings/resourceLanguage":
      return { properties: mergeSchemaPropertySets(buckets.languageOverridable), patternProperties: {}, ...flags };
    default:
      return null;
  }
}

export function getVirtualVscodeContent(runtime: ConfigurationRuntime, uri: unknown): string | null {
  if (!isRecord(uri)) return null;
  const scheme = typeof uri.scheme === "string" ? uri.scheme : "";
  const authority = typeof uri.authority === "string" ? uri.authority : "";
  const path = typeof uri.path === "string" ? uri.path : "";
  if (scheme !== "vscode") return null;

  if (authority === "schemas" && path.startsWith("/settings/")) {
    const schemaKind = path.slice(1);
    const schema = buildSettingsSchema(runtime, schemaKind);
    return schema ? JSON.stringify(schema) : null;
  }
  if (authority === "schemas-associations" && path === "/schemas-associations.json") {
    return JSON.stringify({});
  }
  return null;
}

export function readVirtualVscodeUriBuffer(runtime: ConfigurationRuntime, uri: unknown): Uint8Array | null {
  const content = getVirtualVscodeContent(runtime, uri);
  return content == null ? null : new TextEncoder().encode(String(content));
}

export function statVirtualVscodeUri(runtime: ConfigurationRuntime, uri: unknown): Record<string, unknown> | null {
  const content = getVirtualVscodeContent(runtime, uri);
  if (content == null) return null;
  const now = Date.now();
  return { type: 1, size: new TextEncoder().encode(String(content)).length, mtime: now, ctime: now };
}

export function extractExtensionConfigDefaults(scannedExtensions: unknown[], log: (...args: unknown[]) => void): RawExtensionConfigDefaults {
  const allContents: Record<string, unknown> = {};
  const allKeys: string[] = [];
  try {
    const exts = Array.isArray(scannedExtensions) ? scannedExtensions : [];
    for (const ext of exts) {
      if (!isRecord(ext)) continue;
      const packageJson = isRecord(ext.packageJSON) ? ext.packageJSON : null;
      const manifest = packageJson ?? ext;
      const contributes = isRecord(manifest.contributes) ? manifest.contributes : null;
      let configs = contributes?.configuration;
      if (!configs) continue;
      const configList = Array.isArray(configs) ? configs : [configs];
      for (const cfg of configList) {
        if (!isRecord(cfg)) continue;
        const props = isRecord(cfg.properties) ? cfg.properties : null;
        if (!props) continue;
        for (const [fullKey, schema] of Object.entries(props)) {
          if (!fullKey || typeof fullKey !== "string") continue;
          if (!isRecord(schema) || !Object.prototype.hasOwnProperty.call(schema, "default")) continue;
          const dotIdx = fullKey.indexOf(".");
          if (dotIdx <= 0) continue;
          const section = fullKey.substring(0, dotIdx);
          const prop = fullKey.substring(dotIdx + 1);
          if (!isRecord(allContents[section])) allContents[section] = {};
          const parts = prop.split(".");
          let target = allContents[section] as Record<string, unknown>;
          for (let i = 0; i < parts.length - 1; i += 1) {
            const key = parts[i] ?? "";
            if (!isRecord(target[key])) target[key] = {};
            target = target[key] as Record<string, unknown>;
          }
          target[parts[parts.length - 1] ?? ""] = schema.default;
          allKeys.push(fullKey);
        }
      }
    }
  } catch (e) {
    log(`[config] error scanning extension defaults: ${e instanceof Error ? e.message : String(e)}`);
  }
  log(`[config] extracted ${allKeys.length} default keys from ${Array.isArray(scannedExtensions) ? scannedExtensions.length : 0} extensions`);
  return { contents: allContents, keys: allKeys };
}

export function buildConfigurationInitData(runtime: ConfigurationRuntime, folder: string | null, authority: string | null): Record<string, unknown> {
  const empty = emptyConfigSection();
  const extracted = runtime.rawExtensionConfigs ?? { contents: {}, keys: [] };
  const defaults = { contents: { ...extracted.contents }, overrides: [], keys: [...extracted.keys] };

  let userRemote = { contents: {}, overrides: [], keys: [] } as { contents: Record<string, unknown>; overrides: unknown[]; keys: string[] };
  const home = runtime.env.HOME || runtime.env.USERPROFILE || "";
  const settingsPath = runtime.env.TE2_USER_SETTINGS_PATH || (home ? runtime.joinPath(home, ".config/code-server/User/settings.json") : "");
  if (settingsPath) {
    try {
      const parsed = JSON.parse(runtime.readTextFileSync(settingsPath));
      userRemote = parseSettingsObject(parsed);
      runtime.log(`[config] loaded ${userRemote.keys.length} user settings from ${settingsPath}`);
    } catch (e) {
      runtime.log(`[config] could not read user settings (${settingsPath}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let workspaceConfig = { contents: {}, overrides: [], keys: [] } as { contents: Record<string, unknown>; overrides: unknown[]; keys: string[] };
  if (folder) {
    const wsSettingsPath = runtime.joinPath(String(folder), ".vscode", "settings.json");
    try {
      const parsed = JSON.parse(runtime.readTextFileSync(wsSettingsPath));
      workspaceConfig = parseSettingsObject(parsed);
      runtime.log(`[config] loaded ${workspaceConfig.keys.length} workspace settings from ${wsSettingsPath}`);
    } catch (e) {
      if (!isRecord(e) || e.code !== "ENOENT") {
        runtime.log(`[config] could not read workspace settings (${wsSettingsPath}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const data: Record<string, unknown> = {
    defaults,
    policy: empty,
    application: empty,
    userLocal: empty,
    userRemote,
    workspace: workspaceConfig,
    folders: [],
    configurationScopes: [],
  };
  if (folder) {
    const rootPath = String(folder);
    const folderUri = runtime.uriForPath(rootPath, authority);
    data.folders = [[folderUri, { contents: { ...workspaceConfig.contents }, overrides: [...workspaceConfig.overrides], keys: [...workspaceConfig.keys] }]];
  }
  return data;
}
