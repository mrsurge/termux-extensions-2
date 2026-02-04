import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { VSBuffer } from "./vscode_oss_runtime/base/common/buffer.mjs";
import { NodeSocketFactory } from "./vscode_oss_runtime/platform/remote/browser/browserSocketFactory.mjs";
import { ConnectionType, connectToRemoteAgent, createNoopSignService } from "./vscode_oss_runtime/platform/remote/common/remoteAgentConnection.mjs";
import { IpcPromiseClient } from "./vscode_oss_runtime/base/parts/ipc/common/ipc.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function writeVqlUnsigned(n) {
  let v = n >>> 0;
  const bytes = [];
  while (true) {
    let b = v & 0x7f;
    v = v >>> 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
    if (v === 0) break;
  }
  return Buffer.from(bytes);
}

function encodeMgmtValue(v) {
  // Subset used by VS Code IPC:
  // 0 undefined
  // 1 string (vql len + bytes)
  // 4 array (vql length + values)
  // 5 object (vql len + json bytes)
  // 6 int (vql)
  if (v === undefined || v === null) return Buffer.from([0]);
  if (typeof v === "string") {
    const s = Buffer.from(v, "utf8");
    return Buffer.concat([Buffer.from([1]), writeVqlUnsigned(s.length), s]);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return Buffer.concat([Buffer.from([6]), writeVqlUnsigned(v | 0)]);
  }
  if (Array.isArray(v)) {
    const parts = [Buffer.from([4]), writeVqlUnsigned(v.length)];
    for (const x of v) parts.push(encodeMgmtValue(x));
    return Buffer.concat(parts);
  }
  if (typeof v === "object") {
    const raw = Buffer.from(JSON.stringify(v), "utf8");
    return Buffer.concat([Buffer.from([5]), writeVqlUnsigned(raw.length), raw]);
  }
  const raw = Buffer.from(JSON.stringify(v), "utf8");
  return Buffer.concat([Buffer.from([5]), writeVqlUnsigned(raw.length), raw]);
}

function encodeMgmtMessage(header, body) {
  return Buffer.concat([encodeMgmtValue(header), encodeMgmtValue(body)]);
}

function encodeExtRequestJsonArgs({ req, rpcId, method, args, cancellable }) {
  const t = cancellable ? 2 : 1;
  const methodB = Buffer.from(method, "utf8");
  const argsB = Buffer.from(JSON.stringify(args ?? []), "utf8");
  if (methodB.length > 255) throw new Error("method too long");
  return Buffer.concat([
    Buffer.from([t]),
    u32be(req),
    Buffer.from([rpcId & 0xff]),
    Buffer.from([methodB.length]),
    methodB,
    u32be(argsB.length),
    argsB,
  ]);
}

function encodeExtRequestMixedArgs({ req, rpcId, method, args, cancellable }) {
  const t = cancellable ? 4 : 3;
  const methodB = Buffer.from(method, "utf8");
  if (methodB.length > 255) throw new Error("method too long");
  const a = Array.isArray(args) ? args : [];
  const parts = [
    Buffer.from([t]),
    u32be(req),
    Buffer.from([rpcId & 0xff]),
    Buffer.from([methodB.length]),
    methodB,
    u32be(a.length),
  ];
  for (const v of a) {
    if (v === null || typeof v === "undefined") {
      parts.push(Buffer.from([4])); // null/undefined
      continue;
    }
    if (typeof v === "string") {
      const b = Buffer.from(v, "utf8");
      parts.push(Buffer.from([1]), u32be(b.length), b);
      continue;
    }
    // everything else: JSON
    const raw = Buffer.from(JSON.stringify(v), "utf8");
    parts.push(Buffer.from([2]), u32be(raw.length), raw);
  }
  return Buffer.concat(parts);
}

function encodeExtReplyOkEmpty(req) {
  return Buffer.concat([Buffer.from([7]), u32be(req)]);
}

function encodeExtAck(req) {
  return Buffer.concat([Buffer.from([5]), u32be(req)]);
}

function encodeExtReplyOkJson(req, result) {
  const jsonB = Buffer.from(JSON.stringify(result ?? null), "utf8");
  return Buffer.concat([Buffer.from([9]), u32be(req), u32be(jsonB.length), jsonB]);
}

