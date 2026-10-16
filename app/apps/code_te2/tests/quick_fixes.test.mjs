import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {ProviderRegistry} from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/provider-registry.mjs';
import {QuickFixService} from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/code-actions.mjs';
import {WorkbenchClient} from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs';
import {handleExtHostRequest} from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/ext-host-dispatch.mjs';
import {dispatchJsonRpcRequest} from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/request-dispatch.mjs';
const built=await build({entryPoints:['monaco_editor/editor_quick_fix_runtime.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createEditorQuickFixRuntime,quickFixEdits}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const range={startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:2};
const ctx={uri:'file:///work/a.rs',path:'/work/a.rs',languageId:'rust',version:3};
const edit=(path=ctx.path)=>({resource:{scheme:'file',path},versionId:3,textEdit:{range,text:'fixed'}});
const params={clientInstanceId:'client_a',path:ctx.path,languageId:'rust',modelVersionId:3,range};
function backend(){
  const registry=new ProviderRegistry(), calls=[];
  registry.registerFromRequest('$registerCodeActionSupport',[4,[{language:'rust',scheme:'file'}],{providedKinds:['quickfix']},'test','test',true]);
  let actions=[{title:'Fix',kind:'quickfix',cacheId:[8,0],edit:{edits:[edit()]}},{title:'Refactor',kind:'refactor.extract'},{title:'Untyped'}];
  let resolved={},waiting=null;
  const service=new QuickFixService({registry,commandSupported:id=>id==='test.fix',document:p=>({languageId:p.languageId,scheme:'file',authority:'',path:p.path}),uri:path=>({scheme:'file',path}),
    request:async(method,args)=>{calls.push({method,args});if(waiting)await waiting;if(method==='$provideCodeActions')return {cacheId:8,actions};if(method==='$resolveCodeAction')return resolved;return undefined;}});
  return {service,registry,calls,setActions:v=>actions=v,setResolved:v=>resolved=v,setWait:v=>waiting=v};
}
test('actual Workbench factory and server dispatch preserve code-action registration/provide/resolve/release',async()=>{
  const client=new WorkbenchClient({extensionStoragePath:process.cwd()+'/.codex-scratch/unused-storage',webviewReconstructionStoragePath:process.cwd()+'/.codex-scratch/unused-webviews'});
  const calls=[],events=[];
  client.onEvent=event=>events.push(event);
  client._inlayHintsRuntime=()=>({ensureConnected(){}});
  client._sendExtPending=(_rpc,method,args)=>{
    calls.push({method,args});
    return {promise:Promise.resolve({type:9,result:method==='$provideCodeActions'?{cacheId:8,actions:[{title:'Fix',kind:'quickfix',cacheId:[8,0],edit:{edits:[edit()]}}]}:{}})};
  };
  client._runWithClientEditorFacade=(_p,fn)=>fn();
  client.activateLanguage=async()=>({ok:true});client.resolveLanguageId=()=> 'rust';
  const ext=client._extHostDispatchRuntime();ext.sendPayload=()=>{};ext.log=()=>{};
  handleExtHostRequest(ext,{kind:'ext',type:1,req:1,method:'$registerCodeActionSupport',args:[4,[{language:'rust'}],{providedKinds:['quickfix']},'test','test',true]});
  assert.ok(events.some(event=>event.type==='provider/codeActions'));
  const runtime={wb:client,normalizePathParam:p=>p.path,defaultRemoteAuthority:'test'};
  const provided=await dispatchJsonRpcRequest(runtime,{id:1,method:'vscode.codeActions.provide',params});
  const action=provided.result.actions[0];assert.equal(action.title,'Fix');
  const request={...params,listId:action.listId,actionIndex:0};
  assert.equal((await dispatchJsonRpcRequest(runtime,{id:2,method:'vscode.codeActions.resolve',params:request})).result.action.title,'Fix');
  await dispatchJsonRpcRequest(runtime,{id:3,method:'vscode.codeActions.release',params:request});
  assert.deepEqual(calls.map(c=>c.method),['$provideCodeActions','$resolveCodeAction','$releaseCodeActions']);
  handleExtHostRequest(ext,{kind:'ext',type:1,req:2,rpcId:ext.rpcIds.MainThreadLanguageFeatures+1,method:'$unregister',args:[4]});
  assert.equal(client._providerRegistry.list('codeActions').length,1);
  handleExtHostRequest(ext,{kind:'ext',type:1,req:3,rpcId:ext.rpcIds.MainThreadLanguageFeatures,method:'$unregister',args:[4]});
  assert.equal(client._providerRegistry.list('codeActions').length,0);
});
test('WBA code-action registration, selectors, resync and unregister use the provider owner',()=>{
  const f=backend();
  assert.equal(f.registry.snapshot().codeActions.length,1);
  assert.equal(f.registry.buildResyncEvents().replayed.codeActions,1);
  assert.deepEqual(f.registry.findAllProviderHandlesForDocument('codeActions',{languageId:'python',scheme:'file',path:ctx.path,authority:''}),[]);
  assert.deepEqual(f.registry.registerFromRequest('$unregister',[4]).events,[{type:'provider/unregistered',kind:'codeActions',handle:4}]);
  assert.equal(f.registry.snapshot().codeActions.length,0);
});
test('provide requests only quickfix; resolve/release retain exact owner and cache IDs',async()=>{
  const f=backend(),result=await f.service.call('provide',params);
  assert.equal(result.actions.length,1);
  assert.deepEqual(f.calls[0].args[3],{only:'quickfix',trigger:2});
  const action=result.actions[0],input={...params,listId:action.listId,actionIndex:0};
  await assert.rejects(f.service.call('resolve',{...input,clientInstanceId:'client_b'}),/identity|available/);
  await assert.rejects(f.service.call('resolve',{...input,modelVersionId:4}),/stale/);
  assert.equal((await f.service.call('resolve',input)).action.title,'Fix');
  assert.deepEqual(f.calls.find(c=>c.method==='$resolveCodeAction').args,[4,[8,0]]);
  await f.service.call('release',input);
  assert.deepEqual(f.calls.at(-1),{method:'$releaseCodeActions',args:[4,8]});
  await assert.rejects(f.service.call('resolve',input),/available/);
});
test('unsupported commands are disabled and provider retirement/reset invalidate retained results',async()=>{
  const f=backend();
  f.setResolved({command:{id:'unsupported'}});
  const action=(await f.service.call('provide',params)).actions[0],input={...params,listId:action.listId,actionIndex:0};
  assert.match((await f.service.call('resolve',input)).action.disabled,/not supported/);
  f.registry.registerFromRequest('$unregister',[4]);
  await assert.rejects(f.service.call('resolve',input),/stale/);
  f.service.reset();await assert.rejects(f.service.call('release',input),/available/);
});
test('late provider results after a WBA session reset are not retained',async()=>{
  const f=backend();let resume;f.setWait(new Promise(r=>resume=r));
  const pending=f.service.call('provide',params);f.service.reset();resume();
  assert.deepEqual(await pending,{actions:[]});
});
function frontend(){
  let provider,handler,generation=1,current={...ctx},text='abc',version=3,disposed=0;
  const changes=new Set();
  const calls=[],notifications=[],undo=[];
  const model={uri:{toString:()=>ctx.uri},getVersionId:()=>version,getValue:()=>text,
    onDidChangeContent:fn=>{changes.add(fn);return{dispose:()=>changes.delete(fn)};},
    validateRange:r=>r,getOffsetAt:p=>p.column-1};
  const editor={getModel:()=>model,getOption:()=>false,pushUndoStop:()=>undo.push('stop'),executeEdits:(_source,edits)=>{for(const e of edits)text=e.text+text.slice(e.range.endColumn-1);version++;current={...current,version};for(const changed of changes)changed();return true;}};
  let response={actions:[{title:'Fix',kind:'quickfix',listId:'list',actionIndex:0,edit:{edits:[edit()]}}]},resolved={title:'Fix',kind:'quickfix',edit:{edits:[edit()]}};
  const runtime=createEditorQuickFixRuntime({monaco:{editor:{EditorOption:{readOnly:1},registerCommand:(id,fn)=>{assert.equal(id,'te2.quickFix.apply');handler=fn;return{dispose(){}};}},
    languages:{registerCodeActionProvider:(selector,p,metadata)=>{assert.equal(selector,'*');assert.deepEqual(metadata,{providedCodeActionKinds:['quickfix']});provider=p;return{dispose(){disposed++;}};}}},
    getContext:()=>current,getEditor:()=>editor,getGeneration:()=>generation,getClient:()=>params.clientInstanceId,isEnabled:()=>true,
    call:async(method,p)=>{calls.push({method,p});if(method.endsWith('.provide'))return response;if(method.endsWith('.resolve'))return{action:resolved};return{ok:true};},notify:message=>notifications.push(message)});
  return {runtime,calls,notifications,undo,model,getProvider:()=>provider,getText:()=>text,getDisposed:()=>disposed,
    provide:(context={markers:[{}],trigger:1},token={isCancellationRequested:false})=>provider.provideCodeActions(model,range,context,token),
    execute:action=>handler(null,action.command.arguments[0]),change(){version++;current={...current,version};for(const changed of changes)changed();},disconnect(){generation++;runtime.reset();},
    setResolved:value=>resolved=value,setResponse:value=>response=value};
}
test('current-document quick fix applies via editor undo/draft path and cannot replay',async()=>{
  const f=frontend(),list=await f.provide();
  assert.equal(list.actions.length,1);assert.equal(f.calls.length,1);
  await f.execute(list.actions[0]);
  assert.equal(f.getText(),'fixedbc');assert.deepEqual(f.undo,['stop','stop']);
  await assert.rejects(f.execute(list.actions[0]),/stale/);
  list.dispose();await Promise.resolve();assert.ok(f.calls.some(c=>c.method.endsWith('.release')));
  f.runtime.dispose();
});
for(const change of ['change','disconnect'])test(`quick fixes reject ${change} before executing`,async()=>{
  const f=frontend(),list=await f.provide();f[change]();await assert.rejects(f.execute(list.actions[0]),/stale/);assert.equal(f.getText(),'abc');f.runtime.dispose();
});
test('no diagnostics, refactor requests and cancelled requests skip provider calls',async()=>{
  const f=frontend();
  assert.equal((await f.provide({markers:[],trigger:1})).actions.length,0);
  assert.equal((await f.provide({markers:[{}],only:'refactor',trigger:1})).actions.length,0);
  assert.equal((await f.provide(undefined,{isCancellationRequested:true})).actions.length,0);
  assert.equal(f.calls.length,0);f.runtime.dispose();
});
test('multi-file, resource, snippet, stale-version, overlap and combined actions reject as a whole',()=>{
  const f=frontend();
  for(const action of [
    {edit:{edits:[edit(),edit('/work/other.rs')]}},
    {edit:{edits:[{oldResource:{path:ctx.path},newResource:{path:'/new'}}]}},
    {edit:{edits:[{...edit(),textEdit:{range,text:'x',insertAsSnippet:true}}]}},
    {edit:{edits:[{...edit(),versionId:2}]}},
    {edit:{edits:[edit(),edit()]}},
    {edit:{edits:[edit()]},command:{id:'test.fix'}},
  ])assert.throws(()=>quickFixEdits(action,ctx,f.model));
  assert.equal(f.getText(),'abc');f.runtime.dispose();
});
test('late-resolved unsupported edit does not partially apply and reports error',async()=>{
  const f=frontend(),list=await f.provide();f.setResolved({edit:{edits:[edit(),edit('/other')]}});
  await assert.rejects(f.execute(list.actions[0]),/current document/);
  assert.equal(f.getText(),'abc');assert.equal(f.undo.length,0);assert.equal(f.notifications.length,1);f.runtime.dispose();
});
test('command-only fixes use the admitted existing command executor',async()=>{
  const f=frontend();f.setResponse({actions:[{title:'Command fix',kind:'quickfix',listId:'cmd',actionIndex:0,command:{id:'test.fix'}}]});
  f.setResolved({command:{id:'test.fix',arguments:[{test:1}]}});
  const list=await f.provide();await f.execute(list.actions[0]);
  assert.equal(f.getText(),'abc');assert.equal(f.undo.length,0);
  const command=f.calls.find(c=>c.method==='vscode.extensionCommands.execute');assert.equal(command.p.surface,'quickfix');assert.deepEqual(command.p.arguments,[{test:1}]);
  f.runtime.dispose();
});
