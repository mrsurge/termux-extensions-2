import { isUnknownArray } from '../src/rpc/value-types.ts';
interface HoverContext {
  uri: string;
  path: string;
  languageId: string;
  version: number;
}

interface HoverCommandDeps {
  registerCommand(id: string, handler: (accessor: unknown, token: unknown) => Promise<unknown>): { dispose(): void };
  getContext(): HoverContext | null;
  getGeneration(): number;
  execute(params: Record<string, unknown>): Promise<unknown>;
}

const GATEWAY = 'te2.extensionHoverCommand';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !isUnknownArray(value);
}

/** Use one private command, not global registrations that shadow Monaco commands. */
export function createEditorHoverCommandRuntime(deps: HoverCommandDeps) {
  let sequence = 0;
  const targets = new Map<string, { command: string; arguments: unknown[]; context: HoverContext; generation: number }>();
  const registration = deps.registerCommand(GATEWAY, async (_accessor, token) => {
    const target = typeof token === 'string' ? targets.get(token) : null;
    const current = deps.getContext();
    if (!target || !current || target.generation !== deps.getGeneration() ||
        current.uri !== target.context.uri || current.version !== target.context.version) {
      throw new Error('This hover command is stale; open the hover again.');
    }
    return deps.execute({ ...target.context, command: target.command, arguments: target.arguments, surface: 'hover' });
  });

  function prepare(contents: unknown[], context: HoverContext): unknown[] {
    targets.clear();
    return contents.map(content => {
      if (!record(content) || typeof content.value !== 'string') return content;
      const trust = content.isTrusted;
      const allowed = trust === true ? null : record(trust) && isUnknownArray(trust.enabledCommands)
        ? trust.enabledCommands.filter((v): v is string => typeof v === 'string') : [];
      let rewritten = false;
      const value = content.value.replace(/command:([^\s)'"<>]+)/g, (original: string, suffix: string) => {
        if (suffix.length > 16384 || targets.size >= 128) return original;
        const split = suffix.indexOf('?');
        const command = split < 0 ? suffix : suffix.slice(0, split);
        if (!command || allowed !== null && !allowed.includes(command)) return original;
        let args: unknown = [];
        try { if (split >= 0) args = JSON.parse(decodeURIComponent(suffix.slice(split + 1))); }
        catch { return original; }
        const token = String(++sequence);
        targets.set(token, { command, arguments: isUnknownArray(args) ? args : [args], context: { ...context }, generation: deps.getGeneration() });
        rewritten = true;
        return `command:${GATEWAY}?${encodeURIComponent(JSON.stringify([token]))}`;
      });
      return rewritten ? { ...content, value, isTrusted: { enabledCommands: [GATEWAY] } } : content;
    });
  }

  return { prepare, reset: () => targets.clear(), dispose() { targets.clear(); registration.dispose(); } };
}
