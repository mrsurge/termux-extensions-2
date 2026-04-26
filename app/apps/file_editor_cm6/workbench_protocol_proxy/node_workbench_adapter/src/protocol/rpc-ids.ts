export const RPC_DEFAULTS = {
  MainThreadOutputService: 29,
  MainThreadDocumentContentProviders: 18,
  ExtHostConfiguration: 80,
  ExtHostDocumentsAndEditors: 84,
  ExtHostDocuments: 85,
  ExtHostDocumentContentProviders: 86,
  ExtHostEditors: 88,
  ExtHostFileSystemInfo: 91,
  ExtHostLanguages: 93,
  ExtHostLanguageFeatures: 94,
  ExtHostStatusBar: 97,
  ExtHostExtensionService: 99,
  ExtHostWorkspace: 106,
  ExtHostEditorTabs: 113,
  ExtHostOutputService: 122,
} as const;

export type RpcIdName = keyof typeof RPC_DEFAULTS;
export type RpcIds = Record<RpcIdName, number>;

export interface LoadRpcIdsOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  readText?: (filePath: string) => string;
  joinPath?: (...parts: string[]) => string;
  log?: (message: string) => void;
}

export interface LoadedRpcIds {
  ids: RpcIds;
  source: string;
  configPath: string;
}

function defaultJoinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function loadRpcIds(options: LoadRpcIdsOptions = {}): LoadedRpcIds {
  const env = options.env ?? {};
  const readText = options.readText;
  const joinPath = options.joinPath ?? defaultJoinPath;
  const log = options.log ?? (() => undefined);
  const configPath = env.TE2_RPC_CONFIG_PATH || joinPath(options.homeDir || env.HOME || "", ".config/code-server/te2_rpc_config.json");
  const ids: RpcIds = { ...RPC_DEFAULTS };
  let source = "hardcoded-defaults";

  if (!readText) {
    log("[rpc-config] no readText callback, using hardcoded defaults");
    return { ids, source, configPath };
  }

  try {
    const raw = readText(configPath);
    const cfg = JSON.parse(raw) as unknown;
    if (!isRecord(cfg) || !isRecord(cfg.nids)) {
      log(`[rpc-config] ${configPath} present but missing nids object, using defaults`);
      return { ids, source, configPath };
    }

    let applied = 0;
    for (const name of Object.keys(RPC_DEFAULTS) as RpcIdName[]) {
      const value = cfg.nids[name];
      if (typeof value === "number" && Number.isFinite(value)) {
        ids[name] = value;
        applied += 1;
      }
    }
    const version = typeof cfg.code_server_version === "string" ? cfg.code_server_version : "?";
    source = `rpc-config.json (code-server ${version}, ${applied}/${Object.keys(RPC_DEFAULTS).length} applied)`;
    log(`[rpc-config] loaded from ${configPath} - ${source}`);
    return { ids, source, configPath };
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") {
      log(`[rpc-config] no config file at ${configPath}, using hardcoded defaults`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      log(`[rpc-config] failed to load ${configPath}: ${message}, using hardcoded defaults`);
    }
    return { ids, source, configPath };
  }
}
