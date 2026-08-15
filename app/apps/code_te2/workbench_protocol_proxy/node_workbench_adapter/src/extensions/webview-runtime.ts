import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { encodeWbaRpcMessage } from "../protocol/messagepack-codec.mjs";
import type { DecodedExtHostRpc } from "../protocol/wire-encoding";
import { serializableBuffersArgument } from "../protocol/wire-encoding.mjs";
import {
  WebviewReconstructionStore,
  type WebviewReconstructionRecord,
} from "./webview-reconstruction-store.mjs";

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

interface WebviewClientEvent extends JsonObject {
  surfaceId: string;
  clientInstanceId?: string;
  event: string;
  serverEpoch: string;
  surfaceGeneration: string;
  htmlRevision: number;
  sequence: number;
}

interface WebviewSurfaceTransportState {
  surfaceGeneration: string;
  sequence: number;
  journal: WebviewClientEvent[];
  journalBytes: number;
}

interface WebviewRuntimeSurface extends ExtensionWebviewSurface {
  runtimeId: string;
  clientInstanceId: string;
  resourceScopeToken: string;
}

interface WebviewResourceScope {
  key: string;
  token: string;
  roots: UriRecord[];
  extensionLocation: UriRecord | null;
  runtimeIds: Set<string>;
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
  etag: string;
  lastModified: string;
  cacheControl: string;
}

