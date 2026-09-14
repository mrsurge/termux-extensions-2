type JsonObject = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' ? value.slice(0, 240) : '';

// WBA returns VS Code's internal (zero-based) SymbolKind and one-based IRange,
// not LSP SymbolKind/Range. Never guess a first-line location for invalid data.
const ICONS = ['file', 'module', 'namespace', 'package', 'class', 'method',
  'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable',
  'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null',
  'enum-member', 'struct', 'event', 'operator', 'type-parameter'];
export function symbolIcon(kind: unknown): string {
  return `symbol-${typeof kind === 'number' ? ICONS[kind] ?? 'object' : 'object'}`;
}
function validRange(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  const keys = ['startLineNumber', 'startColumn', 'endLineNumber', 'endColumn'] as const;
  if (!keys.every(key => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && Number(value[key]) > 0)) return null;
  if (Number(value.endLineNumber) < Number(value.startLineNumber)
    || (value.endLineNumber === value.startLineNumber && Number(value.endColumn) < Number(value.startColumn))) return null;
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

// Bound projection size/depth without flattening the provider's class/member
// hierarchy. These are snapshot rows, not additional retained WBA documents.
export function documentSymbolTree(items: unknown[], path: string): { tree: JsonObject[]; count: number; truncated: boolean } {
  let count = 0, visited = 0, truncated = false;
  const visit = (values: unknown[], depth: number): JsonObject[] => {
    const nodes: JsonObject[] = [];
    if (depth >= 32) { truncated ||= values.length > 0; return nodes; }
    for (const value of values) {
      if (visited >= 2000) { truncated = true; break; }
      visited++;
      if (!isRecord(value)) continue;
      const location = isRecord(value.location) ? value.location : {};
      const range = validRange(value.selectionRange) ?? validRange(value.range) ?? validRange(location.range);
      if (!range) continue;
      const id = `symbol:${visited}`;
      count++;
      nodes.push({ id, type: 'symbol', path, label: text(value.name) || 'Symbol',
        detail: text(value.detail) || text(value.containerName),
        description: text(value.detail) || text(value.containerName),
        kind: typeof value.kind === 'number' && Number.isInteger(value.kind) && value.kind >= 0 && value.kind < ICONS.length ? value.kind : 18,
        range, selectionRange: range,
        children: visit(Array.isArray(value.children) ? value.children : [], depth + 1),
      });
    }
    return nodes;
  };
  const tree = visit(items, 0);
  return { tree, count, truncated };
}
