import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { DecodedExtHostRpc } from "../protocol/wire-encoding";
import { serializableBuffersArgument } from "../protocol/wire-encoding.mjs";

type JsonObject = Record<string, unknown>;

interface WebviewProvider {
  extensionId: string;
  extensionLocation: UriRecord | null;
  viewType: string;
  retainContextWhenHidden: boolean;
  serializeBuffersForPostMessage: boolean;
}

interface WebviewContribution {
  extensionId: string;
  extensionLocation: UriRecord | null;
  viewType: string;
  title: string;
  icon: UriRecord | null;
}

interface UriRecord extends JsonObject {
  scheme?: string;
  authority?: string;
  path?: string;
}

export interface ExtensionWebviewSurface extends JsonObject {
  dto: "ExtensionWebviewSurface";
  version: 1;
  surfaceId: string;
  handle: string;
  hostId: string;
  workspaceId: string;
  projectPath: string;
  extensionId: string;
  viewId: string;
  surfaceKind: "view" | "panel";
  title: string;
  description: string;
  badge: unknown;
  url: string;
  html: string;
  htmlRevision: number;
  options: JsonObject;
  state: unknown;
  extensionLocation: UriRecord | null;
  serializeBuffersForPostMessage: boolean;
  visible: boolean;
  retainContextWhenHidden: boolean;
  viewColumn: number;
  iconUrl: string;
  iconResource: UriRecord | null;
}

export interface WebviewResource {
  body: Uint8Array;
  contentType: string;
}

export interface WebviewRuntimeOptions {
  rpcIds: {
    MainThreadWebviews: number;
    MainThreadWebviewPanels: number;
    MainThreadWebviewViews: number;
    ExtHostWebviews: number;
    ExtHostWebviewPanels: number;
    ExtHostWebviewViews: number;
  };
  getExtensions(): unknown[];
  getWorkspaceFolder(): string | null;
  activateByEvent(event: string): Promise<unknown>;
  sendExtAwaitTerminalReply(
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    timeoutMs: number,
  ): { req: number; promise: Promise<unknown> };
  sendExt(rpcId: number, method: string, args: unknown[], cancellable?: boolean): number;
  sendExtMixed(rpcId: number, method: string, args: unknown[], cancellable?: boolean): number;
  onLifecycleEvent(event: JsonObject): void;
  onClientNotification(method: string, params: unknown): void;
  log(...args: unknown[]): void;
}

export interface WebviewMainThreadResult {
  handled: boolean;
  replyResult?: unknown;
  error?: unknown;
}