function decodeExtHostRpc(payload) {
  if (!payload || payload.length < 5) return { kind: "ext", error: "short" };
  const msgType = payload[0];
  const req = payload.readUInt32BE(1);
  let off = 5;

  const readU8 = () => payload[off++];
  const readU32 = () => {
    const v = payload.readUInt32BE(off);
    off += 4;
    return v >>> 0;
  };
  const readBytes = (n) => {
    const b = payload.subarray(off, off + n);
    off += n;
    return b;
  };
  const readShortString = () => {
    const ln = readU8();
    return readBytes(ln).toString("utf8");
  };
  const readLongString = () => {
    const ln = readU32();
    return readBytes(ln).toString("utf8");
  };
  const readMixedArray = () => {
    const count = readU32();
    const out = [];
    for (let i = 0; i < count; i++) {
      const argType = readU8();
      if (argType === 1) out.push(readLongString()); // string
      else if (argType === 2) out.push(JSON.parse(readLongString() || "null")); // object json
      else if (argType === 3) {
        const bufCount = readU32();
        const raw = readLongString();
        for (let j = 0; j < bufCount; j++) {
          const bln = readU32();
          readBytes(bln);
        }
        try {
          out.push({ __json_with_buffers__: JSON.parse(raw || "null"), buffers: bufCount });
        } catch {
          out.push({ __json_with_buffers_parse_error__: true, buffers: bufCount });
        }
      } else if (argType === 4) out.push(null);
      else out.push({ __unknown_arg_type__: argType });
    }
    return out;
  };

  try {
    if (msgType === 1 || msgType === 2) {
      const rpcId = readU8();
      const method = readShortString();
      const argsRaw = readLongString();
      const args = argsRaw ? JSON.parse(argsRaw) : [];
      return { kind: "ext", type: msgType, req, rpcId, method, args, cancellable: msgType === 2 };
    }
    if (msgType === 3 || msgType === 4) {
      const rpcId = readU8();
      const method = readShortString();
      const args = readMixedArray();
      return { kind: "ext", type: msgType, req, rpcId, method, args, cancellable: msgType === 4 };
    }
    if (msgType === 9) {
      const resRaw = readLongString();
      return { kind: "ext", type: msgType, req, result: resRaw ? JSON.parse(resRaw) : null };
    }
    if (msgType === 11) {
      const errRaw = readLongString();
      return { kind: "ext", type: msgType, req, error: errRaw ? JSON.parse(errRaw) : null };
    }
    return { kind: "ext", type: msgType, req };
  } catch (e) {
    return { kind: "ext", type: msgType, req, error: `decode_fail:${String(e?.message ?? e)}` };
  }
}

export class WorkbenchClient {
  constructor({ onEvent } = {}) {
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.mgmt = null; // { protocol }
    this.ext = null; // { protocol }
    this._mgmtIpc = null;
    this._connecting = false;
    this._pendingExt = new Map(); // req -> {resolve,reject}
    this._signService = createNoopSignService();
    this._debugExtReqSeen = 0;
    this._debugExtReplySeen = 0;
    this._debugMainThreadReplySeen = 0;
    this._nextExtReqId = 1;
    this._extHandshake = { readySeen: false, initSent: false, initialized: false };
    this._sentExtMeta = new Map(); // req -> {rpcId, method, ts_ms}
    this._sentExtMetaOrder = [];
    this._nextModelNumber = 1;
    this._useRemote = true;
    this._authority = "localhost:8000";
    this.state = {
      connected: false,
      ready: false,
      docSymbolsProviderHandle: null,
      hoverProviderHandle: null,
    };
  }

  _allocExtReqId() {
    const id = this._nextExtReqId >>> 0;
    this._nextExtReqId = (this._nextExtReqId + 1) >>> 0;
    return id === 0 ? this._allocExtReqId() : id;
  }

