export const RPC_DEFAULTS = {
  MainThreadConsole: 12,
  MainThreadLogger: 27,
  MainThreadOutputService: 29,
  MainThreadStatusBar: 33,
  MainThreadWebviews: 43,
  MainThreadWebviewViews: 45,
  MainThreadExtensionService: 50,
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
  ExtHostWebviews: 118,
  ExtHostWebviewViews: 121,
} as const;

export type RpcIdName = keyof typeof RPC_DEFAULTS;
export type RpcIds = Record<RpcIdName, number>;

export interface LoadRpcIdsOptions {
  env?: Record<string, string | undefined>;
  readText?: (filePath: string) => string;
  log?: (message: string) => void;
}

export interface LoadedRpcIds {
  ids: RpcIds;
  source: string;
  configPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function loadRpcIds(options: LoadRpcIdsOptions = {}): LoadedRpcIds {
  const env = options.env ?? {};
  const readText = options.readText;
  const log = options.log ?? (() => undefined);
  const configPath = String(env.TE2_RPC_CONFIG_PATH ?? "").trim();
  const ids: RpcIds = { ...RPC_DEFAULTS };
  let source = "hardcoded-defaults";

  if (!configPath) {
    log("[rpc-config] TE2_RPC_CONFIG_PATH is unset, using hardcoded defaults");
    return { ids, source, configPath };
  }

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
