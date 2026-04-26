export interface GrammarListItem {
  id: string;
  scopeName: string;
  language: string | null;
  extensionId: string;
  _extPath: string | null;
  _grammarRelPath: string | null;
}

export interface GrammarServerRuntime {
  getExtensions: () => unknown[];
  resolvePath: (basePath: string, relativePath: string) => string;
  readTextFile: (path: string) => Promise<string>;
  log: (...args: unknown[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function extensionId(ext: unknown): string {
  if (isRecord(ext)) {
    const direct = stringOrNull(ext.id);
    if (direct) return direct;
    const identifier = isRecord(ext.identifier) ? stringOrNull(ext.identifier.value) : null;
    if (identifier) return identifier;
  }
  return "unknown";
}

function extensionLocationPath(ext: unknown): string | null {
  if (!isRecord(ext)) return null;
  const location = isRecord(ext.extensionLocation) ? ext.extensionLocation : null;
  return location ? stringOrNull(location.path) : null;
}

function contributedGrammars(ext: unknown): unknown[] {
  if (!isRecord(ext)) return [];
  const contributes = isRecord(ext.contributes) ? ext.contributes : null;
  const grammars = contributes ? contributes.grammars : null;
  return Array.isArray(grammars) ? grammars : [];
}

export function listTextmateGrammars(runtime: GrammarServerRuntime): GrammarListItem[] {
  const exts = runtime.getExtensions();
  const grammars: GrammarListItem[] = [];
  for (const ext of exts) {
    const extId = extensionId(ext);
    const extLocPath = extensionLocationPath(ext);
    for (const grammar of contributedGrammars(ext)) {
      if (!isRecord(grammar)) continue;
      const scopeName = stringOrNull(grammar.scopeName);
      if (!scopeName) continue;
      const grammarRelPath = stringOrNull(grammar.path);
      const grammarId = `${extId}/${grammarRelPath ?? scopeName}`;
      grammars.push({
        id: grammarId,
        scopeName,
        language: stringOrNull(grammar.language),
        extensionId: extId,
        _extPath: extLocPath,
        _grammarRelPath: grammarRelPath,
      });
    }
  }
  runtime.log(`[grammars.list] found ${grammars.length} grammars from ${exts.length} extensions`);
  return grammars;
}

export async function loadTextmateGrammar(
  runtime: GrammarServerRuntime,
  grammarId: string,
): Promise<{ ok: true; raw: string } | { ok: false; error: string }> {
  const exts = runtime.getExtensions();
  for (const ext of exts) {
    const extId = extensionId(ext);
    const extLocPath = extensionLocationPath(ext);
    if (!extLocPath) continue;
    for (const grammar of contributedGrammars(ext)) {
      if (!isRecord(grammar)) continue;
      const grammarRelPath = stringOrNull(grammar.path);
      if (!grammarRelPath) continue;
      const thisId = `${extId}/${grammarRelPath}`;
      if (thisId !== grammarId) continue;
      const absPath = runtime.resolvePath(extLocPath, grammarRelPath);
      try {
        const grammarRaw = await runtime.readTextFile(absPath);
        runtime.log(`[grammars.load] loaded ${grammarId} (${grammarRaw.length} bytes)`);
        return { ok: true, raw: grammarRaw };
      } catch (error) {
        return { ok: false, error: `Failed to read grammar: ${String((error as Error)?.message ?? error)}` };
      }
    }
  }
  return { ok: false, error: `Grammar not found: ${grammarId}` };
}