  _sendExt(rpcId, method, args, cancellable = false) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({ req, rpcId, method, args, cancellable });
    this.ext.protocol.send(VSBuffer.wrap(payload));
    this._sentExtMeta.set(req, { rpcId, method, ts_ms: Date.now() });
    this._sentExtMetaOrder.push(req);
    while (this._sentExtMetaOrder.length > 500) {
      const oldest = this._sentExtMetaOrder.shift();
      this._sentExtMeta.delete(oldest);
    }
    try {
      this.onEvent({ type: "ext/send", ts_ms: Date.now(), req, rpcId, method });
    } catch {}
    return req;
  }

  _sendExtMixed(rpcId, method, args, cancellable = false) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const req = this._allocExtReqId();
    const payload = encodeExtRequestMixedArgs({ req, rpcId, method, args, cancellable });
    this.ext.protocol.send(VSBuffer.wrap(payload));
    this._sentExtMeta.set(req, { rpcId, method, ts_ms: Date.now() });
    this._sentExtMetaOrder.push(req);
    while (this._sentExtMetaOrder.length > 500) {
      const oldest = this._sentExtMetaOrder.shift();
      this._sentExtMeta.delete(oldest);
    }
    try {
      this.onEvent({ type: "ext/send", ts_ms: Date.now(), req, rpcId, method, encoding: "mixed" });
    } catch {}
    return req;
  }

  status() {
    return { ...this.state };
  }

  async _discoverServerRootPath(httpBase, folder) {
    const url = new URL("/", httpBase);
    if (folder) url.searchParams.set("folder", folder);
    const resp = await fetch(url, { headers: { accept: "text/html", "accept-encoding": "identity" } });
    const text = await resp.text();
    const m = text.match(/(stable-[0-9a-f]{40})/);
    if (!m) return "/";
    return `/${m[1]}`;
  }

  _commitFromServerRootPath(serverRootPath) {
    const m = String(serverRootPath).match(/^\/stable-([0-9a-f]{40})$/);
    return m ? m[1] : null;
  }

  _buildExtensionsSnapshot(scannedExtensions) {
    const includeBuiltin = String(process.env.TE2_INCLUDE_BUILTIN_EXTS || "").toLowerCase() === "1";
    const all = Array.isArray(scannedExtensions)
      ? scannedExtensions.filter((ext) => includeBuiltin || ext?.isBuiltin === false)
      : [];
    const activationEvents = {};
    const myExtensions = [];
    const seenMy = new Set();
    for (const ext of all) {
      const ident = this._extensionIdentifierFrom(ext);
      const key = ident ?? null;
      if (!key) continue;
      const ev = Array.isArray(ext?.activationEvents) ? ext.activationEvents : [];
      activationEvents[String(key)] = ev;
      const eligible = includeBuiltin || ext?.isBuiltin === false;
      if (ident && eligible) {
        const dedupeKey = String(ident).toLowerCase();
        if (!seenMy.has(dedupeKey)) {
          seenMy.add(dedupeKey);
          myExtensions.push(ident);
        }
      }
    }
    return { versionId: 1, allExtensions: all, activationEvents, myExtensions };
  }

  async _scanExtensionsFromDisk(authority) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const jsonPath =
      process.env.TE2_EXTENSIONS_JSON ||
      (home ? path.join(home, ".config/code-server/extensions/extensions.json") : null);
    if (!jsonPath) throw new Error("No HOME for extensions.json");
    const raw = await fs.readFile(jsonPath, "utf8");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    const out = [];
    for (const entry of entries) {
      try {
        const loc = entry?.location;
        const locPath = loc?.path;
        if (!locPath) continue;
        const pkgPath = path.join(locPath, "package.json");
        const pkgRaw = await fs.readFile(pkgPath, "utf8");
        const manifest = JSON.parse(pkgRaw);
        const id = entry?.identifier?.id || `${manifest.publisher}.${manifest.name}`;
        const identifier = { value: id, _lower: String(id).toLowerCase() };
        const targetPlatform = entry?.metadata?.targetPlatform || entry?.targetPlatform || "unknown";
        const remoteLoc = authority
          ? { scheme: "vscode-remote", authority, path: locPath, query: loc?.query, fragment: loc?.fragment }
          : loc;
        out.push({
          ...manifest,
          id,
          identifier,
          uuid: entry?.identifier?.uuid,
          publisherDisplayName: entry?.metadata?.publisherDisplayName,
          targetPlatform,
          isBuiltin: false,
          isUserBuiltin: false,
          isUnderDevelopment: false,
          extensionLocation: remoteLoc,
          preRelease: Boolean(entry?.metadata?.preRelease),
        });
      } catch {
        // Skip malformed entries.
      }
    }
    return out;
  }

  _extensionIdentifierFrom(ext) {
    const ident = ext?.identifier ?? null;
    if (typeof ident === "string") return ident;
    if (ident && typeof ident === "object") {
      if (typeof ident.value === "string") return ident.value;
      if (typeof ident.id === "string") return ident.id;
    }
    const id = ext?.id ?? ext?.extensionId ?? ext?.identifier?.value ?? ext?.identifier?.id ?? null;
    if (typeof id === "string" && id) return id;
    return null;
  }

  _workspaceFromFolder(folder, authority) {
    if (!folder) return null;
    const rootPath = String(folder);
    const name = rootPath.split("/").filter(Boolean).slice(-1)[0] || rootPath;
    const id = crypto.createHash("sha1").update(rootPath).digest("hex").slice(0, 7);
    const configuration = null; // folder workspace (not .code-workspace)
    return { configuration, id, name, transient: false };
  }

  _uriForPath(pathStr, authority) {
    const p = String(pathStr);
    if (this._useRemote) {
      return {
        $mid: 1,
        fsPath: p,
        external: `vscode-remote://${authority}${p}`,
        path: p,
        scheme: "vscode-remote",
        authority,
      };
    }
    return {
      $mid: 1,
      fsPath: p,
      external: `file://${p}`,
      path: p,
      scheme: "file",
    };
  }

  _emptyConfigSection() {
    return { contents: {}, overrides: [], keys: [] };
  }

  _buildConfigurationInitData(folder, authority) {
    const empty = this._emptyConfigSection();
    const data = {
      defaults: empty,
      policy: empty,
      application: empty,
      userLocal: empty,
      userRemote: empty,
      workspace: empty,
      folders: [],
      configurationScopes: [],
    };
    if (folder) {
      const rootPath = String(folder);
      const folderUri = this._uriForPath(rootPath, authority);
      data.folders = [[folderUri, empty]];
    }
    return data;
  }

  _buildExtHostInitData({ authority, commit, envData, scannedExtensions, folder, useRemote }) {
    // Best-effort minimal IExtensionHostInitData, sufficient for remote Extension Host handshake.
    const nowIso = new Date().toISOString();
    return {
      version: "0",
      quality: "stable",
      commit: commit ?? undefined,
      date: nowIso,
      parentPid: Number(envData?.pid ?? 0) || 0,
      environment: {
        isExtensionDevelopmentDebug: false,
        appRoot: envData?.appRoot ?? undefined,
        appName: "code-server",
        appHost: useRemote ? "web" : "node",
        appUriScheme: "code-oss",
        isExtensionTelemetryLoggingOnly: false,
        appLanguage: "en",
        extensionDevelopmentLocationURI: undefined,
        extensionTestsLocationURI: undefined,
        globalStorageHome: envData?.globalStorageHome,
        workspaceStorageHome: envData?.workspaceStorageHome,
        useHostProxy: Boolean(envData?.useHostProxy),
      },
      workspace: this._workspaceFromFolder(folder, authority),
      remote: { isRemote: !!useRemote, authority: useRemote ? authority : undefined, connectionData: null },
      consoleForward: { includeStack: false, logNative: false },
      extensions: this._buildExtensionsSnapshot(scannedExtensions),
      telemetryInfo: {
        sessionId: crypto.randomUUID(),
        machineId: crypto.randomUUID(),
        sqmId: crypto.randomUUID(),
        devDeviceId: crypto.randomUUID(),
        firstSessionDate: nowIso,
        msftInternal: false,
      },
      logLevel: 2, // Info
      loggers: [],
      logsLocation: envData?.extensionHostLogsPath ?? envData?.logsPath,
      autoStart: true,
      uiKind: useRemote ? 2 : 1, // Web vs Desktop/Node
    };
  }

  async connect(params = {}) {
    if (this._connecting) throw new Error("already connecting");
    this._connecting = true;
    try {
      const proxyHttp = params.proxyHttp ?? "http://127.0.0.1:8000";
      const token = params.token ?? "00000000000000000000";
      const folder = params.folder ?? null;
      const authority = params.authority ?? "localhost:8000";
      const useRemote = params.useRemote ?? (String(process.env.TE2_USE_REMOTE || "1") === "1");
      const serverRootPath = params.serverRootPath ?? (await this._discoverServerRootPath(proxyHttp, folder));
      const commit = params.commit ?? this._commitFromServerRootPath(serverRootPath);
      const workspaceTrusted = params.workspaceTrusted ?? true;

      this._useRemote = !!useRemote;
      this._authority = authority;

      const proxyUrl = new URL(proxyHttp);
      const wsSchema = proxyUrl.protocol === "https:" ? "wss" : "ws";
      const socketFactory = new NodeSocketFactory({ wsSchema, basePathname: proxyUrl.pathname });
      const connectTo = {
        host: proxyUrl.hostname,
        port: Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80)),
      };

      const mgmt = await connectToRemoteAgent({
        socketFactory,
        connectTo,
        serverRootPath,
        reconnectionToken: crypto.randomUUID(),
        connectionToken: token,
        commit,
        desiredConnectionType: ConnectionType.Management,
        args: undefined,
        signService: this._signService,
        timeoutMs: 15000,
        debugLabel: `renderer-Management-${crypto.randomUUID().slice(0, 8)}`,
      });
      this.mgmt = { protocol: mgmt.protocol };

      // Bootstrap mgmt IPC using the same serialization as VS Code IPCClient.
      this._mgmtIpc?.dispose?.();
      this._mgmtIpc = new IpcPromiseClient(this.mgmt.protocol, { remoteAuthority: authority, clientId: "renderer" });
      await this._mgmtIpc.whenInitialized(15000);
      let envData = null;
      try {
        envData = await this._mgmtIpc.call("remoteextensionsenvironment", "getEnvironmentData", { remoteAuthority: authority });
        this.onEvent({ type: "mgmt/getEnvironmentData", ts_ms: Date.now(), ok: true, pid: envData?.pid ?? null });
      } catch (e) {
        this.onEvent({ type: "mgmt/getEnvironmentData", ts_ms: Date.now(), ok: false, error: String(e?.message ?? e) });
      }

      let scannedExtensions = [];
      try {
        const source = String(process.env.TE2_EXTENSIONS_SOURCE || "scan").toLowerCase();
        if (source === "disk") {
          scannedExtensions = await this._scanExtensionsFromDisk(useRemote ? authority : null);
          this.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: true, count: Array.isArray(scannedExtensions) ? scannedExtensions.length : null, source: "disk" });
        } else {
          // Mirror VS Code RemoteExtensionsScannerService.scanExtensions() argument order.
          scannedExtensions = await this._mgmtIpc.call("remoteExtensionsScanner", "scanExtensions", ["en", null, [], null, null]);
          const includeBuiltin = String(process.env.TE2_INCLUDE_BUILTIN_EXTS || "").toLowerCase() === "1";
          if (Array.isArray(scannedExtensions)) {
            scannedExtensions = scannedExtensions.filter((ext) => includeBuiltin || ext?.isBuiltin === false);
          }
          this.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: true, count: Array.isArray(scannedExtensions) ? scannedExtensions.length : null, source: "scan" });
        }
      } catch (e) {
        this.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: false, error: String(e?.message ?? e) });
      }
      try {
        await this._mgmtIpc.call("remoteExtensionsScanner", "whenExtensionsReady", undefined);
        this.onEvent({ type: "mgmt/whenExtensionsReady", ts_ms: Date.now(), ok: true });
      } catch (e) {
        this.onEvent({ type: "mgmt/whenExtensionsReady", ts_ms: Date.now(), ok: false, error: String(e?.message ?? e) });
      }

      const proxyUri = params.proxyUri ?? `http://${authority}/proxy/{{port}}/`;
      const extArgs = { language: "en", break: false, port: null, env: { VSCODE_PROXY_URI: proxyUri } };

      const workspaceRoot = params.workspaceFolder ?? params.folder ?? folder ?? null;
      const extInitData = this._buildExtHostInitData({
        authority: useRemote ? authority : null,
        commit,
        envData,
        scannedExtensions,
        folder: workspaceRoot,
        useRemote,
      });

      const ext = await connectToRemoteAgent({
        socketFactory,
        connectTo,
        serverRootPath,
        reconnectionToken: crypto.randomUUID(),
        connectionToken: token,
        commit,
        desiredConnectionType: ConnectionType.ExtensionHost,
        args: extArgs,
        signService: this._signService,
        timeoutMs: 15000,
        debugLabel: `renderer-ExtensionHost-${crypto.randomUUID().slice(0, 8)}`,
      });
      this.ext = { protocol: ext.protocol };

      this.state.connected = true;
      this.state.ready = false;
      this.state.docSymbolsProviderHandle = null;
      this.state.hoverProviderHandle = null;
      this._nextExtReqId = 1;
      this._debugExtReqSeen = 0;
      this._extHandshake = { readySeen: false, initSent: false, initialized: false };

      const extHandshakeReady = new Promise((resolve, reject) => {
        const startMs = Date.now();
        const t = setTimeout(() => reject(new Error("ext host handshake timeout")), 60000);
        const d = this.ext.protocol.onMessage((payloadVsBuf) => {
          const b = payloadVsBuf?.buffer;
          if (!b || b.length !== 1) return;
          const v = b[0];
          if (v === 2) {
            this._extHandshake.readySeen = true;
            if (!this._extHandshake.initSent) {
              this._extHandshake.initSent = true;
              this.onEvent({ type: "ext/handshake_ready", ts_ms: Date.now(), after_ms: Date.now() - startMs });
              try {
                this.ext?.protocol.send(VSBuffer.fromString(JSON.stringify(extInitData)));
                this.onEvent({ type: "ext/handshake_init_sent", ts_ms: Date.now(), bytes: JSON.stringify(extInitData).length });
              } catch (e) {
                clearTimeout(t);
                d.dispose?.();
                reject(e);
              }
            }
          } else if (v === 1) {
            this._extHandshake.initialized = true;
            clearTimeout(t);
            d.dispose?.();
            this.onEvent({ type: "ext/handshake_initialized", ts_ms: Date.now(), after_ms: Date.now() - startMs });
            resolve();
          } else if (v === 3) {
            // Terminate
          }
        });
      });

      this.ext.protocol.onMessage((payloadVsBuf) => {
        // Extension Host handshake messages are single-byte payloads (Ready/Initialized/Terminate).
        const b0 = payloadVsBuf?.buffer;
        if (b0 && b0.length === 1) {
          // handled by extHandshakeReady listener (kept separate to keep logic simple)
          return;
        }
        if (!this._extHandshake.initialized) {
          // Ignore any non-handshake payloads until extension host is initialized.
          return;
        }
        const msg = decodeExtHostRpc(payloadVsBuf.buffer);
        if (msg.kind !== "ext") return;

        // server->client request
        if (msg.type === 1 || msg.type === 2 || msg.type === 3 || msg.type === 4) {
          if (this._debugExtReqSeen < 200) {
            this._debugExtReqSeen++;
            const ev = { type: "ext/request", ts_ms: Date.now(), req: msg.req, rpcId: msg.rpcId, method: msg.method };
            const logArgsMethods = new Set([
              "$onWillActivateExtension",
              "$onDidActivateExtension",
              "$onExtensionActivationError",
              "$publicLog2",
              "$initializeExtensionStorage",
              "$registerDocumentSymbolProvider",
              "$registerHoverProvider",
            ]);
            if (logArgsMethods.has(msg.method)) {
              ev.args = msg.args;
            }
            this.onEvent(ev);
          }

          // RPCProtocol expects an immediate ACK for every request.
          try {
            this.ext?.protocol.send(VSBuffer.wrap(encodeExtAck(msg.req)));
          } catch {}

          // Learn provider handles.
          if (msg.method === "$registerDocumentSymbolProvider" && Array.isArray(msg.args) && msg.args.length >= 2) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            if (Number.isFinite(handle) && Array.isArray(selector)) {
              for (const s of selector) {
                if (s && typeof s === "object" && s.language === "python") {
                  this.state.docSymbolsProviderHandle = handle;
                  this.state.ready = true;
                  this.onEvent({ type: "provider/documentSymbols", ts_ms: Date.now(), handle, language: "python" });
                  break;
                }
              }
            }
          }
          if (msg.method === "$registerHoverProvider" && Array.isArray(msg.args) && msg.args.length >= 2) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            if (Number.isFinite(handle) && Array.isArray(selector)) {
              for (const s of selector) {
                if (s && typeof s === "object" && s.language === "python") {
                  this.state.hoverProviderHandle = handle;
                  this.state.ready = true;
                  this.onEvent({ type: "provider/hover", ts_ms: Date.now(), handle, language: "python" });
                  break;
                }
              }
            }
          }

          // Diagnostics.
          if (msg.method === "$changeMany") {
            this.onEvent({ type: "diagnostics/changeMany", ts_ms: Date.now(), args: msg.args });
          }

          // Reply to required calls with correct result shape (based on browser trace).
          let replyPayload;
          if (msg.method === "$getInitialState") {
            replyPayload = encodeExtReplyOkJson(msg.req, { isFocused: true, isActive: true });
          } else if (msg.method === "$checkExists") {
            replyPayload = encodeExtReplyOkJson(msg.req, false);
          } else if (msg.method === "$requestWorkspaceTrust") {
            replyPayload = encodeExtReplyOkJson(msg.req, true);
            try {
              this._sendExt(106, "$onDidGrantWorkspaceTrust", [], false);
            } catch {}
          } else if (msg.method === "$getTools") {
            // The real workbench returns a large list (built-in + extension tools). Empty array is acceptable for our TE2 use-cases.
            replyPayload = encodeExtReplyOkJson(msg.req, []);
          } else if (msg.method === "$initializeExtensionStorage") {
            // Real workbench returns a JSON string blob of persisted storage keys/values.
            replyPayload = encodeExtReplyOkJson(msg.req, "{}");
          } else if (msg.method === "$startFileSearch") {
            replyPayload = encodeExtReplyOkJson(msg.req, []);
          } else if (msg.method === "$resolveProxy") {
            replyPayload = encodeExtReplyOkJson(msg.req, null);
          } else if (msg.method === "$getPassword") {
            replyPayload = encodeExtReplyOkJson(msg.req, null);
          } else {
            replyPayload = encodeExtReplyOkEmpty(msg.req);
          }
          try {
            this.ext?.protocol.send(VSBuffer.wrap(replyPayload));
            if (this._debugMainThreadReplySeen < 80) {
              this._debugMainThreadReplySeen++;
              this.onEvent({
                type: "ext/reply_to_ext",
                ts_ms: Date.now(),
                req: msg.req,
                method: msg.method,
                replyType: replyPayload?.[0] ?? null,
              });
            }
          } catch {}
          return;
        }

        // replies to our requests
        if (msg.type === 7 || msg.type === 8 || msg.type === 9 || msg.type === 10 || msg.type === 11 || msg.type === 12) {
          const meta = this._sentExtMeta.get(msg.req);
          if (meta && this._debugExtReplySeen < 50) {
            this._debugExtReplySeen++;
            this._sentExtMeta.delete(msg.req);
            this.onEvent({
              type: "ext/reply",
              ts_ms: Date.now(),
              req: msg.req,
              to: { rpcId: meta.rpcId, method: meta.method },
              replyType: msg.type,
              ok: msg.type === 7 || msg.type === 8 || msg.type === 9 || msg.type === 10,
              hasResult: Object.prototype.hasOwnProperty.call(msg, "result"),
              hasError: Object.prototype.hasOwnProperty.call(msg, "error") && msg.error != null,
              error: msg.type === 11 ? msg.error : null,
            });
          }
          const pending = this._pendingExt.get(msg.req);
          if (pending) {
            this._pendingExt.delete(msg.req);
            pending.resolve(msg);
          }
        }
      });

      // Wait for the real Extension Host handshake (Ready -> init JSON -> Initialized).
      await extHandshakeReady;

      // Minimal ExtHost bootstrap (enough to get language providers registered).
      const configInit = this._buildConfigurationInitData(workspaceRoot, useRemote ? authority : null);
      this._sendExt(80, "$initializeConfiguration", [configInit], false);
      if (workspaceRoot) {
        const rootPath = String(workspaceRoot);
        const name = rootPath.split("/").filter(Boolean).slice(-1)[0] || rootPath;
        const wsId = crypto.createHash("sha1").update(rootPath).digest("hex").slice(0, 7);
        const folderUri = this._uriForPath(rootPath, authority);
        const workspace = {
          isUntitled: false,
          folders: [{ uri: folderUri, name, index: 0 }],
          id: wsId,
          name,
          transient: false,
        };
        this._sendExt(106, "$initializeWorkspace", [workspace, workspaceTrusted], false);
        if (workspaceTrusted) {
          this._sendExt(106, "$onDidGrantWorkspaceTrust", [], false);
        }
      }

      return { ok: true, proxyHttp, serverRootPath, commit, authority };
    } finally {
      this._connecting = false;
    }
  }

  async openFile(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const path = String(params.path ?? "");
    const languageId = String(params.languageId ?? "python");
    const authority = String(params.authority ?? this._authority ?? "localhost:8000");
    const text = await fs.readFile(path, "utf8");
    const lines = text.split(/\r?\n/);
    const uriObj = this._uriForPath(path, authority);

    const modelN = this._nextModelNumber++;
    const editorId = `vs.editor.ICodeEditor:1,$model${modelN}`;
    const delta = {
      newActiveEditor: editorId,
      addedDocuments: [{ uri: uriObj, versionId: 1, lines, EOL: "\n", languageId, isDirty: true, encoding: "utf8" }],
      removedDocuments: [],
      addedEditors: [
        {
          id: editorId,
          documentUri: uriObj,
          options: { insertSpaces: true, tabSize: 4, indentSize: 4, originalIndentSize: "tabSize", cursorStyle: 1, lineNumbers: 1 },
          selections: [
            {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 1,
              selectionStartLineNumber: 1,
              selectionStartColumn: 1,
              positionLineNumber: 1,
              positionColumn: 1,
            },
          ],
          visibleRanges: [{ startLineNumber: 1, startColumn: 1, endLineNumber: Math.min(lines.length || 1, 30), endColumn: 1 }],
          editorPosition: 0,
        },
      ],
      removedEditors: [],
    };

    const req = this._sendExt(84, "$acceptDocumentsAndEditorsDelta", [delta], false);
    // Mirror minimal editor/tab state updates seen in a real workbench session.
    const tabId = `0~default-workbench.editors.files.fileEditorInput-${uriObj.external} `;
    const tab = {
      id: tabId,
      label: path.split("/").filter(Boolean).slice(-1)[0] || path,
      editorId: "default",
      input: { kind: 1, uri: uriObj },
      isPinned: false,
      isPreview: false,
      isActive: true,
      isDirty: true,
    };
    const tabModel = [
      {
        groupId: 0,
        isActive: true,
        viewColumn: 0,
        tabs: [tab],
      },
    ];
    this._sendExt(88, "$acceptEditorDiffInformation", [editorId, []], false);
    this._sendExt(113, "$acceptEditorTabModel", [tabModel], false);
    this._sendExt(
      88,
      "$acceptEditorPropertiesChanged",
      [
        editorId,
        {
          options: null,
          selections: {
            selections: [
              {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
                selectionStartLineNumber: 1,
                selectionStartColumn: 1,
                positionLineNumber: 1,
                positionColumn: 1,
              },
            ],
            source: "mouse",
          },
          visibleRanges: null,
        },
      ],
      false
    );
    this._sendExt(85, "$acceptDirtyStateChanged", [uriObj, true], false);
    // Trigger activation for deterministic provider registration.
    // Some builds send this as a mixed-args message; use mixed encoding to avoid silent drops.
    this._sendExtMixed(99, "$activateByEvent", [`onLanguage:${languageId}`, 0], false);
    return { ok: true, req };
  }

  async documentSymbols(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? "localhost:8000");
    const path = String(params.path ?? "");
    const providerHandle = params.providerHandle ?? this.state.docSymbolsProviderHandle;
    if (typeof providerHandle !== "number") throw new Error("no document symbols provider handle learned yet");

    const uriObj = this._uriForPath(path, authority);

    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({ req, rpcId: 94, method: "$provideDocumentSymbols", args: [providerHandle, uriObj], cancellable: false });

    const fut = new Promise((resolve, reject) => {
      this._pendingExt.set(req, { resolve, reject });
      setTimeout(() => {
        if (this._pendingExt.has(req)) {
          this._pendingExt.delete(req);
          reject(new Error("timed out waiting for symbols reply"));
        }
      }, 15000);
    });

    this.ext.protocol.send(VSBuffer.wrap(payload));
    const rep = await fut;
    if (rep.type === 9) return { ok: true, result: rep.result };
    if (rep.type === 11) return { ok: false, error: rep.error };
    return { ok: false, error: rep };
  }

  async hover(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? "localhost:8000");
    const path = String(params.path ?? "");
    const lineNumber = Number(params.lineNumber ?? 1);
    const column = Number(params.column ?? 1);
    const providerHandle = params.providerHandle ?? this.state.hoverProviderHandle;
    if (typeof providerHandle !== "number") throw new Error("no hover provider handle learned yet");

    const uriObj = this._uriForPath(path, authority);

    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({
      req,
      rpcId: 94,
      method: "$provideHover",
      args: [providerHandle, uriObj, { lineNumber, column }, {}],
      cancellable: false,
    });

    const fut = new Promise((resolve, reject) => {
      this._pendingExt.set(req, { resolve, reject });
      setTimeout(() => {
        if (this._pendingExt.has(req)) {
          this._pendingExt.delete(req);
          reject(new Error("timed out waiting for hover reply"));
        }
      }, 15000);
    });

    this.ext.protocol.send(VSBuffer.wrap(payload));
    const rep = await fut;
    if (rep.type === 9) return { ok: true, result: rep.result };
    if (rep.type === 11) return { ok: false, error: rep.error };
    return { ok: false, error: rep };
  }
}
