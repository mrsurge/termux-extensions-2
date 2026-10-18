import type * as Monaco from '../../../static/vendor/monaco-editor-core/esm/vs/editor/editor.api';

type Context = {uri:string; path:string; languageId:string; version:number};
interface Deps {
  monaco: typeof Monaco;
  getContext(): Context | null;
  getEditor(): Monaco.editor.IStandaloneCodeEditor | null;
  getGeneration(): number;
  getClient(): string;
  isEnabled(): boolean;
  call(method:string, params:Record<string,unknown>): Promise<unknown>;
  notify(message:string): void;
}
const record = (v:unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const GATEWAY = 'te2.quickFix.apply';
interface Target {raw:Record<string,unknown>; context:Context; generation:number; model:Monaco.editor.ITextModel; disposed:boolean; resolved?:Record<string,unknown>}

/** Whole-action validation: never salvage one file from a workspace edit. */
export function quickFixEdits(action:Record<string,unknown>, context:Context, model:Monaco.editor.ITextModel): Monaco.editor.IIdentifiedSingleEditOperation[] {
  if (action.disabled) throw Error(String(action.disabled));
  if (action.edit === undefined) {
    if (action.command === undefined) throw Error('This Quick Fix has no supported edit or command');
    return [];
  }
  if (action.command !== undefined) throw Error('Combined edit-and-command Quick Fixes are not supported yet');
  if (!record(action.edit) || !Array.isArray(action.edit.edits) || action.edit.edits.length > 1000) throw Error('Unsupported Quick Fix workspace edit');
  const edits:Monaco.editor.IIdentifiedSingleEditOperation[] = [];
  for (const row of action.edit.edits) {
    if (!record(row) || !record(row.resource) || !record(row.textEdit) || row.oldResource || row.newResource || row.cellEdit) throw Error('Resource operations are not supported');
    const resource = row.resource;
    if (resource.path !== context.path || !['file','vscode-remote'].includes(String(resource.scheme))
        || row.versionId !== undefined && row.versionId !== context.version) throw Error('Quick Fix must target only the current document/version');
    const edit = row.textEdit;
    if (edit.insertAsSnippet || edit.eol !== undefined || typeof edit.text !== 'string' || !record(edit.range)) throw Error('Unsupported Quick Fix text edit');
    const r = edit.range;
    const values = [r.startLineNumber,r.startColumn,r.endLineNumber,r.endColumn];
    if (!values.every(v => typeof v === 'number' && Number.isInteger(v) && v >= 1)) throw Error('Invalid Quick Fix range');
    const range = r as unknown as Monaco.IRange;
    const validated = model.validateRange(range);
    if (values.some((v,i) => v !== [validated.startLineNumber,validated.startColumn,validated.endLineNumber,validated.endColumn][i])) throw Error('Quick Fix range is outside the document');
    if (range.startLineNumber > range.endLineNumber || range.startLineNumber === range.endLineNumber && range.startColumn > range.endColumn) throw Error('Invalid Quick Fix range');
    edits.push({range, text:edit.text, forceMoveMarkers:true});
  }
  const sorted = edits.map(edit => ({start:model.getOffsetAt({lineNumber:edit.range.startLineNumber,column:edit.range.startColumn}),end:model.getOffsetAt({lineNumber:edit.range.endLineNumber,column:edit.range.endColumn})})).sort((a,b) => a.start-b.start || a.end-b.end);
  for (let i=1;i<sorted.length;i++) if (sorted[i].start < sorted[i-1].end || sorted[i].start === sorted[i-1].start) throw Error('Overlapping Quick Fix edits');
  return edits;
}

export function createEditorQuickFixRuntime(deps:Deps) {
  let sequence=0, epoch=0;
  const targets=new Map<string,Target>();
  const releases=new Map<string,Context>();
  const cleanups=new Set<()=>void>();
  const running=new Set<string>(), deferredRelease=new Set<string>();
  let boundEditor:Monaco.editor.IStandaloneCodeEditor|null=null, editorSubscription:Monaco.IDisposable|undefined;
  function current(target:Target): boolean {
    const ctx=deps.getContext();
    return deps.isEnabled() && !target.disposed && target.generation===deps.getGeneration() && deps.getEditor()?.getModel()===target.model && !!ctx && ctx.path===target.context.path && ctx.uri===target.context.uri && ctx.version===target.context.version;
  }
  function params(ctx:Context):Record<string,unknown> {return {...ctx,modelVersionId:ctx.version,clientInstanceId:deps.getClient()};}
  async function resolve(target:Target):Promise<Record<string,unknown>> {
    if (!current(target)) throw Error('Quick Fix is stale; request it again');
    if (!target.resolved) {
      const value=await deps.call('vscode.codeActions.resolve',{...params(target.context),listId:target.raw.listId,actionIndex:target.raw.actionIndex});
      if (!current(target) || !record(value) || !record(value.action)) throw Error('Quick Fix changed during resolution');
      target.resolved=value.action;
    }
    return target.resolved;
  }
  function release(id:string,ctx:Context):void {
    if(running.has(id)){deferredRelease.add(id);return;}
    if (!releases.delete(id)) return;
    void deps.call('vscode.codeActions.release',{...params(ctx),listId:id}).catch(()=>{});
  }
  const command=deps.monaco.editor.registerCommand(GATEWAY,async (_accessor,token:unknown)=>{
    const target=typeof token==='string' ? targets.get(token) : undefined;
    if (!target || !current(target)) throw Error('Quick Fix is stale; request it again');
    let applyingList:string|null=null;
    try {
      const action=await resolve(target), editor=deps.getEditor(), model=editor?.getModel();
      if (!current(target) || !editor || !model || editor.getOption(deps.monaco.editor.EditorOption.readOnly)) throw Error('Editor is not available for this Quick Fix');
      const edits=quickFixEdits(action,target.context,model);
      if (action.command!==undefined && (!record(action.command) || typeof action.command.id!=='string' || action.command.arguments!==undefined && !Array.isArray(action.command.arguments))) throw Error('Unsupported Quick Fix command');
      // A result is single-use, including an execution whose outcome is unknown.
      target.disposed=true;
      applyingList=String(target.raw.listId);running.add(applyingList);
      if (edits.length) {
        editor.pushUndoStop();
        if (!editor.executeEdits('te2.quickFix',edits)) throw Error('Quick Fix edits were not applied');
        editor.pushUndoStop();
      }
      if (record(action.command)) await deps.call('vscode.extensionCommands.execute',{
        ...params(target.context),command:action.command.id,arguments:action.command.arguments || [],surface:'quickfix',
      });
    } catch(error) {deps.notify(`Quick Fix failed: ${error instanceof Error ? error.message : String(error)}`); throw error;}
    finally {if(applyingList){running.delete(applyingList);if(deferredRelease.delete(applyingList))release(applyingList,target.context);}}
  });
  const provider:Monaco.languages.CodeActionProvider={
    async provideCodeActions(model,range,context,token) {
      if(boundEditor!==deps.getEditor()){
        editorSubscription?.dispose();boundEditor=deps.getEditor();
        editorSubscription=boundEditor?.onDidChangeModel?.(()=>reset());
      }
      const ctx=deps.getContext(), generation=deps.getGeneration(), capturedEpoch=epoch;
      if (!deps.isEnabled() || !ctx || model.uri.toString()!==ctx.uri || model.getVersionId()!==ctx.version || !context.markers.length || token.isCancellationRequested
          || context.only && context.only!=='quickfix' && !context.only.startsWith('quickfix.')) return {actions:[],dispose(){}};
      const result=await deps.call('vscode.codeActions.provide',{...params(ctx),range,trigger:context.trigger,text:model.getValue()});
      if (!record(result) || !Array.isArray(result.actions)) return {actions:[],dispose(){}};
      const capturedContext:Context=ctx;
      const keys:string[]=[], lists=new Set<string>(), actions:Monaco.languages.CodeAction[]=[];
      for (const raw of result.actions) {
        if (!record(raw) || typeof raw.listId!=='string' || typeof raw.title!=='string') continue;
        lists.add(raw.listId); releases.set(raw.listId,ctx);
        if (epoch!==capturedEpoch || generation!==deps.getGeneration() || token.isCancellationRequested || deps.getContext()?.version!==ctx.version || deps.getContext()?.uri!==ctx.uri) continue;
        const key=String(++sequence), target:Target={raw,context:ctx,generation,model,disposed:false};
        targets.set(key,target); keys.push(key);
        let disabled=typeof raw.disabled==='string' ? raw.disabled : undefined;
        try {if(raw.edit!==undefined || raw.command!==undefined || raw.disabled)quickFixEdits(raw,ctx,model);} catch(error){disabled=String(error instanceof Error ? error.message : error);}
        actions.push({title:raw.title,kind:String(raw.kind || 'quickfix'),isPreferred:raw.isPreferred===true,disabled,
          command:{id:GATEWAY,title:raw.title,arguments:[key]}});
      }
      if (!actions.length) for (const id of lists) release(id,ctx);
      while(targets.size>512) {const key=targets.keys().next().value!; const target=targets.get(key)!;target.disposed=true;targets.delete(key);}
      let disposed=false;
      let contentSubscription:Monaco.IDisposable|undefined, modelSubscription:Monaco.IDisposable|undefined;
      function dispose():void {
        if(disposed)return;disposed=true;cleanups.delete(dispose);
        contentSubscription?.dispose();modelSubscription?.dispose();
        for(const key of keys){const t=targets.get(key);if(t)t.disposed=true;targets.delete(key);}
        for(const id of lists)release(id,capturedContext);
      }
      cleanups.add(dispose);
      contentSubscription=model.onDidChangeContent?.(dispose);
      modelSubscription=model.onWillDispose?.(dispose);
      return {actions,dispose};
    },
    async resolveCodeAction(action,token) {
      const key=action.command?.arguments?.[0], target=typeof key==='string' ? targets.get(key) : undefined;
      if (!target || token.isCancellationRequested) {action.disabled='Quick Fix is stale';return action;}
      try {const resolved=await resolve(target);const model=deps.getEditor()?.getModel();if(!model)throw Error('Editor unavailable');quickFixEdits(resolved,target.context,model);return action;}
      catch(error){action.disabled=error instanceof Error?error.message:String(error);return action;}
    },
  };
  let registration=deps.monaco.languages.registerCodeActionProvider('*',provider,{providedCodeActionKinds:['quickfix']});
  function reset():void {epoch++;for(const cleanup of cleanups)cleanup();for(const t of targets.values())t.disposed=true;targets.clear();for(const [id,ctx]of releases)release(id,ctx);}
  return {reset,changed(){reset();registration.dispose();registration=deps.monaco.languages.registerCodeActionProvider('*',provider,{providedCodeActionKinds:['quickfix']});},dispose(){reset();editorSubscription?.dispose();registration.dispose();command.dispose();}};
}