const PUBLIC_WEBVIEW_BASE = "/api/app/code_te2/services/wba/webview";
const WEBVIEW_RESOURCE_HOST =
  /https:\/\/([a-z][a-z0-9+.-]*)(?:\+|%2b)([^/]*?)\.vscode-resource\.vscode-cdn\.net(\/[^\s\"'<>)]*)?/gi;

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface BuiltInWebviewTheme {
  activeTheme: "vscode-dark";
  themeLabel: string;
  themeId: string;
  styles: Readonly<Record<string, string>>;
}

function loadBuiltInWebviewTheme(): BuiltInWebviewTheme {
  const themeUrl = new URL(
    "../../../../monaco_editor/themes/vendored/github/dark-default.json",
    import.meta.url,
  );
  const theme = JSON.parse(readFileSync(themeUrl, "utf8")) as unknown;
  if (!isRecord(theme) || theme.name !== "GitHub Dark Default" || !isRecord(theme.colors)) {
    throw new Error(`Invalid built-in extension webview theme: ${themeUrl.pathname}`);
  }

  const styles: Record<string, string> = {
    "vscode-font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    "vscode-font-weight": "normal",
    "vscode-font-size": "13px",
    "vscode-editor-font-family": '"JetBrains Mono Nerd", "JetBrains Mono", monospace',
    "vscode-editor-font-weight": "normal",
    "vscode-editor-font-size": "14px",
    "vscode-editor-font-feature-settings": '"liga" 1, "calt" 1',
    "text-link-decoration": "none",
  };
  for (const [colorId, color] of Object.entries(theme.colors)) {
    if (typeof color !== "string" || !/^[A-Za-z0-9.-]+$/.test(colorId)) continue;
    styles[`vscode-${colorId.replace(/\./g, "-")}`] = color;
  }
  if (
    styles["vscode-sideBar-background"] !== "#010409" ||
    styles["vscode-editor-foreground"] !== "#e6edf3"
  ) {
    throw new Error(`Unexpected built-in extension webview theme payload: ${themeUrl.pathname}`);
  }
  return Object.freeze({
    activeTheme: "vscode-dark",
    themeLabel: "GitHub Dark Default",
    themeId: "github-dark-default",
    styles: Object.freeze(styles),
  });
}

const BUILT_IN_WEBVIEW_THEME = loadBuiltInWebviewTheme();

function webviewThemeStyle(): string {
  const declarations = Object.entries(BUILT_IN_WEBVIEW_THEME.styles)
    .map(([name, value]) => `--${name}:${value}`)
    .join(";");
  return `<style data-te2-webview-theme>:root{color-scheme:dark;${declarations}}html{background:${BUILT_IN_WEBVIEW_THEME.styles["vscode-sideBar-background"]}}body{color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);font-weight:var(--vscode-font-weight)}</style>`;
}

function decorateWebviewBody(html: string): string {
  return html.replace(/<body(?:\s[^>]*)?>/i, (bodyTag) => {
    const classPattern = /\sclass\s*=\s*(["'])(.*?)\1/i;
    const classMatch = classPattern.exec(bodyTag);
    const existingClasses = classMatch?.[2]
      ?.split(/\s+/)
      .filter((name) => name && !/^vscode-(?:light|dark|high-contrast(?:-light)?)$/.test(name)) ?? [];
    const classValue = [...existingClasses, BUILT_IN_WEBVIEW_THEME.activeTheme].join(" ");
    let themedTag = classMatch
      ? bodyTag.replace(classPattern, ` class="${classValue}"`)
      : bodyTag.replace(/^<body/i, `<body class="${classValue}"`);
    for (const [name, value] of [
      ["data-vscode-theme-kind", BUILT_IN_WEBVIEW_THEME.activeTheme],
      ["data-vscode-theme-name", BUILT_IN_WEBVIEW_THEME.themeLabel],
      ["data-vscode-theme-id", BUILT_IN_WEBVIEW_THEME.themeId],
    ]) {
      const attributePattern = new RegExp(`\\s${name}\\s*=\\s*(["'])[^"']*\\1`, "i");
      themedTag = attributePattern.test(themedTag)
        ? themedTag.replace(attributePattern, ` ${name}="${value}"`)
        : themedTag.replace(/^<body/i, `<body ${name}="${value}"`);
    }
    return themedTag;
  });
}

function uriRecord(value: unknown): UriRecord | null {
  if (!isRecord(value)) return null;
  const scheme = stringValue(value.scheme);
  const uriPath = stringValue(value.path ?? value.fsPath);
  if (!scheme || !uriPath) return null;
  return {
    scheme,
    authority: stringValue(value.authority),
    path: uriPath,
  };
}

function extensionIdentifier(extension: JsonObject): string {
  if (typeof extension.id === "string") return extension.id;
  if (isRecord(extension.id)) {
    const id = stringValue(extension.id.value ?? extension.id.id);
    if (id) return id;
  }
  if (typeof extension.extensionId === "string") return extension.extensionId;
  if (isRecord(extension.identifier)) {
    return stringValue(extension.identifier.value ?? extension.identifier.id);
  }
  return "";
}

function panelViewColumn(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function extensionLocation(extension: JsonObject): UriRecord | null {
  return uriRecord(extension.extensionLocation ?? extension.location);
}

function extensionResourceUri(location: UriRecord | null, relativePath: unknown): UriRecord | null {
  const relative = stringValue(relativePath);
  const rootPath = stringValue(location?.path);
  if (!location || !relative || !rootPath) return null;
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, relative);
  if (!pathWithin(resolvedPath, resolvedRoot)) return null;
  return {
    scheme: stringValue(location.scheme),
    authority: stringValue(location.authority),
    path: resolvedPath,
  };
}

function stableHash(value: string, length = 16): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, length);
}

function pathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resourceContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function encodePathSegments(value: string): string {
  const leading = value.startsWith("/") ? "/" : "";
  const trailing = value.endsWith("/") ? "/" : "";
  const encoded = value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${leading}${encoded}${trailing}`;
}

function resourceUrl(surfaceId: string, resource: UriRecord | null): string {
  if (!resource) return "";
  const scheme = encodeURIComponent(stringValue(resource.scheme));
  const authority = encodeURIComponent(stringValue(resource.authority) || "_");
  const resourcePath = encodePathSegments(stringValue(resource.path) || "/");
  return `${PUBLIC_WEBVIEW_BASE}/${encodeURIComponent(surfaceId)}/resource/${scheme}/${authority}${resourcePath}`;
}

function decodeWebviewAuthority(value: string): string {
  return value.replace(/-([0-9a-f]{4})/gi, (_match, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16))
  );
}

function rewriteResourceUrls(surfaceId: string, html: string): string {
  const resourceBase = `${PUBLIC_WEBVIEW_BASE}/${encodeURIComponent(surfaceId)}/resource`;
  return html.replace(
    WEBVIEW_RESOURCE_HOST,
    (_match, schemeRaw: string, authorityRaw: string, pathRaw = "/") => {
      const scheme = encodeURIComponent(decodeURIComponent(schemeRaw));
      const authority = encodeURIComponent(
        decodeWebviewAuthority(decodeURIComponent(authorityRaw)) || "_",
      );
      let resourcePath = pathRaw || "/";
      resourcePath = resourcePath.split(/[?#]/, 1)[0] || "/";
      try {
        resourcePath = decodeURI(resourcePath);
      } catch {}
      return `${resourceBase}/${scheme}/${authority}${encodePathSegments(resourcePath)}`;
    },
  );
}

const INNER_BRIDGE = `<script data-te2-webview-bridge>(function(){
let apiState;
let acquired=false;
function post(kind,value){window.parent.postMessage({__te2ExtensionWebview:true,kind,value},'*');}
function createStorage(persistent){
  const entries=new Map();
  function publish(){if(persistent)post('storage',Array.from(entries.entries()));}
  const storage={
    clear:function(){entries.clear();publish();},
    getItem:function(key){key=String(key);return entries.has(key)?entries.get(key):null;},
    key:function(index){const keys=Array.from(entries.keys());return keys[Number(index)]??null;},
    removeItem:function(key){entries.delete(String(key));publish();},
    setItem:function(key,value){entries.set(String(key),String(value));publish();}
  };
  Object.defineProperty(storage,'length',{enumerable:true,get:function(){return entries.size;}});
  Object.defineProperty(storage,Symbol.toStringTag,{value:'Storage'});
  return {
    storage,
    replace:function(value){entries.clear();if(Array.isArray(value)){for(const item of value){if(Array.isArray(item)&&item.length===2)entries.set(String(item[0]),String(item[1]));}}}
  };
}
const localStorageBridge=createStorage(true);
const sessionStorageBridge=createStorage(false);
Object.defineProperty(window,'localStorage',{configurable:false,enumerable:true,value:localStorageBridge.storage});
Object.defineProperty(window,'sessionStorage',{configurable:false,enumerable:true,value:sessionStorageBridge.storage});
Object.defineProperty(window,'acquireVsCodeApi',{configurable:false,enumerable:false,writable:false,value:function(){
  if(acquired)throw new Error('An instance of the VS Code API has already been acquired');
  acquired=true;
  return Object.freeze({
    postMessage:function(value){post('message',value);return true;},
    setState:function(value){apiState=value;post('state',value);return value;},
    getState:function(){return apiState;}
  });
}});
window.addEventListener('message',function(event){
  if(event.source!==window.parent)return;
  const data=event.data;
  if(!data||data.__te2ExtensionWebviewHost!==true)return;
  if(data.kind==='initialize'){
    apiState=data.value&&data.value.state;
    localStorageBridge.replace(data.value&&data.value.localStorage);
    return;
  }
  if(data.kind==='message')window.dispatchEvent(new MessageEvent('message',{
    data:data.value,
    origin:window.location.origin,
    source:window
  }));
});
post('ready',null);
})();</script>`;

function webviewResourceOrigin(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) throw new Error("extension webview resource origin is required");
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("extension webview resource origin must use HTTP or HTTPS");
  }
  return parsed.origin;
}

function transformWebviewHtml(surfaceId: string, html: string, resourceOrigin: string): string {
  let transformed = rewriteResourceUrls(surfaceId, html || "");
  transformed = transformed.replace(
    /https:\/\/\*\.vscode-cdn\.net/gi,
    "__TE2_WEBVIEW_RESOURCE_ORIGIN__",
  );
  transformed = decorateWebviewBody(transformed);
  transformed = transformed.replaceAll(
    "__TE2_WEBVIEW_RESOURCE_ORIGIN__",
    webviewResourceOrigin(resourceOrigin),
  );
  const bootstrap = `${webviewThemeStyle()}${INNER_BRIDGE}`;
  if (/<head(?:\s[^>]*)?>/i.test(transformed)) {
    return transformed.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${bootstrap}`);
  }
  return `${bootstrap}${transformed}`;
}

