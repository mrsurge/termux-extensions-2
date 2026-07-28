import type { WorkbenchDocumentRegistry } from "../workspace/document-registry";

export interface LocalFsStatsLike {
  size?: unknown;
  mtimeMs?: unknown;
  ctimeMs?: unknown;
  isFile?: () => boolean;
  isDirectory?: () => boolean;
  isSymbolicLink?: () => boolean;
}

export interface DocumentContentPendingOptions {
  timeoutMs: number;
  timeoutMessage: string;
}

export interface DocumentContentRuntime {
  extConnected: () => boolean;
  useRemote: boolean;
  defaultAuthority: string;
  extRpcIds: {
    ExtHostDocumentContentProviders: number;
  };
  documentRegistry: WorkbenchDocumentRegistry;
  readTextFile: (path: string) => Promise<string>;
  readBinaryFile: (path: string) => Promise<Uint8Array>;
  statPath: (path: string) => Promise<LocalFsStatsLike>;
  languageIdFromPath: (path: string) => string;
  sendExt: (rpcId: number, method: string, args: unknown[], cancellable?: boolean) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: DocumentContentPendingOptions,
  ) => { promise: Promise<unknown> };
  log: (...args: unknown[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function replyType(reply: unknown): number | null {
  const type = field(reply, "type");
  return typeof type === "number" ? type : null;
}

function replyResult(reply: unknown): unknown {
  return field(reply, "result");
}

function replyError(reply: unknown): unknown {
  return field(reply, "error");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function uriForPath(useRemote: boolean, pathStr: string, authority: string): Record<string, unknown> {
  const path = String(pathStr);
  if (useRemote) {
    return {
      $mid: 1,
      fsPath: path,
      external: `vscode-remote://${authority}${path}`,
      path,
      scheme: "vscode-remote",
      authority,
    };
  }
  return {
    $mid: 1,
    fsPath: path,
    external: `file://${path}`,
    path,
    scheme: "file",
  };
}

export function uriObjToStringSafe(uri: unknown): string {
  if (!isRecord(uri)) return String(uri ?? "");
  const external = stringValue(uri.external);
  if (external) return external;
  const scheme = stringValue(uri.scheme) ?? "";
  const authority = stringValue(uri.authority) ?? "";
  const path = stringValue(uri.path) || stringValue(uri.fsPath) || "";
  if (scheme) return `${scheme}://${authority}${path}`;
  return path;
}

export function fsPathFromUri(uri: unknown): string | null {
  if (!isRecord(uri)) return null;
  const scheme = stringValue(uri.scheme) ?? "";
  if (scheme === "vscode") return null;
  return stringValue(uri.fsPath) || stringValue(uri.path) || null;
}

export function statPayloadFromFsStats(stats: LocalFsStatsLike): Record<string, unknown> {
  let type = 0;
  if (typeof stats?.isFile === "function" && stats.isFile()) type |= 1;
  else if (typeof stats?.isDirectory === "function" && stats.isDirectory()) type |= 2;
  if (typeof stats?.isSymbolicLink === "function" && stats.isSymbolicLink()) type |= 64;
  return {
    type,
    size: Number(stats?.size ?? 0),
    mtime: Number.isFinite(Number(stats?.mtimeMs)) ? Number(stats.mtimeMs) : Date.now(),
    ctime: Number.isFinite(Number(stats?.ctimeMs)) ? Number(stats.ctimeMs) : Date.now(),
  };
}

export async function readLocalUriBuffer(runtime: DocumentContentRuntime, uri: unknown): Promise<Uint8Array> {
  const fsPath = fsPathFromUri(uri);
  if (!fsPath) throw new Error(`no local fs path for ${uriObjToStringSafe(uri)}`);
  return await runtime.readBinaryFile(fsPath);
}

export async function statLocalUri(runtime: DocumentContentRuntime, uri: unknown): Promise<Record<string, unknown>> {
  const fsPath = fsPathFromUri(uri);
  if (!fsPath) throw new Error(`no local fs path for ${uriObjToStringSafe(uri)}`);
  const stats = await runtime.statPath(fsPath);
  return statPayloadFromFsStats(stats);
}

export async function provideTextDocumentContent(
  runtime: DocumentContentRuntime,
  handle: number,
  uri: unknown,
): Promise<string | null> {
  if (!runtime.extConnected()) throw new Error("not connected");
  const { promise } = runtime.sendExtPending(
    runtime.extRpcIds.ExtHostDocumentContentProviders,
    "$provideTextDocumentContent",
    [handle, uri],
    true,
    { timeoutMs: 5000, timeoutMessage: "timed out waiting for $provideTextDocumentContent" },
  );
  const reply = await promise;
  const type = replyType(reply);
  if (type === 9) {
    const result = replyResult(reply);
    return typeof result === "string" ? result : JSON.stringify(result);
  }
  if (type === 8) {
    const result = replyResult(reply);
    if (result instanceof Uint8Array) return new TextDecoder().decode(result);
    return result == null ? null : String(result);
  }
  if (type === 11) {
    const error = replyError(reply);
    throw new Error(errorMessage(isRecord(error) ? error.message ?? error : error));
  }
  return null;
}

export async function tryOpenDocument(
  runtime: DocumentContentRuntime,
  uri: unknown,
  options: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (!runtime.extConnected()) throw new Error("not connected");
  const uriObj = isRecord(uri) ? uri : null;
  if (!uriObj) throw new Error("missing uri");
  const uriStr = uriObjToStringSafe(uriObj);
  const fsPath = fsPathFromUri(uriObj);
  if (!fsPath) throw new Error(`unsupported document uri: ${uriStr}`);

  const existing =
    runtime.documentRegistry.getByPath(fsPath) ??
    runtime.documentRegistry.getByUri(uriObj);
  if (!existing) {
    const text = await runtime.readTextFile(fsPath);
    const normalizedText = text.replace(/\r\n/g, "\n");
    const languageId = runtime.languageIdFromPath(fsPath) || "plaintext";
    const encoding = typeof options?.encoding === "string" && options.encoding ? options.encoding : "utf8";
    const retained = runtime.documentRegistry.retain({
      path: fsPath,
      uri: uriObj,
      text: normalizedText,
      languageId,
      role: "background",
      dirty: false,
      encoding,
    });
    runtime.log(
      `[schema_doc] opened background document uri=${uriStr} lines=${retained.entry.lineCount} lang=${languageId}`,
    );
  }
  return uriObj;
}