export interface WebviewRuntimeOptions {
  reconstructionStoragePath: string;
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
  sendExt(
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable?: boolean,
  ): number;
  sendExtMixed(
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable?: boolean,
  ): number;
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
const MAX_WEBVIEW_EVENT_JOURNAL_COUNT = 256;
const MAX_WEBVIEW_EVENT_JOURNAL_BYTES = 2 * 1024 * 1024;
const WEBVIEW_RESOURCE_HOST =
  /https:\/\/([a-z][a-z0-9+.-]*)(?:\+|%2b)([^/]*?)\.vscode-resource\.vscode-cdn\.net(\/[^\s\"'<>)]*)?/gi;

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
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
  if (
    !isRecord(theme) ||
    theme.name !== "GitHub Dark Default" ||
    !isRecord(theme.colors)
  ) {
    throw new Error(
      `Invalid built-in extension webview theme: ${themeUrl.pathname}`,
    );
  }

  const styles: Record<string, string> = {
    "vscode-font-family":
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    "vscode-font-weight": "normal",
    "vscode-font-size": "13px",
    "vscode-editor-font-family":
      '"JetBrains Mono Nerd", "JetBrains Mono", monospace',
    "vscode-editor-font-weight": "normal",
    "vscode-editor-font-size": "14px",
    "vscode-editor-font-feature-settings": '"liga" 1, "calt" 1',
    "text-link-decoration": "none",
  };
  for (const [colorId, color] of Object.entries(theme.colors)) {
    if (typeof color !== "string" || !/^[A-Za-z0-9.-]+$/.test(colorId))
      continue;
    styles[`vscode-${colorId.replace(/\./g, "-")}`] = color;
  }
  if (
    styles["vscode-sideBar-background"] !== "#010409" ||
    styles["vscode-editor-foreground"] !== "#e6edf3"
  ) {
    throw new Error(
      `Unexpected built-in extension webview theme payload: ${themeUrl.pathname}`,
    );
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
    const existingClasses =
      classMatch?.[2]
        ?.split(/\s+/)
        .filter(
          (name) =>
            name &&
            !/^vscode-(?:light|dark|high-contrast(?:-light)?)$/.test(name),
        ) ?? [];
    const classValue = [
      ...existingClasses,
      BUILT_IN_WEBVIEW_THEME.activeTheme,
    ].join(" ");
    let themedTag = classMatch
      ? bodyTag.replace(classPattern, ` class="${classValue}"`)
      : bodyTag.replace(/^<body/i, `<body class="${classValue}"`);
    for (const [name, value] of [
      ["data-vscode-theme-kind", BUILT_IN_WEBVIEW_THEME.activeTheme],
      ["data-vscode-theme-name", BUILT_IN_WEBVIEW_THEME.themeLabel],
      ["data-vscode-theme-id", BUILT_IN_WEBVIEW_THEME.themeId],
    ]) {
      const attributePattern = new RegExp(
        `\\s${name}\\s*=\\s*(["'])[^"']*\\1`,
        "i",
      );
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

function extensionResourceUri(
  location: UriRecord | null,
  relativePath: unknown,
): UriRecord | null {
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
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, length);
}

function pathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resourceContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return (
    (
      {
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
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
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
    String.fromCharCode(Number.parseInt(code, 16)),
  );
}

function rewriteResourceUrls(
  resourceScopeToken: string,
  html: string,
): string {
  const resourceBase = `${PUBLIC_WEBVIEW_BASE}/resource/${encodeURIComponent(resourceScopeToken)}`;
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

function inlineJson(value: unknown): string {
  return (JSON.stringify(value) ?? "null")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function innerBridge(record: WebviewReconstructionRecord): string {
  const initialState = inlineJson(record.vscodeState);
  const initialStorage = inlineJson(record.localStorage);
  return `<script data-te2-webview-bridge>(function(){
let apiState=${initialState};
let acquired=false;
let contextMenuEnabled=false;
function post(kind,value){window.parent.postMessage({__te2ExtensionWebview:true,kind,value},'*');}
function contextValues(target){
  const result={};const nodes=[];
  for(let node=target;node&&node.nodeType===1;node=node.parentElement)nodes.push(node);
  nodes.reverse();
  for(const node of nodes){const raw=node.getAttribute&&node.getAttribute('data-vscode-context');if(!raw)continue;try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))continue;for(const [key,item] of Object.entries(value)){if(typeof item==='string'||typeof item==='boolean'||(typeof item==='number'&&Number.isFinite(item))||item===null)result[key]=item;}}catch{}}
  return result;
}
function createStorage(persistent,initial){
  const entries=new Map();
  if(Array.isArray(initial)){for(const item of initial){if(Array.isArray(item)&&item.length===2)entries.set(String(item[0]),String(item[1]));}}
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
  return {storage};
}
const localStorageBridge=createStorage(true,${initialStorage});
const sessionStorageBridge=createStorage(false,[]);
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
  if(data.kind==='contextMenuPolicy'){contextMenuEnabled=data.value?.enabled===true;return;}
  if(data.kind==='message')window.dispatchEvent(new MessageEvent('message',{
    data:data.value,
    origin:window.location.origin,
    source:window
  }));
});
document.addEventListener('contextmenu',function(event){
  if(!contextMenuEnabled)return;
  event.preventDefault();event.stopPropagation();
  const target=event.target&&event.target.nodeType===1?event.target:null;
  post('contextmenu',{x:Number(event.clientX)||0,y:Number(event.clientY)||0,context:contextValues(target),hasSelection:!!String(window.getSelection?.()||''),editable:!!target?.closest?.('input,textarea,[contenteditable="true"],[contenteditable=""]')});
},true);
post('ready',null);
})();</script>`;
}

function webviewResourceOrigin(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) throw new Error("extension webview resource origin is required");
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("extension webview resource origin must use HTTP or HTTPS");
  }
  return parsed.origin;
}

function transformWebviewHtml(
  resourceScopeToken: string,
  html: string,
  resourceOrigin: string,
  record: WebviewReconstructionRecord,
): string {
  let transformed = rewriteResourceUrls(resourceScopeToken, html || "");
  transformed = transformed.replace(
    /https:\/\/\*\.vscode-cdn\.net/gi,
    "__TE2_WEBVIEW_RESOURCE_ORIGIN__",
  );
  transformed = decorateWebviewBody(transformed);
  transformed = transformed.replaceAll(
    "__TE2_WEBVIEW_RESOURCE_ORIGIN__",
    webviewResourceOrigin(resourceOrigin),
  );
  const bootstrap = `${webviewThemeStyle()}${innerBridge(record)}`;
  if (/<head(?:\s[^>]*)?>/i.test(transformed)) {
    return transformed.replace(
      /<head(?:\s[^>]*)?>/i,
      (head) => `${head}${bootstrap}`,
    );
  }
  return `${bootstrap}${transformed}`;
}

function wrapperHtml(surfaceId: string): string {
  const safeSurfaceId = JSON.stringify(surfaceId);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#te2-webview{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#010409}#te2-status{position:absolute;inset:0;display:grid;place-items:center;color:#7d8590;font:13px system-ui}#te2-status[hidden],#te2-context-menu[hidden]{display:none}#te2-context-menu{position:fixed;z-index:10;min-width:190px;max-width:min(360px,calc(100vw - 16px));max-height:min(420px,calc(100vh - 16px));overflow:auto;padding:4px;background:#161b22;border:1px solid #30363d;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.5);font:13px system-ui;color:#e6edf3}#te2-context-menu button{display:block;width:100%;padding:6px 10px;border:0;border-radius:2px;background:transparent;color:inherit;text-align:left;font:inherit;white-space:normal}#te2-context-menu button:hover:not(:disabled),#te2-context-menu button:focus-visible{background:#1f6feb;outline:0}#te2-context-menu button:disabled{opacity:.5}</style></head>
<body><div id="te2-status">Loading extension view…</div><iframe id="te2-webview" title="Extension view" hidden></iframe><div id="te2-context-menu" role="menu" hidden></div>
<script src="./runtime/socket.io.min.js"></script>
<script type="module">
import {encodeWbaRpcMessage,decodeWbaRpcMessage} from './runtime/messagepack-codec.mjs';
const surfaceId=${safeSurfaceId};
const status=document.getElementById('te2-status');
const frame=document.getElementById('te2-webview');
const contextMenu=document.getElementById('te2-context-menu');
const pending=new Map();let nextId=1;let ready=false;let queued=[];let loadRevision=0;
let disposed=false;let reconciling=false;let reconcileRevision=0;let bufferedEvents=[];
let serializeBuffers=false;
let webviewId='';let webviewContextMenuContributed=false;let activeContextMenuContext={};
let reconstruction={revision:0,writerLease:'',vscodeState:null,localStorage:[]};
let reconstructionDirty=false;let persistenceInFlight=false;
const transport={loaded:false,serverEpoch:'',surfaceGeneration:'',htmlRevision:-1,lastServerSequence:0};
const query=new URLSearchParams(window.location.search);
function requiredIdentity(name){const value=String(query.get(name)||'').trim();if(!value)throw new Error('Missing extension webview '+name);return value;}
const clientInstanceId=requiredIdentity('clientInstanceId');
const windowId=String(query.get('windowId')||sessionStorage.getItem('te2.extension-webview.window.v1')||crypto.randomUUID()).trim();
sessionStorage.setItem('te2.extension-webview.window.v1',windowId);
const presentationId=requiredIdentity('presentationId');
const socket=window.io('/wba',{path:'/api/app/code_te2/services/wba/socket.io',transports:['websocket'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:5000,randomizationFactor:0.25,auth:{rpcCodec:'msgpack-v1'}});
function errorMessage(error){return String(error&&error.message||error||'Unknown extension webview error');}
function rpc(method,params){return new Promise((resolve,reject)=>{if(!socket.connected){reject(new Error('WBA transport is disconnected'));return;}const id=nextId++;pending.set(id,{resolve,reject});socket.emit('rpc',encodeWbaRpcMessage({jsonrpc:'2.0',id,method,params}));});}
function rejectPending(error){for(const waiter of pending.values())waiter.reject(error);pending.clear();}
function serialize(value){if(!serializeBuffers)return {jsonMessage:JSON.stringify(value)??'null',buffers:[]};const buffers=[];const seen=new WeakSet();const jsonMessage=JSON.stringify(value,(_key,item)=>{if(item&&typeof item==='object'){if(seen.has(item))throw new TypeError('Cannot serialize cyclic webview message');seen.add(item);if(item instanceof ArrayBuffer){const index=buffers.push(new Uint8Array(item))-1;return {$$vscode_array_buffer_reference$$:true,index};}if(ArrayBuffer.isView(item)){const index=buffers.push(new Uint8Array(item.buffer))-1;return {$$vscode_array_buffer_reference$$:true,index,view:{type:item.constructor.name,byteLength:item.byteLength,byteOffset:item.byteOffset}};}}return item;})??'null';return {jsonMessage,buffers};}
function deserialize(jsonMessage,buffers){const arrays=(buffers||[]).map(bytes=>{const copy=new Uint8Array(bytes).slice();return copy.buffer;});return JSON.parse(jsonMessage,(_key,item)=>{if(!item||item.$$vscode_array_buffer_reference$$!==true)return item;const buffer=arrays[item.index];if(!item.view)return buffer;const ctor=globalThis[item.view.type];return typeof ctor==='function'?new ctor(buffer,item.view.byteOffset,item.view.byteLength/ctor.BYTES_PER_ELEMENT):buffer;});}
function deliver(kind,value){if(!ready){queued.push([kind,value]);return;}frame.contentWindow.postMessage({__te2ExtensionWebviewHost:true,kind,value},'*');}
function closeContextMenu(){contextMenu.hidden=true;contextMenu.replaceChildren();activeContextMenuContext={};}
function primitiveContext(value){const result={};if(!value||typeof value!=='object'||Array.isArray(value))return result;for(const [key,item] of Object.entries(value)){if(typeof item==='string'||typeof item==='boolean'||(typeof item==='number'&&Number.isFinite(item))||item===null)result[key]=item;}return result;}
async function openContextMenu(request){
  closeContextMenu();if(!webviewContextMenuContributed)return;
  const supplied=primitiveContext(request?.context);const context={...supplied,webviewId,webviewHasSelection:request?.hasSelection===true,webviewInputFocus:request?.editable===true};activeContextMenuContext=context;
  try{const result=await rpc('vscode.extensionMenus.resolve',{menu:'webview/context',surface:'webview',context});const actions=Array.isArray(result?.actions)?result.actions:[];if(!actions.length)return;for(const action of actions){if(!action||typeof action.command!=='string'||typeof action.title!=='string')continue;const button=document.createElement('button');button.type='button';button.role='menuitem';button.textContent=action.category?String(action.category)+': '+action.title:action.title;button.disabled=action.enabled===false;button.addEventListener('click',()=>{const command=action.command;const commandContext=activeContextMenuContext;closeContextMenu();void rpc('vscode.extensionCommands.execute',{command,surface:'webview',context:commandContext}).catch(error=>console.error('[extension-webview] context command failed',error));});contextMenu.appendChild(button);}if(!contextMenu.childElementCount)return;contextMenu.hidden=false;const margin=8;const x=Math.max(margin,Math.min(Number(request?.x)||0,window.innerWidth-contextMenu.offsetWidth-margin));const y=Math.max(margin,Math.min(Number(request?.y)||0,window.innerHeight-contextMenu.offsetHeight-margin));contextMenu.style.left=x+'px';contextMenu.style.top=y+'px';contextMenu.querySelector('button:not(:disabled)')?.focus();}catch(error){closeContextMenu();console.error('[extension-webview] context menu failed',error);}
}
async function flushReconstruction(){if(persistenceInFlight||!reconstructionDirty||!socket.connected||!reconstruction.writerLease)return;persistenceInFlight=true;try{while(reconstructionDirty&&socket.connected&&reconstruction.writerLease){reconstructionDirty=false;const writerLease=reconstruction.writerLease;const revision=reconstruction.revision+1;const result=await rpc('vscode.webview.state',{surfaceId,clientInstanceId,windowId,presentationId,revision,writerLease,vscodeState:reconstruction.vscodeState,localStorage:reconstruction.localStorage});if(writerLease!==reconstruction.writerLease){reconstructionDirty=true;continue;}if(result?.accepted===false){reconstruction.revision=Math.max(reconstruction.revision,Number(result.revision||0));console.warn('[extension-webview] stale reconstruction write rejected',result);break;}reconstruction.revision=Math.max(revision,Number(result?.revision||revision));}}catch(error){reconstructionDirty=true;throw error;}finally{persistenceInFlight=false;}}
function persist(){reconstructionDirty=true;void flushReconstruction().catch(error=>console.error('[extension-webview] reconstruction relay failed',error));}
function attachParams(){const params={surfaceId,clientInstanceId,windowId,presentationId};if(transport.loaded){Object.assign(params,{serverEpoch:transport.serverEpoch,surfaceGeneration:transport.surfaceGeneration,loadedHtmlRevision:transport.htmlRevision,lastServerSequence:transport.lastServerSequence});}return params;}
async function attach(){return await rpc('vscode.webview.attach',attachParams());}
function adoptReconstruction(snapshot,preserveLocal){const record=snapshot.reconstruction||{};const local={vscodeState:reconstruction.vscodeState,localStorage:reconstruction.localStorage};reconstruction={revision:Number(record.revision||0),writerLease:String(record.writerLease||''),vscodeState:preserveLocal?local.vscodeState:record.vscodeState,localStorage:preserveLocal?local.localStorage:(Array.isArray(record.localStorage)?record.localStorage:[])};}
async function load(snapshot){const currentLoad=++loadRevision;const token=String(snapshot.bootstrapToken||'');if(!token)throw new Error('WBA reload response omitted its bootstrap token');closeContextMenu();ready=false;queued=[];serializeBuffers=snapshot.serializeBuffersForPostMessage===true;adoptReconstruction(snapshot,false);reconstructionDirty=false;const sandbox=[snapshot.options?.enableScripts?'allow-scripts':'',snapshot.options?.enableForms?'allow-forms':'','allow-downloads','allow-popups','allow-popups-to-escape-sandbox'].filter(Boolean).join(' ');frame.setAttribute('sandbox',sandbox);const documentUrl=new URL('./'+encodeURIComponent(surfaceId)+'/document',window.location.href);documentUrl.searchParams.set('revision',String(snapshot.htmlRevision||0));documentUrl.searchParams.set('resourceOrigin',window.location.origin);documentUrl.searchParams.set('bootstrapToken',token);if(currentLoad!==loadRevision)return;frame.src=documentUrl.href;frame.hidden=false;}
function bufferServerEvent(event){bufferedEvents.push(event);if(bufferedEvents.length>512)bufferedEvents=bufferedEvents.slice(-512);}
function applyServerEvent(event,fromResume=false){if(disposed||!event||event.surfaceId!==surfaceId)return;if(event.clientInstanceId&&event.clientInstanceId!==clientInstanceId)return;if(reconciling&&!fromResume){bufferServerEvent(event);return;}const epoch=String(event.serverEpoch||'');const generation=String(event.surfaceGeneration||'');const revision=Number(event.htmlRevision);const sequence=Number(event.sequence);if(!Number.isSafeInteger(sequence))return;if(transport.loaded&&epoch===transport.serverEpoch&&generation===transport.surfaceGeneration&&sequence<=transport.lastServerSequence)return;if(!transport.loaded||epoch!==transport.serverEpoch||generation!==transport.surfaceGeneration||revision!==transport.htmlRevision){bufferServerEvent(event);void reconcileTransport();return;}if(sequence!==transport.lastServerSequence+1){bufferServerEvent(event);void reconcileTransport();return;}transport.lastServerSequence=sequence;if(event.event==='message')deliver('message',deserialize(event.jsonMessage,event.buffers));else if(event.event==='reload')void reconcileTransport();else if(event.event==='dispose'){disposed=true;status.hidden=false;status.textContent='Extension view closed';frame.remove();rejectPending(new Error('Extension view closed'));}}
function drainBufferedEvents(){const events=bufferedEvents.splice(0).sort((left,right)=>Number(left?.sequence||0)-Number(right?.sequence||0));for(const event of events)applyServerEvent(event);}
async function reconcileTransport(){if(disposed||reconciling||!socket.connected)return;reconciling=true;const currentReconcile=++reconcileRevision;status.hidden=false;status.textContent=transport.loaded?'Reconnecting extension view…':'Loading extension view…';try{const result=await attach();if(currentReconcile!==reconcileRevision||!socket.connected)return;webviewId=String(result.viewId||webviewId);webviewContextMenuContributed=result.webviewContextMenuContributed===true;const action=String(result.action||'reload');const eventSequence=Number(result.eventSequence||0);const priorSequence=transport.lastServerSequence;if(action==='reload'){transport.serverEpoch=String(result.serverEpoch||'');transport.surfaceGeneration=String(result.surfaceGeneration||'');transport.htmlRevision=Number(result.htmlRevision||0);transport.lastServerSequence=eventSequence;await load(result);transport.loaded=true;if(result.bootstrapReplayComplete===false)console.warn('[extension-webview] current document startup event journal is incomplete');for(const event of Array.isArray(result.bootstrapEvents)?result.bootstrapEvents:[]){if(event?.event==='message')deliver('message',deserialize(event.jsonMessage,event.buffers));}}else{if(!transport.loaded)throw new Error('WBA attempted to resume an unloaded extension document');adoptReconstruction(result,true);transport.serverEpoch=String(result.serverEpoch||'');transport.surfaceGeneration=String(result.surfaceGeneration||'');transport.htmlRevision=Number(result.htmlRevision||0);transport.lastServerSequence=priorSequence;if(action==='replay'){for(const event of Array.isArray(result.replayEvents)?result.replayEvents:[])applyServerEvent(event,true);}else if(action!=='resume'){throw new Error('Unsupported WBA resume action: '+action);}if(transport.lastServerSequence!==eventSequence)throw new Error('WBA resume sequence did not converge');}deliver('contextMenuPolicy',{enabled:webviewContextMenuContributed});status.hidden=true;if(reconstructionDirty)void flushReconstruction().catch(error=>console.error('[extension-webview] reconnect state relay failed',error));}catch(error){if(currentReconcile===reconcileRevision){status.hidden=false;status.textContent=errorMessage(error);}}finally{if(currentReconcile===reconcileRevision){reconciling=false;drainBufferedEvents();}}}
socket.on('connect',()=>{void reconcileTransport();});
socket.on('disconnect',()=>{reconcileRevision+=1;reconciling=false;bufferedEvents=[];rejectPending(new Error('WBA transport disconnected'));if(Array.isArray(socket.sendBuffer))socket.sendBuffer.length=0;status.hidden=false;status.textContent='Extension host disconnected';});
socket.on('connect_error',error=>{status.hidden=false;status.textContent=errorMessage(error);});
socket.on('rpc',payload=>{const message=decodeWbaRpcMessage(payload);const messages=Array.isArray(message)?message:[message];for(const item of messages){if(item&&item.id!=null&&pending.has(item.id)){const waiter=pending.get(item.id);pending.delete(item.id);item.error?waiter.reject(new Error(item.error.message||'RPC failed')):waiter.resolve(item.result);continue;}if(item?.method==='vscode.webview.event'&&item.params?.surfaceId===surfaceId)applyServerEvent(item.params);}});
window.addEventListener('message',event=>{
  if(event.source!==frame.contentWindow)return;
  const data=event.data;
  if(!data||data.__te2ExtensionWebview!==true)return;
  if(data.kind==='ready'){
    ready=true;
    for(const entry of queued.splice(0))deliver(entry[0],entry[1]);
    return;
  }
  if(data.kind==='message'){
    const serialized=serialize(data.value);
    void rpc('vscode.webview.message',{surfaceId,clientInstanceId,...serialized}).catch(error=>console.error('[extension-webview] message relay failed',error));
  }else if(data.kind==='state'){
    reconstruction.vscodeState=data.value;
    persist();
  }else if(data.kind==='storage'){
    reconstruction.localStorage=data.value;
    persist();
  }else if(data.kind==='contextmenu'){
    void openContextMenu(data.value);
  }
});
window.addEventListener('pointerdown',event=>{if(!contextMenu.hidden&&!contextMenu.contains(event.target))closeContextMenu();},true);
window.addEventListener('keydown',event=>{if(event.key==='Escape')closeContextMenu();},true);
window.addEventListener('blur',closeContextMenu);
</script></body></html>`;
}

export class WebviewRuntime {
  private readonly serverEpoch = crypto.randomUUID();
  private readonly providers = new Map<string, WebviewProvider>();
  private readonly surfaces = new Map<string, ExtensionWebviewSurface>();
  private readonly runtimeSurfaces = new Map<string, WebviewRuntimeSurface>();
  private readonly runtimeIdByHandle = new Map<string, string>();
  private readonly resourceScopesByKey = new Map<string, WebviewResourceScope>();
  private readonly resourceScopesByToken = new Map<string, WebviewResourceScope>();
  private readonly resolvingRuntimeSurfaces = new Map<
    string,
    Promise<WebviewRuntimeSurface>
  >();
  private readonly surfaceTransport = new Map<
    string,
    WebviewSurfaceTransportState
  >();
  private readonly providerWaiters = new Map<string, Set<() => void>>();
  private readonly reconstructionStore: WebviewReconstructionStore;
  private readonly bootstrapTokens = new Map<
    string,
    {
      surfaceId: string;
      runtimeId: string;
      record: WebviewReconstructionRecord;
      expiresAt: number;
    }
  >();

  constructor(private readonly runtime: WebviewRuntimeOptions) {
    this.reconstructionStore = new WebviewReconstructionStore(
      runtime.reconstructionStoragePath,
    );
  }

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
    await Promise.all(
      contributions.map(async (contribution) => {
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
      }),
    );
    this.emitSnapshot();
  }

  clear(reason: string, clearProviders = true): void {
    const oldWorkspace = this.workspaceFolder();
    for (const runtimeSurface of [...this.runtimeSurfaces.values()]) {
      try {
        this.runtime.sendExt(
          runtimeSurface.surfaceKind === "panel"
            ? this.runtime.rpcIds.ExtHostWebviewPanels
            : this.runtime.rpcIds.ExtHostWebviewViews,
          runtimeSurface.surfaceKind === "panel"
            ? "$onDidDisposeWebviewPanel"
            : "$disposeWebviewView",
          [runtimeSurface.handle],
          false,
        );
      } catch {}
      this.notify(runtimeSurface, "dispose", { reason });
    }
    if (clearProviders) this.providers.clear();
    this.surfaces.clear();
    this.runtimeSurfaces.clear();
    this.runtimeIdByHandle.clear();
    this.resourceScopesByKey.clear();
    this.resourceScopesByToken.clear();
    this.resolvingRuntimeSurfaces.clear();
    this.surfaceTransport.clear();
    if (clearProviders) this.providerWaiters.clear();
    this.emitSnapshot(oldWorkspace);
  }

  snapshot(): JsonObject {
    return this.snapshotFor(this.workspaceFolder());
  }

  async attach(params: JsonObject): Promise<JsonObject> {
    const surface = this.requiredSurface(params.surfaceId);
    const clientInstanceId = stringValue(params.clientInstanceId);
    const windowId = stringValue(params.windowId);
    const presentationId = stringValue(params.presentationId);
    if (!clientInstanceId || !windowId || !presentationId) {
      throw new Error(
        "extension webview attach requires client, window, and presentation identity",
      );
    }
    const record = await this.reconstructionStore.attach(
      clientInstanceId,
      surface.surfaceId,
    );
    const runtimeSurface = await this.runtimeSurfaceForAttach(
      surface,
      clientInstanceId,
      record.vscodeState,
    );
    const transport = this.requiredTransport(runtimeSurface.runtimeId);
    if (
      this.surfaces.get(surface.surfaceId) !== surface ||
      this.runtimeSurfaces.get(runtimeSurface.runtimeId) !== runtimeSurface ||
      this.surfaceTransport.get(runtimeSurface.runtimeId) !== transport
    ) {
      throw new Error(
        `webview surface changed during attach: ${surface.surfaceId}`,
      );
    }
    const requestedEpoch = stringValue(params.serverEpoch);
    const requestedGeneration = stringValue(params.surfaceGeneration);
    const requestedRevision = nonNegativeInteger(params.loadedHtmlRevision);
    const requestedSequence = nonNegativeInteger(params.lastServerSequence);
    let action: "resume" | "replay" | "reload" = "reload";
    let reason = "initial_attach";
    let replayEvents: WebviewClientEvent[] = [];
    const hasResumeIdentity =
      !!requestedEpoch &&
      !!requestedGeneration &&
      requestedRevision !== null &&
      requestedSequence !== null;
    if (hasResumeIdentity) {
      if (requestedEpoch !== this.serverEpoch) {
        reason = "server_epoch_changed";
      } else if (requestedGeneration !== transport.surfaceGeneration) {
        reason = "surface_generation_changed";
      } else if (requestedRevision !== runtimeSurface.htmlRevision) {
        reason = "html_revision_changed";
      } else if (requestedSequence > transport.sequence) {
        reason = "client_sequence_ahead";
      } else if (requestedSequence === transport.sequence) {
        action = "resume";
        reason = "current";
      } else {
        const firstRetainedSequence =
          transport.journal[0]?.sequence ?? transport.sequence + 1;
        if (requestedSequence < firstRetainedSequence - 1) {
          reason = "event_replay_gap";
        } else {
          action = "replay";
          reason = "event_replay";
          replayEvents = transport.journal
            .filter((event) => event.sequence > requestedSequence)
            .map((event) => structuredClone(event));
        }
      }
    }
    let bootstrapToken: string | undefined;
    let bootstrapReplayComplete = true;
    let bootstrapEvents: WebviewClientEvent[] = [];
    if (action === "reload") {
      if (transport.sequence > 0) {
        let revisionStart = -1;
        for (let index = transport.journal.length - 1; index >= 0; index -= 1) {
          const event = transport.journal[index];
          if (
            event.event === "reload" &&
            event.htmlRevision === runtimeSurface.htmlRevision
          ) {
            revisionStart = index;
            break;
          }
        }
        bootstrapReplayComplete = revisionStart >= 0;
        if (revisionStart >= 0) {
          bootstrapEvents = transport.journal
            .slice(revisionStart + 1)
            .filter(
              (event) =>
                event.htmlRevision === runtimeSurface.htmlRevision &&
                event.event === "message",
            )
            .map((event) => structuredClone(event));
        }
      }
      bootstrapToken = crypto.randomUUID();
      this.bootstrapTokens.set(bootstrapToken, {
        surfaceId: surface.surfaceId,
        runtimeId: runtimeSurface.runtimeId,
        record,
        expiresAt: Date.now() + 30_000,
      });
      this.pruneBootstrapTokens();
    }
    return {
      ...this.publicSurface(runtimeSurface),
      action,
      reason,
      serverEpoch: this.serverEpoch,
      surfaceGeneration: transport.surfaceGeneration,
      eventSequence: transport.sequence,
      replayEvents,
      bootstrapReplayComplete,
      bootstrapEvents,
      bootstrapToken,
      reconstruction: {
        revision: record.revision,
        writerLease: record.writerLease,
        vscodeState: record.vscodeState,
        localStorage: record.localStorage,
      },
    };
  }

  receiveBrowserMessage(params: JsonObject): JsonObject {
    const surface = this.requiredSurface(params.surfaceId);
    const runtimeSurface = this.requiredRuntimeSurface(
      surface,
      params.clientInstanceId,
    );
    const jsonMessage =
      typeof params.jsonMessage === "string"
        ? params.jsonMessage
        : JSON.stringify(params.message ?? null);
    const buffers = Array.isArray(params.buffers)
      ? params.buffers.filter(
          (value): value is Uint8Array => value instanceof Uint8Array,
        )
      : [];
    const references = buffers.map((_buffer, index) => ({ $$ref$$: index }));
    this.runtime.sendExtMixed(
      this.runtime.rpcIds.ExtHostWebviews,
      "$onMessage",
      [
        runtimeSurface.handle,
        jsonMessage,
        serializableBuffersArgument(references, buffers),
      ],
      false,
    );
    return { ok: true };
  }

  async setBrowserState(params: JsonObject): Promise<JsonObject> {
    const surface = this.requiredSurface(params.surfaceId);
    return await this.reconstructionStore.write({
      clientInstanceId: params.clientInstanceId,
      surfaceId: surface.surfaceId,
      revision: params.revision,
      writerLease: params.writerLease,
      vscodeState: params.vscodeState,
      localStorage: params.localStorage,
    });
  }

  async resetClientState(params: JsonObject): Promise<JsonObject> {
    return await this.reconstructionStore.resetClient(params.clientInstanceId);
  }

  setVisibility(params: JsonObject): JsonObject {
    const surface = this.requiredSurface(params.surfaceId);
    const visible = params.visible !== false;
    const runtimeSurfaces =
      surface.surfaceKind === "panel"
        ? [this.requiredRuntimeSurface(surface, params.clientInstanceId)]
        : stringValue(params.clientInstanceId)
          ? [this.requiredRuntimeSurface(surface, params.clientInstanceId)]
          : [...this.runtimeSurfaces.values()].filter(
              (candidate) => candidate.surfaceId === surface.surfaceId,
            );
    for (const runtimeSurface of runtimeSurfaces) {
      if (runtimeSurface.visible === visible) continue;
      runtimeSurface.visible = visible;
      if (runtimeSurface.surfaceKind === "panel") {
        this.sendPanelViewState(runtimeSurface, visible);
      } else {
        this.runtime.sendExt(
          this.runtime.rpcIds.ExtHostWebviewViews,
          "$onDidChangeWebviewViewVisibility",
          [runtimeSurface.handle, visible],
          false,
        );
      }
    }
    surface.visible = visible;
    return { ok: true, visible };
  }

  wrapper(surfaceId: string): string {
    this.requiredSurface(surfaceId);
    return wrapperHtml(surfaceId);
  }

  document(
    surfaceId: string,
    resourceOrigin: string,
    bootstrapToken: string,
  ): string {
    const bootstrap = this.bootstrapTokens.get(bootstrapToken);
    this.bootstrapTokens.delete(bootstrapToken);
    if (
      !bootstrap ||
      bootstrap.expiresAt < Date.now() ||
      bootstrap.surfaceId !== surfaceId
    ) {
      throw new Error(
        "extension webview bootstrap token is invalid or expired",
      );
    }
    const runtimeSurface = this.runtimeSurfaces.get(bootstrap.runtimeId);
    if (!runtimeSurface || runtimeSurface.surfaceId !== surfaceId) {
      throw new Error("extension webview runtime is no longer available");
    }
    return transformWebviewHtml(
      this.bindResourceScope(runtimeSurface).token,
      runtimeSurface.html,
      resourceOrigin,
      bootstrap.record,
    );
  }

  private pruneBootstrapTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.bootstrapTokens) {
      if (entry.expiresAt < now) this.bootstrapTokens.delete(token);
    }
    while (this.bootstrapTokens.size > 256) {
      const oldest = this.bootstrapTokens.keys().next().value;
      if (typeof oldest !== "string") break;
      this.bootstrapTokens.delete(oldest);
    }
  }

  async resource(
    surfaceId: string,
    rawResourceToken: string,
    rawScheme: string,
    rawAuthority: string,
    rawPath: string,
  ): Promise<WebviewResource> {
    const resourceToken = stringValue(
      rawResourceToken ? decodeURIComponent(rawResourceToken) : "",
    );
    const scope = resourceToken
      ? this.resourceScopesByToken.get(resourceToken)
      : null;
    if (resourceToken && !scope) {
      throw new Error("unknown extension webview resource scope");
    }
    const surface = resourceToken ? null : this.requiredSurface(surfaceId);
    const roots = scope?.roots ?? this.surfaceResourceRoots(surface!);
    const scheme = decodeURIComponent(rawScheme);
    const authority =
      decodeURIComponent(rawAuthority) === "_"
        ? ""
        : decodeURIComponent(rawAuthority);
    if (scheme !== "file" && scheme !== "vscode-remote") {
      throw new Error(`unsupported webview resource scheme: ${scheme}`);
    }
    const candidatePath = `/${rawPath.split("/").filter(Boolean).map(decodeURIComponent).join("/")}`;
    const candidate = await fs.realpath(candidatePath);
    let admitted = false;
    for (const root of roots) {
      if (stringValue(root.scheme) !== scheme) continue;
      const rootAuthority = stringValue(root.authority);
      if (
        scheme === "vscode-remote" &&
        rootAuthority &&
        rootAuthority !== authority
      )
        continue;
      try {
        const realRoot = await fs.realpath(stringValue(root.path));
        if (pathWithin(candidate, realRoot)) {
          admitted = true;
          break;
        }
      } catch {}
    }
    if (!admitted)
      throw new Error("webview resource is outside localResourceRoots");
    const stat = await fs.stat(candidate);
    let immutable = false;
    if (scope?.extensionLocation) {
      const extensionScheme = stringValue(scope.extensionLocation.scheme);
      const extensionAuthority = stringValue(scope.extensionLocation.authority);
      if (
        extensionScheme === scheme &&
        (scheme !== "vscode-remote" ||
          !extensionAuthority ||
          extensionAuthority === authority)
      ) {
        try {
          const extensionRoot = await fs.realpath(
            stringValue(scope.extensionLocation.path),
          );
          immutable = pathWithin(candidate, extensionRoot);
        } catch {}
      }
    }
    return {
      body: await fs.readFile(candidate),
      contentType: resourceContentType(candidate),
      etag: `W/\"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}\"`,
      lastModified: stat.mtime.toUTCString(),
      cacheControl: immutable
        ? "private, max-age=31536000, immutable"
        : "private, max-age=0, must-revalidate",
    };
  }

  private handleViewRequest(
    method: string,
    args: unknown[],
  ): WebviewMainThreadResult {
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
        retainContextWhenHidden:
          providerOptions.retainContextWhenHidden === true,
        serializeBuffersForPostMessage:
          providerOptions.serializeBuffersForPostMessage === true,
      };
      if (!provider.viewType)
        throw new Error("webview provider viewType is required");
      this.providers.set(provider.viewType, provider);
      for (const resolve of this.providerWaiters.get(provider.viewType) ?? [])
        resolve();
      this.providerWaiters.delete(provider.viewType);
      return { handled: true };
    }
    if (method === "$unregisterWebviewViewProvider") {
      const viewType = stringValue(args[0]);
      this.providers.delete(viewType);
      for (const surface of [...this.surfaces.values()]) {
        if (surface.viewId === viewType)
          this.disposeSurface(surface, "provider_unregistered");
      }
      return { handled: true };
    }
    const surface = this.surfaceForHandle(args[0]);
    if (!surface) return { handled: false };
    const sharedSurface = this.requiredSurface(surface.surfaceId);
    if (method === "$setWebviewViewTitle") {
      surface.title = stringValue(args[1]) || surface.viewId;
      sharedSurface.title = surface.title;
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$setWebviewViewDescription") {
      surface.description = stringValue(args[1]);
      sharedSurface.description = surface.description;
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$setWebviewViewBadge") {
      surface.badge = args[1] ?? null;
      sharedSurface.badge = surface.badge;
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$show") {
      this.notify(surface, "show", { preserveFocus: args[1] === true });
      return { handled: true };
    }
    return { handled: false };
  }

  private handleWebviewRequest(
    method: string,
    args: unknown[],
  ): WebviewMainThreadResult {
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
      this.bindResourceScope(surface);
      surface.htmlRevision += 1;
      this.notify(surface, "reload", { surface: this.publicSurface(surface) });
      return { handled: true };
    }
    if (method === "$postMessage") {
      const buffers = args
        .slice(2)
        .filter((value): value is Uint8Array => value instanceof Uint8Array);
      this.notify(surface, "message", {
        jsonMessage:
          typeof args[1] === "string"
            ? args[1]
            : JSON.stringify(args[1] ?? null),
        buffers,
      });
      return { handled: true, replyResult: true };
    }
    return { handled: false };
  }

  private handlePanelRequest(
    method: string,
    args: unknown[],
  ): WebviewMainThreadResult {
    if (method === "$createWebviewPanel") {
      const extension = isRecord(args[0]) ? args[0] : {};
      const handle = stringValue(args[1]);
      const viewType = stringValue(args[2]);
      const initData = isRecord(args[3]) ? args[3] : {};
      const showOptions = isRecord(args[4]) ? args[4] : {};
      if (!handle || !viewType)
        throw new Error("webview panel handle and viewType are required");
      if (this.surfaceForHandle(handle))
        throw new Error(`webview panel handle already exists: ${handle}`);
      const projectPath = this.workspaceFolder();
      if (!projectPath)
        throw new Error("webview panel requires an active workspace");
      const workspaceId = stableHash(projectPath);
      const surfaceId = `vsix-panel:${workspaceId}:${stableHash(handle)}`;
      const panelOptions = isRecord(initData.panelOptions)
        ? initData.panelOptions
        : {};
      const surface: WebviewRuntimeSurface = {
        dto: "ExtensionWebviewSurface",
        version: 1,
        surfaceId,
        runtimeId: surfaceId,
        clientInstanceId: "",
        resourceScopeToken: "",
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
        options: isRecord(initData.webviewOptions)
          ? { ...initData.webviewOptions }
          : {},
        state: null,
        extensionLocation: uriRecord(extension.location),
        serializeBuffersForPostMessage:
          initData.serializeBuffersForPostMessage === true,
        visible: true,
        retainContextWhenHidden: panelOptions.retainContextWhenHidden === true,
        viewColumn: panelViewColumn(showOptions.viewColumn),
        iconUrl: "",
        iconResource: null,
      };
      this.surfaces.set(surfaceId, surface);
      this.runtimeSurfaces.set(surface.runtimeId, surface);
      this.runtimeIdByHandle.set(handle, surface.runtimeId);
      this.bindResourceScope(surface);
      this.createTransport(surface.runtimeId);
      this.sendPanelViewState(surface, true);
      this.emitSnapshot();
      return { handled: true };
    }
    if (
      method === "$registerSerializer" ||
      method === "$unregisterSerializer"
    ) {
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
        ? (uriRecord(args[1].dark) ??
          uriRecord(args[1].light) ??
          uriRecord(args[1]))
        : null;
      surface.iconResource = icon;
      surface.iconUrl = resourceUrl(surface.surfaceId, icon);
      this.emitSnapshot();
      return { handled: true };
    }
    if (method === "$reveal") {
      const showOptions = isRecord(args[1]) ? args[1] : {};
      surface.visible = true;
      surface.viewColumn = panelViewColumn(
        showOptions.viewColumn,
        surface.viewColumn,
      );
      this.sendPanelViewState(surface, true);
      this.notify(surface, "show", {
        preserveFocus: showOptions.preserveFocus === true,
      });
      this.emitSnapshot();
      return { handled: true };
    }
    return { handled: false };
  }

  private primaryContributions(): WebviewContribution[] {
    const result: WebviewContribution[] = [];
    for (const rawExtension of this.runtime.getExtensions()) {
      if (!isRecord(rawExtension) || !isRecord(rawExtension.contributes))
        continue;
      const extensionId = extensionIdentifier(rawExtension);
      const containers =
        isRecord(rawExtension.contributes.viewsContainers) &&
        Array.isArray(rawExtension.contributes.viewsContainers.activitybar)
          ? rawExtension.contributes.viewsContainers.activitybar
          : [];
      const views = isRecord(rawExtension.contributes.views)
        ? rawExtension.contributes.views
        : {};
      for (const rawContainer of containers) {
        if (!isRecord(rawContainer)) continue;
        const containerId = stringValue(rawContainer.id);
        const contributionLocation = extensionLocation(rawExtension);
        const icon = extensionResourceUri(
          contributionLocation,
          rawContainer.icon,
        );
        const descriptors = Array.isArray(views[containerId])
          ? views[containerId]
          : [];
        for (const rawDescriptor of descriptors) {
          if (
            !isRecord(rawDescriptor) ||
            stringValue(rawDescriptor.type) !== "webview"
          )
            continue;
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

  private async createSurface(
    contribution: WebviewContribution,
  ): Promise<void> {
    const provider = this.providers.get(contribution.viewType);
    if (!provider)
      throw new Error(
        `webview provider is not registered: ${contribution.viewType}`,
      );
    const projectPath = this.workspaceFolder();
    if (!projectPath)
      throw new Error("webview view requires an active workspace");
    const workspaceId = stableHash(projectPath);
    const surfaceId = `vsix:${workspaceId}:${stableHash(`${contribution.extensionId}\0${contribution.viewType}`)}`;
    const surface: ExtensionWebviewSurface = {
      dto: "ExtensionWebviewSurface",
      version: 1,
      surfaceId,
      handle: "",
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
      extensionLocation:
        provider.extensionLocation ?? contribution.extensionLocation,
      serializeBuffersForPostMessage: provider.serializeBuffersForPostMessage,
      visible: true,
      retainContextWhenHidden: provider.retainContextWhenHidden,
      viewColumn: 0,
      iconUrl: resourceUrl(surfaceId, contribution.icon),
      iconResource: contribution.icon,
    };
    this.surfaces.set(surfaceId, surface);
    this.createTransport(surfaceId);
    this.emitSnapshot();
  }

  private clientRuntimeId(surfaceId: string, clientInstanceId: string): string {
    return `view:${surfaceId}:${clientInstanceId}`;
  }

  private async runtimeSurfaceForAttach(
    surface: ExtensionWebviewSurface,
    clientInstanceId: string,
    state: unknown,
  ): Promise<WebviewRuntimeSurface> {
    if (surface.surfaceKind === "panel") {
      const runtimeSurface = this.runtimeSurfaces.get(surface.surfaceId);
      if (!runtimeSurface)
        throw new Error(`missing webview panel runtime: ${surface.surfaceId}`);
      return runtimeSurface;
    }
    const runtimeId = this.clientRuntimeId(
      surface.surfaceId,
      clientInstanceId,
    );
    const current = this.runtimeSurfaces.get(runtimeId);
    if (current) return current;
    const pending = this.resolvingRuntimeSurfaces.get(runtimeId);
    if (pending) return await pending;
    const resolution = this.resolveClientRuntimeSurface(
      surface,
      clientInstanceId,
      state,
    );
    this.resolvingRuntimeSurfaces.set(runtimeId, resolution);
    try {
      return await resolution;
    } finally {
      if (this.resolvingRuntimeSurfaces.get(runtimeId) === resolution) {
        this.resolvingRuntimeSurfaces.delete(runtimeId);
      }
    }
  }

  private async resolveClientRuntimeSurface(
    surface: ExtensionWebviewSurface,
    clientInstanceId: string,
    state: unknown,
  ): Promise<WebviewRuntimeSurface> {
    const provider = this.providers.get(surface.viewId);
    if (!provider)
      throw new Error(`webview provider is not registered: ${surface.viewId}`);
    const runtimeId = this.clientRuntimeId(
      surface.surfaceId,
      clientInstanceId,
    );
    const handle = crypto.randomUUID();
    const runtimeSurface: WebviewRuntimeSurface = {
      ...surface,
      runtimeId,
      clientInstanceId,
      resourceScopeToken: "",
      handle,
      html: "",
      htmlRevision: 0,
      options: {},
      state,
      extensionLocation:
        provider.extensionLocation ?? surface.extensionLocation,
      serializeBuffersForPostMessage:
        provider.serializeBuffersForPostMessage,
      visible: true,
      retainContextWhenHidden: provider.retainContextWhenHidden,
    };
    this.runtimeSurfaces.set(runtimeId, runtimeSurface);
    this.runtimeIdByHandle.set(handle, runtimeId);
    this.bindResourceScope(runtimeSurface);
    this.createTransport(runtimeId);
    const request = this.runtime.sendExtAwaitTerminalReply(
      this.runtime.rpcIds.ExtHostWebviewViews,
      "$resolveWebviewView",
      [handle, surface.viewId, surface.title, state],
      true,
      30000,
    );
    try {
      await request.promise;
      if (this.runtimeSurfaces.get(runtimeId) !== runtimeSurface) {
        throw new Error(
          `webview client runtime changed during resolve: ${surface.surfaceId}`,
        );
      }
      return runtimeSurface;
    } catch (error) {
      this.disposeRuntimeSurface(runtimeSurface, "resolve_failed", true);
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
        reject(
          new Error(`timed out waiting for webview provider: ${viewType}`),
        );
      }, timeoutMs);
      const complete = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const waiters =
        this.providerWaiters.get(viewType) ?? new Set<() => void>();
      waiters.add(complete);
      this.providerWaiters.set(viewType, waiters);
    });
  }

  private findSurfaceByView(viewType: string): ExtensionWebviewSurface | null {
    for (const surface of this.surfaces.values()) {
      if (
        surface.viewId === viewType &&
        surface.projectPath === this.workspaceFolder()
      )
        return surface;
    }
    return null;
  }

  private surfaceForHandle(value: unknown): WebviewRuntimeSurface | null {
    const runtimeId = this.runtimeIdByHandle.get(stringValue(value));
    return runtimeId ? (this.runtimeSurfaces.get(runtimeId) ?? null) : null;
  }

  private requiredSurface(value: unknown): ExtensionWebviewSurface {
    const surface = this.surfaces.get(stringValue(value));
    if (!surface)
      throw new Error(
        `unknown webview surface: ${stringValue(value) || "(missing)"}`,
      );
    return surface;
  }

  private requiredRuntimeSurface(
    surface: ExtensionWebviewSurface,
    clientInstanceIdValue: unknown,
  ): WebviewRuntimeSurface {
    const runtimeId =
      surface.surfaceKind === "panel"
        ? surface.surfaceId
        : this.clientRuntimeId(
            surface.surfaceId,
            stringValue(clientInstanceIdValue),
          );
    const runtimeSurface = this.runtimeSurfaces.get(runtimeId);
    if (!runtimeSurface) {
      throw new Error(
        `webview client runtime is not attached: ${surface.surfaceId}`,
      );
    }
    return runtimeSurface;
  }

  private createTransport(surfaceId: string): void {
    this.surfaceTransport.set(surfaceId, {
      surfaceGeneration: crypto.randomUUID(),
      sequence: 0,
      journal: [],
      journalBytes: 0,
    });
  }

  private requiredTransport(surfaceId: string): WebviewSurfaceTransportState {
    const transport = this.surfaceTransport.get(surfaceId);
    if (!transport)
      throw new Error(`missing webview transport state: ${surfaceId}`);
    return transport;
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
    for (const runtimeSurface of [...this.runtimeSurfaces.values()]) {
      if (runtimeSurface.surfaceId !== surface.surfaceId) continue;
      this.disposeRuntimeSurface(
        runtimeSurface,
        reason,
        notifyExtensionHost,
      );
    }
    this.surfaces.delete(surface.surfaceId);
    this.surfaceTransport.delete(surface.surfaceId);
    this.emitSnapshot(surface.projectPath);
  }

  private disposeRuntimeSurface(
    runtimeSurface: WebviewRuntimeSurface,
    reason: string,
    notifyExtensionHost = false,
  ): void {
    if (this.runtimeSurfaces.get(runtimeSurface.runtimeId) !== runtimeSurface)
      return;
    this.notify(runtimeSurface, "dispose", { reason });
    this.releaseResourceScope(runtimeSurface);
    this.runtimeSurfaces.delete(runtimeSurface.runtimeId);
    this.runtimeIdByHandle.delete(runtimeSurface.handle);
    this.surfaceTransport.delete(runtimeSurface.runtimeId);
    if (!notifyExtensionHost) return;
    if (runtimeSurface.surfaceKind === "panel") {
      this.runtime.sendExt(
        this.runtime.rpcIds.ExtHostWebviewPanels,
        "$onDidDisposeWebviewPanel",
        [runtimeSurface.handle],
        false,
      );
    } else {
      this.runtime.sendExt(
        this.runtime.rpcIds.ExtHostWebviewViews,
        "$disposeWebviewView",
        [runtimeSurface.handle],
        false,
      );
    }
  }

  private sendPanelViewState(
    surface: ExtensionWebviewSurface,
    visible: boolean,
  ): void {
    this.runtime.sendExt(
      this.runtime.rpcIds.ExtHostWebviewPanels,
      "$onDidChangeWebviewPanelViewStates",
      [
        {
          [surface.handle]: {
            active: visible,
            visible,
            position: surface.viewColumn,
          },
        },
      ],
      false,
    );
  }

  private workspaceFolder(): string {
    return stringValue(this.runtime.getWorkspaceFolder());
  }

  private documentResourceRoots(
    surface: ExtensionWebviewSurface,
  ): UriRecord[] {
    const configured = Array.isArray(surface.options.localResourceRoots)
      ? surface.options.localResourceRoots
          .map(uriRecord)
          .filter((value): value is UriRecord => !!value)
      : [];
    if (configured.length) return configured;
    const roots: UriRecord[] = [];
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

  private surfaceResourceRoots(
    surface: ExtensionWebviewSurface,
  ): UriRecord[] {
    const roots = this.documentResourceRoots(surface);
    if (surface.iconResource) roots.push(surface.iconResource);
    return roots;
  }

  private resourceScopeKey(
    surface: WebviewRuntimeSurface,
    roots: UriRecord[],
  ): string {
    const normalize = (uri: UriRecord | null): JsonObject | null =>
      uri
        ? {
            scheme: stringValue(uri.scheme),
            authority: stringValue(uri.authority),
            path: stringValue(uri.path),
          }
        : null;
    const normalizedRoots = roots
      .map((root) => normalize(root)!)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return JSON.stringify({
      extensionId: surface.extensionId.toLowerCase(),
      extensionLocation: normalize(surface.extensionLocation),
      workspaceId: surface.workspaceId,
      roots: normalizedRoots,
    });
  }

  private bindResourceScope(
    surface: WebviewRuntimeSurface,
  ): WebviewResourceScope {
    const roots = this.documentResourceRoots(surface);
    const key = this.resourceScopeKey(surface, roots);
    const current = surface.resourceScopeToken
      ? this.resourceScopesByToken.get(surface.resourceScopeToken)
      : null;
    if (current?.key === key) return current;
    this.releaseResourceScope(surface);
    let scope = this.resourceScopesByKey.get(key);
    if (!scope) {
      scope = {
        key,
        token: crypto.randomUUID(),
        roots: roots.map((root) => ({ ...root })),
        extensionLocation: surface.extensionLocation
          ? { ...surface.extensionLocation }
          : null,
        runtimeIds: new Set<string>(),
      };
      this.resourceScopesByKey.set(key, scope);
      this.resourceScopesByToken.set(scope.token, scope);
    }
    scope.runtimeIds.add(surface.runtimeId);
    surface.resourceScopeToken = scope.token;
    return scope;
  }

  private releaseResourceScope(surface: WebviewRuntimeSurface): void {
    const token = surface.resourceScopeToken;
    surface.resourceScopeToken = "";
    if (!token) return;
    const scope = this.resourceScopesByToken.get(token);
    if (!scope) return;
    scope.runtimeIds.delete(surface.runtimeId);
    if (scope.runtimeIds.size) return;
    this.resourceScopesByToken.delete(scope.token);
    if (this.resourceScopesByKey.get(scope.key) === scope) {
      this.resourceScopesByKey.delete(scope.key);
    }
  }

  private publicSurface(surface: ExtensionWebviewSurface): JsonObject {
    const runtimeId =
      "runtimeId" in surface && typeof surface.runtimeId === "string"
        ? surface.runtimeId
        : surface.surfaceId;
    const transport = this.requiredTransport(runtimeId);
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
      serverEpoch: this.serverEpoch,
      surfaceGeneration: transport.surfaceGeneration,
      eventSequence: transport.sequence,
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
    surface: WebviewRuntimeSurface,
    event: string,
    extra: JsonObject,
  ): void {
    const transport = this.requiredTransport(surface.runtimeId);
    const params: WebviewClientEvent = {
      ...extra,
      surfaceId: surface.surfaceId,
      ...(surface.clientInstanceId
        ? { clientInstanceId: surface.clientInstanceId }
        : {}),
      event,
      serverEpoch: this.serverEpoch,
      surfaceGeneration: transport.surfaceGeneration,
      htmlRevision: surface.htmlRevision,
      sequence: transport.sequence + 1,
    };
    transport.sequence = params.sequence;
    const encodedBytes = encodeWbaRpcMessage({
      jsonrpc: "2.0",
      method: "vscode.webview.event",
      params,
    }).byteLength;
    if (encodedBytes <= MAX_WEBVIEW_EVENT_JOURNAL_BYTES) {
      transport.journal.push(structuredClone(params));
      transport.journalBytes += encodedBytes;
      while (
        transport.journal.length > MAX_WEBVIEW_EVENT_JOURNAL_COUNT ||
        transport.journalBytes > MAX_WEBVIEW_EVENT_JOURNAL_BYTES
      ) {
        const removed = transport.journal.shift();
        if (!removed) break;
        transport.journalBytes -= encodeWbaRpcMessage({
          jsonrpc: "2.0",
          method: "vscode.webview.event",
          params: removed,
        }).byteLength;
      }
    } else {
      transport.journal = [];
      transport.journalBytes = 0;
    }
    this.runtime.onClientNotification("vscode.webview.event", params);
  }
}