function wrapperHtml(surfaceId: string): string {
  const safeSurfaceId = JSON.stringify(surfaceId);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#te2-webview{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#010409}#te2-status{position:absolute;inset:0;display:grid;place-items:center;color:#7d8590;font:13px system-ui}#te2-status[hidden]{display:none}</style></head>
<body><div id="te2-status">Loading extension view…</div><iframe id="te2-webview" title="Extension view" hidden></iframe>
<script src="./runtime/socket.io.min.js"></script>
<script type="module">
import {encodeWbaRpcMessage,decodeWbaRpcMessage} from './runtime/messagepack-codec.mjs';
const surfaceId=${safeSurfaceId};
const status=document.getElementById('te2-status');
const frame=document.getElementById('te2-webview');
const webviewStorageKey='te2.extension-webview.storage.v1:'+surfaceId;
const pending=new Map();let nextId=1;let ready=false;let queued=[];let loadRevision=0;
let serializeBuffers=false;
const socket=window.io('/wba',{path:'/api/app/code_te2/services/wba/socket.io',transports:['websocket'],auth:{rpcCodec:'msgpack-v1'}});
function rpc(method,params){return new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});socket.emit('rpc',encodeWbaRpcMessage({jsonrpc:'2.0',id,method,params}));});}
function readWebviewStorage(){
  try{
    const value=JSON.parse(window.localStorage.getItem(webviewStorageKey)||'[]');
    return Array.isArray(value)?value.filter(item=>Array.isArray(item)&&item.length===2&&typeof item[0]==='string'&&typeof item[1]==='string'):[];
  }catch{return [];}
}
function writeWebviewStorage(value){
  const entries=Array.isArray(value)?value.filter(item=>Array.isArray(item)&&item.length===2&&typeof item[0]==='string'&&typeof item[1]==='string'):[];
  window.localStorage.setItem(webviewStorageKey,JSON.stringify(entries));
}
function serialize(value){if(!serializeBuffers)return {jsonMessage:JSON.stringify(value)??'null',buffers:[]};const buffers=[];const seen=new WeakSet();const jsonMessage=JSON.stringify(value,(_key,item)=>{if(item&&typeof item==='object'){if(seen.has(item))throw new TypeError('Cannot serialize cyclic webview message');seen.add(item);if(item instanceof ArrayBuffer){const index=buffers.push(new Uint8Array(item))-1;return {$$vscode_array_buffer_reference$$:true,index};}if(ArrayBuffer.isView(item)){const index=buffers.push(new Uint8Array(item.buffer))-1;return {$$vscode_array_buffer_reference$$:true,index,view:{type:item.constructor.name,byteLength:item.byteLength,byteOffset:item.byteOffset}};}}return item;})??'null';return {jsonMessage,buffers};}
function deserialize(jsonMessage,buffers){const arrays=(buffers||[]).map(bytes=>{const copy=new Uint8Array(bytes).slice();return copy.buffer;});return JSON.parse(jsonMessage,(_key,item)=>{if(!item||item.$$vscode_array_buffer_reference$$!==true)return item;const buffer=arrays[item.index];if(!item.view)return buffer;const ctor=globalThis[item.view.type];return typeof ctor==='function'?new ctor(buffer,item.view.byteOffset,item.view.byteLength/ctor.BYTES_PER_ELEMENT):buffer;});}
function deliver(kind,value){if(!ready){queued.push([kind,value]);return;}frame.contentWindow.postMessage({__te2ExtensionWebviewHost:true,kind,value},'*');}
async function load(snapshot){const currentLoad=++loadRevision;ready=false;serializeBuffers=snapshot.serializeBuffersForPostMessage===true;const sandbox=[snapshot.options?.enableScripts?'allow-scripts':'',snapshot.options?.enableForms?'allow-forms':'','allow-downloads','allow-popups','allow-popups-to-escape-sandbox'].filter(Boolean).join(' ');frame.setAttribute('sandbox',sandbox);const documentUrl=new URL('./'+encodeURIComponent(surfaceId)+'/document',window.location.href);documentUrl.searchParams.set('revision',String(snapshot.htmlRevision||0));documentUrl.searchParams.set('resourceOrigin',window.location.origin);if(currentLoad!==loadRevision)return;frame.__te2State=snapshot.state;frame.src=documentUrl.href;frame.hidden=false;status.hidden=true;}
socket.on('connect',async()=>{try{const result=await rpc('vscode.webview.attach',{surfaceId});await load(result);}catch(error){status.textContent=String(error?.message||error);}});
socket.on('disconnect',()=>{status.hidden=false;status.textContent='Extension host disconnected';});
socket.on('rpc',payload=>{const message=decodeWbaRpcMessage(payload);const messages=Array.isArray(message)?message:[message];for(const item of messages){if(item&&item.id!=null&&pending.has(item.id)){const waiter=pending.get(item.id);pending.delete(item.id);item.error?waiter.reject(new Error(item.error.message||'RPC failed')):waiter.resolve(item.result);continue;}if(item?.method!=='vscode.webview.event'||item.params?.surfaceId!==surfaceId)continue;const event=item.params;if(event.event==='message')deliver('message',deserialize(event.jsonMessage,event.buffers));else if(event.event==='reload')void load(event.surface).catch(error=>{status.hidden=false;status.textContent=String(error?.message||error);});else if(event.event==='dispose'){status.hidden=false;status.textContent='Extension view closed';frame.remove();}}});
window.addEventListener('message',event=>{
  if(event.source!==frame.contentWindow)return;
  const data=event.data;
  if(!data||data.__te2ExtensionWebview!==true)return;
  if(data.kind==='ready'){
    ready=true;
    deliver('initialize',{state:frame.__te2State,localStorage:readWebviewStorage()});
    for(const entry of queued.splice(0))deliver(entry[0],entry[1]);
    return;
  }
  if(data.kind==='message'){
    const serialized=serialize(data.value);
    void rpc('vscode.webview.message',{surfaceId,...serialized}).catch(error=>console.error('[extension-webview] message relay failed',error));
  }else if(data.kind==='state'){
    frame.__te2State=data.value;
    void rpc('vscode.webview.state',{surfaceId,state:data.value}).catch(error=>console.error('[extension-webview] state relay failed',error));
  }else if(data.kind==='storage'){
    try{
      writeWebviewStorage(data.value);
    }catch(error){
      console.warn('[extension-webview] local storage persistence failed',error);
    }
  }
});
</script></body></html>`;
}

export class WebviewRuntime {
  private readonly providers = new Map<string, WebviewProvider>();
  private readonly surfaces = new Map<string, ExtensionWebviewSurface>();
  private readonly surfaceIdByHandle = new Map<string, string>();
  private readonly providerWaiters = new Map<string, Set<() => void>>();

  constructor(private readonly runtime: WebviewRuntimeOptions) {}

  handleMainThreadRequest(message: DecodedExtHostRpc): WebviewMainThreadResult {
    const rpcId = Number(message.rpcId);
    const method = stringValue(message.method);
    const args = Array.isArray(message.args) ? message.args : [];
    try {
      if (rpcId === this.runtime.rpcIds.MainThreadWebviewViews) {
        return this.handleViewRequest(method, args);
      }
      if (rpcId === this.runtime.rpcIds.MainThreadWebviewPanels) {
        return this.handlePanelRequest(method, args);
      }
      if (rpcId === this.runtime.rpcIds.MainThreadWebviews) {
        return this.handleWebviewRequest(method, args);
      }
      return { handled: false };
    } catch (error) {
      return { handled: true, error };
    }
  }

  async activatePrimaryViews(): Promise<void> {
    const contributions = this.primaryContributions();
    await Promise.all(contributions.map(async (contribution) => {
      try {
        await this.runtime.activateByEvent(`onView:${contribution.viewType}`);
        await this.waitForProvider(contribution.viewType, 5000);
        if (!this.findSurfaceByView(contribution.viewType)) {
          await this.createSurface(contribution);
        }
      } catch (error) {
        this.runtime.log(
          `[webview] activation failed view=${contribution.viewType}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }));
    this.emitSnapshot();
  }

  clear(reason: string, clearProviders = true): void {
    const oldWorkspace = this.workspaceFolder();
    for (const surface of [...this.surfaces.values()]) {
      try {
        this.runtime.sendExt(
          surface.surfaceKind === "panel"
            ? this.runtime.rpcIds.ExtHostWebviewPanels
            : this.runtime.rpcIds.ExtHostWebviewViews,
          surface.surfaceKind === "panel"
            ? "$onDidDisposeWebviewPanel"
            : "$disposeWebviewView",
          [surface.handle],
          false,
        );
      } catch {}
      this.notify(surface, "dispose", { reason });
    }
    if (clearProviders) this.providers.clear();
    this.surfaces.clear();
    this.surfaceIdByHandle.clear();
    if (clearProviders) this.providerWaiters.clear();
    this.emitSnapshot(oldWorkspace);
  }

  snapshot(): JsonObject {
    return this.snapshotFor(this.workspaceFolder());
  }

  attach(params: JsonObject): JsonObject {
    const surface = this.requiredSurface(params.surfaceId);
    return this.publicSurface(surface);
  }

  receiveBrowserMessage(params: JsonObject): JsonObject {
    const surface = this.requiredSurface(params.surfaceId);
    const jsonMessage = typeof params.jsonMessage === "string"
      ? params.jsonMessage
      : JSON.stringify(params.message ?? null);
    const buffers = Array.isArray(params.buffers)
      ? params.buffers.filter((value): value is Uint8Array => value instanceof Uint8Array)
      : [];
    const references = buffers.map((_buffer, index) => ({ "$$ref$$": index }));
    this.runtime.sendExtMixed(
      this.runtime.rpcIds.ExtHostWebviews,
      "$onMessage",
      [
        surface.handle,
        jsonMessage,
        serializableBuffersArgument(references, buffers),
      ],
      false,
    );
    return { ok: true };
  }

  setBrowserState(params: JsonObject): JsonObject {
    const surface = this.requiredSurface(params.surfaceId);
    surface.state = params.state;
    return { ok: true };
  }

  setVisibility(params: JsonObject): JsonObject {
    const surface = this.requiredSurface(params.surfaceId);
    const visible = params.visible !== false;
    if (surface.visible !== visible) {
      surface.visible = visible;
      if (surface.surfaceKind === "panel") {
        this.sendPanelViewState(surface, visible);
      } else {
        this.runtime.sendExt(
          this.runtime.rpcIds.ExtHostWebviewViews,
          "$onDidChangeWebviewViewVisibility",
          [surface.handle, visible],
          false,
        );
      }
    }
    return { ok: true, visible };
  }

  wrapper(surfaceId: string): string {
    this.requiredSurface(surfaceId);
    return wrapperHtml(surfaceId);
  }

  document(surfaceId: string, resourceOrigin: string): string {
    return transformWebviewHtml(
      surfaceId,
      this.requiredSurface(surfaceId).html,
      resourceOrigin,
    );
  }

  async resource(
    surfaceId: string,
    rawScheme: string,
    rawAuthority: string,
    rawPath: string,
  ): Promise<WebviewResource> {
    const surface = this.requiredSurface(surfaceId);
    const scheme = decodeURIComponent(rawScheme);
    const authority = decodeURIComponent(rawAuthority) === "_"
      ? ""
      : decodeURIComponent(rawAuthority);
    if (scheme !== "file" && scheme !== "vscode-remote") {
      throw new Error(`unsupported webview resource scheme: ${scheme}`);
    }
    const candidatePath = `/${rawPath.split("/").filter(Boolean).map(decodeURIComponent).join("/")}`;
    const candidate = await fs.realpath(candidatePath);
    const roots = this.localResourceRoots(surface);
    let admitted = false;
    for (const root of roots) {
      if (stringValue(root.scheme) !== scheme) continue;
      const rootAuthority = stringValue(root.authority);
      if (scheme === "vscode-remote" && rootAuthority && rootAuthority !== authority) continue;
      try {
        const realRoot = await fs.realpath(stringValue(root.path));
        if (pathWithin(candidate, realRoot)) {
          admitted = true;
          break;
        }
      } catch {}
    }
    if (!admitted) throw new Error("webview resource is outside localResourceRoots");
    return { body: await fs.readFile(candidate), contentType: resourceContentType(candidate) };
  }

  private handleViewRequest(method: string, args: unknown[]): WebviewMainThreadResult {
    if (method === "$registerWebviewViewProvider") {
      const extension = isRecord(args[0]) ? args[0] : {};
      const identifier = isRecord(extension.id)
        ? stringValue(extension.id.value ?? extension.id.id)
        : stringValue(extension.id);
      const providerOptions = isRecord(args[2]) ? args[2] : {};
      const provider: WebviewProvider = {
        extensionId: identifier,
        extensionLocation: uriRecord(extension.location),
        viewType: stringValue(args[1]),
        retainContextWhenHidden: providerOptions.retainContextWhenHidden === true,
        serializeBuffersForPostMessage: providerOptions.serializeBuffersForPostMessage === true,
      };
      if (!provider.viewType) throw new Error("webview provider viewType is required");
      this.providers.set(provider.viewType, provider);
      for (const resolve of this.providerWaiters.get(provider.viewType) ?? []) resolve();
      this.providerWaiters.delete(provider.viewType);
      return { handled: true };
    }
    if (method === "$unregisterWebviewViewProvider") {
      const viewType = stringValue(args[0]);
      this.providers.delete(viewType);
      for (const surface of [...this.surfaces.values()]) {
        if (surface.viewId === viewType) this.disposeSurface(surface, "provider_unregistered");
      }
      return { handled: true };
    }
    const surface = this.surfaceForHandle(args[0]);
    if (!surface) return { handled: false };
    if (method === "$setWebviewViewTitle") {
      surface.title = stringValue(args[1]) || surface.viewId;
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$setWebviewViewDescription") {
      surface.description = stringValue(args[1]);
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$setWebviewViewBadge") {
      surface.badge = args[1] ?? null;
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$show") {
      this.notify(surface, "show", { preserveFocus: args[1] === true });
      return { handled: true };
    }
    return { handled: false };
  }

  private handleWebviewRequest(method: string, args: unknown[]): WebviewMainThreadResult {
    const surface = this.surfaceForHandle(args[0]);
    if (!surface) return { handled: false };
    if (method === "$setHtml") {
      surface.html = typeof args[1] === "string" ? args[1] : "";
      surface.htmlRevision += 1;
      this.notify(surface, "reload", { surface: this.publicSurface(surface) });
      return { handled: true };
    }
    if (method === "$setOptions") {
      surface.options = isRecord(args[1]) ? { ...args[1] } : {};
      surface.htmlRevision += 1;
      this.notify(surface, "reload", { surface: this.publicSurface(surface) });
      return { handled: true };
    }
    if (method === "$postMessage") {
      const buffers = args.slice(2).filter((value): value is Uint8Array => value instanceof Uint8Array);
      this.notify(surface, "message", {
        jsonMessage: typeof args[1] === "string" ? args[1] : JSON.stringify(args[1] ?? null),
        buffers,
      });
      return { handled: true, replyResult: true };
    }
    return { handled: false };
  }

  private handlePanelRequest(method: string, args: unknown[]): WebviewMainThreadResult {
    if (method === "$createWebviewPanel") {
      const extension = isRecord(args[0]) ? args[0] : {};
      const handle = stringValue(args[1]);
      const viewType = stringValue(args[2]);
      const initData = isRecord(args[3]) ? args[3] : {};
      const showOptions = isRecord(args[4]) ? args[4] : {};
      if (!handle || !viewType) throw new Error("webview panel handle and viewType are required");
      if (this.surfaceForHandle(handle)) throw new Error(`webview panel handle already exists: ${handle}`);
      const projectPath = this.workspaceFolder();
      if (!projectPath) throw new Error("webview panel requires an active workspace");
      const workspaceId = stableHash(projectPath);
      const surfaceId = `vsix-panel:${workspaceId}:${stableHash(handle)}`;
      const panelOptions = isRecord(initData.panelOptions) ? initData.panelOptions : {};
      const surface: ExtensionWebviewSurface = {
        dto: "ExtensionWebviewSurface",
        version: 1,
        surfaceId,
        handle,
        hostId: `vsix-webview:${surfaceId}`,
        workspaceId,
        projectPath,
        extensionId: extensionIdentifier(extension),
        viewId: viewType,
        surfaceKind: "panel",
        title: stringValue(initData.title) || viewType,
        description: "",
        badge: null,
        url: `${PUBLIC_WEBVIEW_BASE}/${encodeURIComponent(surfaceId)}`,
        html: "",
        htmlRevision: 0,
        options: isRecord(initData.webviewOptions) ? { ...initData.webviewOptions } : {},
        state: null,
        extensionLocation: uriRecord(extension.location),
        serializeBuffersForPostMessage: initData.serializeBuffersForPostMessage === true,
        visible: true,
        retainContextWhenHidden: panelOptions.retainContextWhenHidden === true,
        viewColumn: panelViewColumn(showOptions.viewColumn),
        iconUrl: "",
        iconResource: null,
      };
      this.surfaces.set(surfaceId, surface);
      this.surfaceIdByHandle.set(handle, surfaceId);
      this.sendPanelViewState(surface, true);
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$registerSerializer" || method === "$unregisterSerializer") {
      return { handled: true };
    }
    const surface = this.surfaceForHandle(args[0]);
    if (!surface || surface.surfaceKind !== "panel") return { handled: false };
    if (method === "$disposeWebview") {
      this.disposeSurface(surface, "panel_disposed", true);
      return { handled: true };
    }
    if (method === "$setTitle") {
      surface.title = stringValue(args[1]) || surface.viewId;
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$setIconPath") {
      const icon = isRecord(args[1])
        ? uriRecord(args[1].dark) ?? uriRecord(args[1].light) ?? uriRecord(args[1])
        : null;
      surface.iconResource = icon;
      surface.iconUrl = resourceUrl(surface.surfaceId, icon);
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$reveal") {
      const showOptions = isRecord(args[1]) ? args[1] : {};
      surface.visible = true;
      surface.viewColumn = panelViewColumn(showOptions.viewColumn, surface.viewColumn);
      this.sendPanelViewState(surface, true);
      this.notify(surface, "show", { preserveFocus: showOptions.preserveFocus === true });
      this.emitSnapshot();
      return { handled: true };
    }
    return { handled: false };
  }

  private primaryContributions(): WebviewContribution[] {
    const result: WebviewContribution[] = [];
    for (const rawExtension of this.runtime.getExtensions()) {
      if (!isRecord(rawExtension) || !isRecord(rawExtension.contributes)) continue;
      const extensionId = extensionIdentifier(rawExtension);
      const containers = isRecord(rawExtension.contributes.viewsContainers)
        && Array.isArray(rawExtension.contributes.viewsContainers.activitybar)
        ? rawExtension.contributes.viewsContainers.activitybar
        : [];
      const views = isRecord(rawExtension.contributes.views)
        ? rawExtension.contributes.views
        : {};
      for (const rawContainer of containers) {
        if (!isRecord(rawContainer)) continue;
        const containerId = stringValue(rawContainer.id);
        const contributionLocation = extensionLocation(rawExtension);
        const icon = extensionResourceUri(contributionLocation, rawContainer.icon);
        const descriptors = Array.isArray(views[containerId]) ? views[containerId] : [];
        for (const rawDescriptor of descriptors) {
          if (!isRecord(rawDescriptor) || stringValue(rawDescriptor.type) !== "webview") continue;
          const viewType = stringValue(rawDescriptor.id);
          if (!viewType) continue;
          result.push({
            extensionId,
            extensionLocation: extensionLocation(rawExtension),
            viewType,
            title: stringValue(rawDescriptor.name) || viewType,
            icon,
          });
        }
      }
    }
    return result;
  }

  private async createSurface(contribution: WebviewContribution): Promise<void> {
    const provider = this.providers.get(contribution.viewType);
    if (!provider) throw new Error(`webview provider is not registered: ${contribution.viewType}`);
    const projectPath = this.workspaceFolder();
    if (!projectPath) throw new Error("webview view requires an active workspace");
    const workspaceId = stableHash(projectPath);
    const surfaceId = `vsix:${workspaceId}:${stableHash(`${contribution.extensionId}\0${contribution.viewType}`)}`;
    const handle = crypto.randomUUID();
    const surface: ExtensionWebviewSurface = {
      dto: "ExtensionWebviewSurface",
      version: 1,
      surfaceId,
      handle,
      hostId: `vsix-webview:${surfaceId}`,
      workspaceId,
      projectPath,
      extensionId: provider.extensionId || contribution.extensionId,
      viewId: contribution.viewType,
      surfaceKind: "view",
      title: contribution.title,
      description: "",
      badge: null,
      url: `${PUBLIC_WEBVIEW_BASE}/${encodeURIComponent(surfaceId)}`,
      html: "",
      htmlRevision: 0,
      options: {},
      state: null,
      extensionLocation: provider.extensionLocation ?? contribution.extensionLocation,
      serializeBuffersForPostMessage: provider.serializeBuffersForPostMessage,
      visible: true,
      retainContextWhenHidden: provider.retainContextWhenHidden,
      viewColumn: 0,
      iconUrl: resourceUrl(surfaceId, contribution.icon),
      iconResource: contribution.icon,
    };
    this.surfaces.set(surfaceId, surface);
    this.surfaceIdByHandle.set(handle, surfaceId);
    this.emitSnapshot();
    const request = this.runtime.sendExtAwaitTerminalReply(
      this.runtime.rpcIds.ExtHostWebviewViews,
      "$resolveWebviewView",
      [handle, contribution.viewType, contribution.title, surface.state],
      true,
      30000,
    );
    try {
      await request.promise;
    } catch (error) {
      this.disposeSurface(surface, "resolve_failed");
      throw error;
    }
  }

  private waitForProvider(viewType: string, timeoutMs: number): Promise<void> {
    if (this.providers.has(viewType)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.providerWaiters.get(viewType);
        waiters?.delete(complete);
        if (waiters?.size === 0) this.providerWaiters.delete(viewType);
        reject(new Error(`timed out waiting for webview provider: ${viewType}`));
      }, timeoutMs);
      const complete = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const waiters = this.providerWaiters.get(viewType) ?? new Set<() => void>();
      waiters.add(complete);
      this.providerWaiters.set(viewType, waiters);
    });
  }

  private findSurfaceByView(viewType: string): ExtensionWebviewSurface | null {
    for (const surface of this.surfaces.values()) {
      if (surface.viewId === viewType && surface.projectPath === this.workspaceFolder()) return surface;
    }
    return null;
  }

  private surfaceForHandle(value: unknown): ExtensionWebviewSurface | null {
    const surfaceId = this.surfaceIdByHandle.get(stringValue(value));
    return surfaceId ? this.surfaces.get(surfaceId) ?? null : null;
  }

  private requiredSurface(value: unknown): ExtensionWebviewSurface {
    const surface = this.surfaces.get(stringValue(value));
    if (!surface) throw new Error(`unknown webview surface: ${stringValue(value) || "(missing)"}`);
    return surface;
  }

  dispose(params: JsonObject): JsonObject {
    const surface = this.requiredSurface(params.surfaceId);
    this.disposeSurface(surface, "client_closed", true);
    return { ok: true };
  }

  private disposeSurface(
    surface: ExtensionWebviewSurface,
    reason: string,
    notifyExtensionHost = false,
  ): void {
    this.surfaces.delete(surface.surfaceId);
    this.surfaceIdByHandle.delete(surface.handle);
    this.notify(surface, "dispose", { reason });
    if (notifyExtensionHost) {
      if (surface.surfaceKind === "panel") {
        this.runtime.sendExt(
          this.runtime.rpcIds.ExtHostWebviewPanels,
          "$onDidDisposeWebviewPanel",
          [surface.handle],
          false,
        );
      } else {
        this.runtime.sendExt(
          this.runtime.rpcIds.ExtHostWebviewViews,
          "$disposeWebviewView",
          [surface.handle],
          false,
        );
      }
    }
    this.emitSnapshot(surface.projectPath);
  }

  private sendPanelViewState(
    surface: ExtensionWebviewSurface,
    visible: boolean,
  ): void {
    this.runtime.sendExt(
      this.runtime.rpcIds.ExtHostWebviewPanels,
      "$onDidChangeWebviewPanelViewStates",
      [{
        [surface.handle]: {
          active: visible,
          visible,
          position: surface.viewColumn,
        },
      }],
      false,
    );
  }

  private workspaceFolder(): string {
    return stringValue(this.runtime.getWorkspaceFolder());
  }

  private localResourceRoots(surface: ExtensionWebviewSurface): UriRecord[] {
    const configured = Array.isArray(surface.options.localResourceRoots)
      ? surface.options.localResourceRoots.map(uriRecord).filter((value): value is UriRecord => !!value)
      : [];
    const roots: UriRecord[] = [...configured];
    if (surface.iconResource) roots.push(surface.iconResource);
    if (configured.length) return roots;
    if (surface.extensionLocation) roots.push(surface.extensionLocation);
    const projectPath = stringValue(surface.projectPath);
    if (projectPath) {
      roots.push({
        scheme: surface.extensionLocation?.scheme || "file",
        authority: surface.extensionLocation?.authority || "",
        path: projectPath,
      });
    }
    return roots;
  }

  private publicSurface(surface: ExtensionWebviewSurface): JsonObject {
    return {
      dto: surface.dto,
      version: surface.version,
      surfaceId: surface.surfaceId,
      hostId: surface.hostId,
      workspaceId: surface.workspaceId,
      projectPath: surface.projectPath,
      extensionId: surface.extensionId,
      viewId: surface.viewId,
      surfaceKind: surface.surfaceKind,
      title: surface.title,
      description: surface.description,
      badge: surface.badge,
      url: surface.url,
      htmlRevision: surface.htmlRevision,
      options: surface.options,
      state: surface.state,
      serializeBuffersForPostMessage: surface.serializeBuffersForPostMessage,
      visible: surface.visible,
      retainContextWhenHidden: surface.retainContextWhenHidden,
      viewColumn: surface.viewColumn,
      iconUrl: surface.iconUrl,
    };
  }

  private snapshotFor(projectPath: string): JsonObject {
    const surfaces = [...this.surfaces.values()]
      .filter((surface) => !projectPath || surface.projectPath === projectPath)
      .map((surface) => this.publicSurface(surface));
    return {
      type: "webview/snapshot",
      ts_ms: Date.now(),
      workspaceFolder: projectPath || null,
      workspaceId: projectPath ? stableHash(projectPath) : null,
      surfaces,
    };
  }

  private emitSnapshot(projectPath = this.workspaceFolder()): void {
    this.runtime.onLifecycleEvent(this.snapshotFor(projectPath));
  }

  private notify(
    surface: ExtensionWebviewSurface,
    event: string,
    extra: JsonObject,
  ): void {
    this.runtime.onClientNotification("vscode.webview.event", {
      surfaceId: surface.surfaceId,
      event,
      ...extra,
    });
  }
}
