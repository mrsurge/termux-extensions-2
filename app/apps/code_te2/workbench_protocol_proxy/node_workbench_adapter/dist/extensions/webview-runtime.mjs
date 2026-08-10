import y from"node:crypto";import w from"node:fs/promises";import v from"node:path";import{serializableBuffersArgument as W}from"../protocol/wire-encoding.mjs";const x="/api/app/code_te2/services/wba/webview",R=/https:\/\/([a-z][a-z0-9+.-]*)(?:\+|%2b)([^/]*?)\.vscode-resource\.vscode-cdn\.net(\/[^\s\"'<>)]*)?/gi;function l(i){return!!i&&typeof i=="object"&&!Array.isArray(i)}function a(i){return typeof i=="string"?i.trim():""}function h(i){if(!l(i))return null;const e=a(i.scheme),t=a(i.path??i.fsPath);return!e||!t?null:{scheme:e,authority:a(i.authority),path:t}}function E(i){return typeof i.id=="string"?i.id:typeof i.extensionId=="string"?i.extensionId:l(i.identifier)?a(i.identifier.value??i.identifier.id):""}function k(i){return h(i.extensionLocation??i.location)}function m(i,e=16){return y.createHash("sha256").update(i).digest("hex").slice(0,e)}function j(i,e){const t=v.relative(e,i);return t===""||!t.startsWith("..")&&!v.isAbsolute(t)}function $(i){const e=v.extname(i).toLowerCase();return{".css":"text/css; charset=utf-8",".gif":"image/gif",".html":"text/html; charset=utf-8",".ico":"image/x-icon",".jpeg":"image/jpeg",".jpg":"image/jpeg",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".png":"image/png",".svg":"image/svg+xml",".ttf":"font/ttf",".wasm":"application/wasm",".webp":"image/webp",".woff":"font/woff",".woff2":"font/woff2"}[e]??"application/octet-stream"}function _(i){const e=i.startsWith("/")?"/":"",t=i.endsWith("/")?"/":"",r=i.split("/").filter(Boolean).map(n=>encodeURIComponent(n)).join("/");return`${e}${r}${t}`}function A(i){return i.replace(/-([0-9a-f]{4})/gi,(e,t)=>String.fromCharCode(Number.parseInt(t,16)))}function M(i,e){const t=`${x}/${encodeURIComponent(i)}/resource`;return e.replace(R,(r,n,s,o="/")=>{const c=encodeURIComponent(decodeURIComponent(n)),u=encodeURIComponent(A(decodeURIComponent(s))||"_");let d=o||"/";d=d.split(/[?#]/,1)[0]||"/";try{d=decodeURI(d)}catch{}return`${t}/${c}/${u}${_(d)}`})}const S=`<script data-te2-webview-bridge>(function(){
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
})();</script>`;function B(i,e){let t=M(i,e||"");return t=t.replace(/https:\/\/\*\.vscode-cdn\.net/gi,"__TE2_WEBVIEW_RESOURCE_ORIGIN__"),/<head(?:\s[^>]*)?>/i.test(t)?t.replace(/<head(?:\s[^>]*)?>/i,r=>`${r}${S}`):`${S}${t}`}function O(i){return`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#te2-webview{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:var(--vscode-sideBar-background,#1e1e1e)}#te2-status{position:absolute;inset:0;display:grid;place-items:center;color:#aaa;font:13px system-ui}#te2-status[hidden]{display:none}</style></head>
<body><div id="te2-status">Loading extension view\u2026</div><iframe id="te2-webview" title="Extension view" hidden></iframe>
<script src="/static/vendor/socket.io.min.js"></script>
<script type="module">
import {encodeWbaRpcMessage,decodeWbaRpcMessage} from './runtime/messagepack-codec.mjs';
const surfaceId=${JSON.stringify(i)};
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
async function load(snapshot){const currentLoad=++loadRevision;ready=false;serializeBuffers=snapshot.serializeBuffersForPostMessage===true;const sandbox=[snapshot.options?.enableScripts?'allow-scripts':'',snapshot.options?.enableForms?'allow-forms':'','allow-downloads','allow-popups','allow-popups-to-escape-sandbox'].filter(Boolean).join(' ');frame.setAttribute('sandbox',sandbox);const response=await fetch('./'+encodeURIComponent(surfaceId)+'/document?revision='+encodeURIComponent(snapshot.htmlRevision||0),{cache:'no-store'});if(!response.ok)throw new Error('Extension document request failed: '+response.status);const documentHtml=(await response.text()).replaceAll('__TE2_WEBVIEW_RESOURCE_ORIGIN__',window.location.origin);if(currentLoad!==loadRevision)return;frame.__te2State=snapshot.state;frame.srcdoc=documentHtml;frame.hidden=false;status.hidden=true;}
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
</script></body></html>`}class V{constructor(e){this.runtime=e}providers=new Map;surfaces=new Map;surfaceIdByHandle=new Map;providerWaiters=new Map;handleMainThreadRequest(e){const t=Number(e.rpcId),r=a(e.method),n=Array.isArray(e.args)?e.args:[];try{return t===this.runtime.rpcIds.MainThreadWebviewViews?this.handleViewRequest(r,n):t===this.runtime.rpcIds.MainThreadWebviews?this.handleWebviewRequest(r,n):{handled:!1}}catch(s){return{handled:!0,error:s}}}async activatePrimaryViews(){const e=this.primaryContributions();await Promise.all(e.map(async t=>{try{await this.runtime.activateByEvent(`onView:${t.viewType}`),await this.waitForProvider(t.viewType,5e3),this.findSurfaceByView(t.viewType)||await this.createSurface(t)}catch(r){this.runtime.log(`[webview] activation failed view=${t.viewType}:`,r instanceof Error?r.message:String(r))}})),this.emitSnapshot()}clear(e,t=!0){const r=this.workspaceFolder();for(const n of[...this.surfaces.values()]){try{this.runtime.sendExt(this.runtime.rpcIds.ExtHostWebviewViews,"$disposeWebviewView",[n.handle],!1)}catch{}this.notify(n,"dispose",{reason:e})}t&&this.providers.clear(),this.surfaces.clear(),this.surfaceIdByHandle.clear(),t&&this.providerWaiters.clear(),this.emitSnapshot(r)}snapshot(){return this.snapshotFor(this.workspaceFolder())}attach(e){const t=this.requiredSurface(e.surfaceId);return this.publicSurface(t)}receiveBrowserMessage(e){const t=this.requiredSurface(e.surfaceId),r=typeof e.jsonMessage=="string"?e.jsonMessage:JSON.stringify(e.message??null),n=Array.isArray(e.buffers)?e.buffers.filter(o=>o instanceof Uint8Array):[],s=n.map((o,c)=>({$$ref$$:c}));return this.runtime.sendExtMixed(this.runtime.rpcIds.ExtHostWebviews,"$onMessage",[t.handle,r,W(s,n)],!1),{ok:!0}}setBrowserState(e){const t=this.requiredSurface(e.surfaceId);return t.state=e.state,{ok:!0}}setVisibility(e){const t=this.requiredSurface(e.surfaceId),r=e.visible!==!1;return t.visible!==r&&(t.visible=r,this.runtime.sendExt(this.runtime.rpcIds.ExtHostWebviewViews,"$onDidChangeWebviewViewVisibility",[t.handle,r],!1)),{ok:!0,visible:r}}wrapper(e){return this.requiredSurface(e),O(e)}document(e){return B(e,this.requiredSurface(e).html)}async resource(e,t,r,n){const s=this.requiredSurface(e),o=decodeURIComponent(t),c=decodeURIComponent(r)==="_"?"":decodeURIComponent(r);if(o!=="file"&&o!=="vscode-remote")throw new Error(`unsupported webview resource scheme: ${o}`);const u=`/${n.split("/").filter(Boolean).map(decodeURIComponent).join("/")}`,d=await w.realpath(u),f=this.localResourceRoots(s);let g=!1;for(const p of f){if(a(p.scheme)!==o)continue;const b=a(p.authority);if(!(o==="vscode-remote"&&b&&b!==c))try{const I=await w.realpath(a(p.path));if(j(d,I)){g=!0;break}}catch{}}if(!g)throw new Error("webview resource is outside localResourceRoots");return{body:await w.readFile(d),contentType:$(d)}}handleViewRequest(e,t){if(e==="$registerWebviewViewProvider"){const n=l(t[0])?t[0]:{},s=l(n.id)?a(n.id.value??n.id.id):a(n.id),o=l(t[2])?t[2]:{},c={extensionId:s,extensionLocation:h(n.location),viewType:a(t[1]),retainContextWhenHidden:o.retainContextWhenHidden===!0,serializeBuffersForPostMessage:o.serializeBuffersForPostMessage===!0};if(!c.viewType)throw new Error("webview provider viewType is required");this.providers.set(c.viewType,c);for(const u of this.providerWaiters.get(c.viewType)??[])u();return this.providerWaiters.delete(c.viewType),{handled:!0}}if(e==="$unregisterWebviewViewProvider"){const n=a(t[0]);this.providers.delete(n);for(const s of[...this.surfaces.values()])s.viewId===n&&this.disposeSurface(s,"provider_unregistered");return{handled:!0}}const r=this.surfaceForHandle(t[0]);return r?e==="$setWebviewViewTitle"?(r.title=a(t[1])||r.viewId,this.emitSnapshot(),{handled:!0}):e==="$setWebviewViewDescription"?(r.description=a(t[1]),this.emitSnapshot(),{handled:!0}):e==="$setWebviewViewBadge"?(r.badge=t[1]??null,this.emitSnapshot(),{handled:!0}):e==="$show"?(this.notify(r,"show",{preserveFocus:t[1]===!0}),{handled:!0}):{handled:!1}:{handled:!1}}handleWebviewRequest(e,t){const r=this.surfaceForHandle(t[0]);if(!r)return{handled:!1};if(e==="$setHtml")return r.html=typeof t[1]=="string"?t[1]:"",r.htmlRevision+=1,this.notify(r,"reload",{surface:this.publicSurface(r)}),{handled:!0};if(e==="$setOptions")return r.options=l(t[1])?{...t[1]}:{},r.htmlRevision+=1,this.notify(r,"reload",{surface:this.publicSurface(r)}),{handled:!0};if(e==="$postMessage"){const n=t.slice(2).filter(s=>s instanceof Uint8Array);return this.notify(r,"message",{jsonMessage:typeof t[1]=="string"?t[1]:JSON.stringify(t[1]??null),buffers:n}),{handled:!0,replyResult:!0}}return{handled:!1}}primaryContributions(){const e=[];for(const t of this.runtime.getExtensions()){if(!l(t)||!l(t.contributes))continue;const r=E(t),n=l(t.contributes.viewsContainers)&&Array.isArray(t.contributes.viewsContainers.activitybar)?t.contributes.viewsContainers.activitybar:[],s=l(t.contributes.views)?t.contributes.views:{};for(const o of n){if(!l(o))continue;const c=a(o.id),u=Array.isArray(s[c])?s[c]:[];for(const d of u){if(!l(d)||a(d.type)!=="webview")continue;const f=a(d.id);f&&e.push({extensionId:r,extensionLocation:k(t),viewType:f,title:a(d.name)||f})}}}return e}async createSurface(e){const t=this.providers.get(e.viewType);if(!t)throw new Error(`webview provider is not registered: ${e.viewType}`);const r=this.workspaceFolder();if(!r)throw new Error("webview view requires an active workspace");const n=m(r),s=`vsix:${n}:${m(`${e.extensionId}\0${e.viewType}`)}`,o=y.randomUUID(),c={dto:"ExtensionWebviewSurface",version:1,surfaceId:s,handle:o,hostId:`vsix-webview:${s}`,workspaceId:n,projectPath:r,extensionId:t.extensionId||e.extensionId,viewId:e.viewType,title:e.title,description:"",badge:null,url:`${x}/${encodeURIComponent(s)}`,html:"",htmlRevision:0,options:{},state:null,extensionLocation:t.extensionLocation??e.extensionLocation,serializeBuffersForPostMessage:t.serializeBuffersForPostMessage,visible:!0};this.surfaces.set(s,c),this.surfaceIdByHandle.set(o,s),this.emitSnapshot();const u=this.runtime.sendExtAwaitTerminalReply(this.runtime.rpcIds.ExtHostWebviewViews,"$resolveWebviewView",[o,e.viewType,e.title,c.state],!0,3e4);try{await u.promise}catch(d){throw this.disposeSurface(c,"resolve_failed"),d}}waitForProvider(e,t){return this.providers.has(e)?Promise.resolve():new Promise((r,n)=>{const s=setTimeout(()=>{const u=this.providerWaiters.get(e);u?.delete(o),u?.size===0&&this.providerWaiters.delete(e),n(new Error(`timed out waiting for webview provider: ${e}`))},t),o=()=>{clearTimeout(s),r()},c=this.providerWaiters.get(e)??new Set;c.add(o),this.providerWaiters.set(e,c)})}findSurfaceByView(e){for(const t of this.surfaces.values())if(t.viewId===e&&t.projectPath===this.workspaceFolder())return t;return null}surfaceForHandle(e){const t=this.surfaceIdByHandle.get(a(e));return t?this.surfaces.get(t)??null:null}requiredSurface(e){const t=this.surfaces.get(a(e));if(!t)throw new Error(`unknown webview surface: ${a(e)||"(missing)"}`);return t}disposeSurface(e,t){this.surfaces.delete(e.surfaceId),this.surfaceIdByHandle.delete(e.handle),this.notify(e,"dispose",{reason:t}),this.emitSnapshot(e.projectPath)}workspaceFolder(){return a(this.runtime.getWorkspaceFolder())}localResourceRoots(e){const t=Array.isArray(e.options.localResourceRoots)?e.options.localResourceRoots.map(h).filter(s=>!!s):[];if(t.length)return t;const r=[];e.extensionLocation&&r.push(e.extensionLocation);const n=a(e.projectPath);return n&&r.push({scheme:e.extensionLocation?.scheme||"file",authority:e.extensionLocation?.authority||"",path:n}),r}publicSurface(e){return{dto:e.dto,version:e.version,surfaceId:e.surfaceId,hostId:e.hostId,workspaceId:e.workspaceId,projectPath:e.projectPath,extensionId:e.extensionId,viewId:e.viewId,title:e.title,description:e.description,badge:e.badge,url:e.url,htmlRevision:e.htmlRevision,options:e.options,state:e.state,serializeBuffersForPostMessage:e.serializeBuffersForPostMessage,visible:e.visible}}snapshotFor(e){const t=[...this.surfaces.values()].filter(r=>!e||r.projectPath===e).map(r=>this.publicSurface(r));return{type:"webview/snapshot",ts_ms:Date.now(),workspaceFolder:e||null,workspaceId:e?m(e):null,surfaces:t}}emitSnapshot(e=this.workspaceFolder()){this.runtime.onLifecycleEvent(this.snapshotFor(e))}notify(e,t,r){this.runtime.onClientNotification("vscode.webview.event",{surfaceId:e.surfaceId,event:t,...r})}}export{V as WebviewRuntime};
