import { randomUUID } from 'node:crypto';
import type { ProviderRegistry, ProviderDocument, ProviderEntry } from '../provider-registry';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export interface QuickFixRuntime {
  registry: ProviderRegistry;
  document(params: Record<string, unknown>): ProviderDocument;
  uri(path: string): unknown;
  request(method: string, args: unknown[]): Promise<unknown>;
  commandSupported(command: string): boolean;
}
interface List {
  owner: string; path: string; version: number; handle: number; cache: number;
  actions: Record<string, unknown>[]; expires: number;
  provider: ProviderEntry;
}
export class QuickFixService {
  private lists = new Map<string, List>();
  private epoch = 0;
  constructor(private runtime: QuickFixRuntime) {}
  private async release(id: string): Promise<void> {
    const list = this.lists.get(id);
    if (!list) return;
    this.lists.delete(id);
    if (this.runtime.registry.getProvider('codeActions', list.handle) !== list.provider) return;
    await this.runtime.request('$releaseCodeActions', [list.handle, list.cache]).catch(() => {});
  }
  reset(release = false): void {
    this.epoch++;
    if (release) for (const id of this.lists.keys()) void this.release(id);
    else this.lists.clear();
  }
  async call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const owner = String(params.clientInstanceId || ''), path = String(params.path || '');
    if (!owner || !path) throw Error('Quick Fix requires exact client/document identity');
    if (method === 'provide') {
      const epoch = this.epoch;
      for (const [id, list] of this.lists) if (list.expires < Date.now() || !this.runtime.registry.getProvider('codeActions', list.handle)) await this.release(id);
      const actions: Record<string, unknown>[] = [];
      const created: string[] = [];
      const document = this.runtime.document(params);
      try {
      for (const handle of this.runtime.registry.findAllProviderHandlesForDocument('codeActions', document)) {
        const provider = this.runtime.registry.getProvider('codeActions', handle);
        if (!provider) continue;
        if (provider?.providedKinds?.length && !provider.providedKinds.some(k => k === 'quickfix' || k.startsWith('quickfix.'))) continue;
        const raw = await this.runtime.request('$provideCodeActions', [handle, this.runtime.uri(path), params.range, {only:'quickfix', trigger:params.trigger === 1 ? 1 : 2}]);
        if (epoch !== this.epoch) return {actions:[]};
        if (!record(raw) || !Number.isInteger(raw.cacheId) || !Array.isArray(raw.actions)) continue;
        if (this.runtime.registry.getProvider('codeActions', handle) !== provider) {
          await this.runtime.request('$releaseCodeActions', [handle, raw.cacheId]).catch(()=>{});
          continue;
        }
        const id = randomUUID();
        const selected = raw.actions.filter((a): a is Record<string, unknown> => record(a) && typeof a.title === 'string' && typeof a.kind === 'string' && (a.kind === 'quickfix' || a.kind.startsWith('quickfix.'))).slice(0, 100);
        for (const action of selected) if (action.command !== undefined && (!record(action.command)
            || typeof action.command.id !== 'string' || !this.runtime.commandSupported(action.command.id))) {
          action.disabled = 'This Quick Fix command is not supported';
        }
        this.lists.set(id, {owner,path,version:Number(params.modelVersionId),handle,cache:raw.cacheId as number,actions:selected,expires:Date.now()+120000,provider});
        created.push(id);
        if (!selected.length) { await this.release(id); continue; }
        for (let index = 0; index < selected.length; index++) actions.push({...selected[index], listId:id, actionIndex:index});
        while (this.lists.size > 64) await this.release(this.lists.keys().next().value!);
        if (actions.length >= 256) break;
      }
      } catch (error) {
        for (const id of created) await this.release(id);
        throw error;
      }
      return {actions};
    }
    const id = String(params.listId || ''), list = this.lists.get(id);
    if (!list || list.owner !== owner || list.path !== path) throw Error('Quick Fix result is no longer available');
    if (method === 'release') { await this.release(id); return {ok:true}; }
    if (list.expires < Date.now() || list.version !== params.modelVersionId || this.runtime.registry.getProvider('codeActions', list.handle) !== list.provider) throw Error('Quick Fix result is stale');
    if (typeof params.actionIndex !== 'number' || !Number.isInteger(params.actionIndex) || params.actionIndex < 0) throw Error('Invalid Quick Fix action index');
    const action = list.actions[params.actionIndex];
    if (!action) throw Error('Unknown Quick Fix action');
    const provider = this.runtime.registry.getProvider('codeActions', list.handle);
    let resolved: unknown = {};
    if (provider?.supportsResolve && Array.isArray(action.cacheId)) resolved = await this.runtime.request('$resolveCodeAction', [list.handle, action.cacheId]);
    if (this.lists.get(id) !== list || this.runtime.registry.getProvider('codeActions', list.handle) !== list.provider) throw Error('Quick Fix provider retired during resolution');
    const merged = {...action, ...(record(resolved) ? resolved : {})};
    if (record(merged.command) && (typeof merged.command.id !== 'string' || !this.runtime.commandSupported(merged.command.id))) {
      merged.disabled = 'This Quick Fix command is not supported';
    }
    return {action:merged};
  }
}
