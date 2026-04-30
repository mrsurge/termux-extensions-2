interface BreadcrumbLineBounds {
  startLine: number;
  endLine: number;
}

type BreadcrumbSymbolRangeLike = { [key: string]: unknown } | unknown[] | null | undefined;

interface BreadcrumbSymbolLike {
  range?: BreadcrumbSymbolRangeLike;
  selectionRange?: BreadcrumbSymbolRangeLike;
  kind?: unknown;
  name?: unknown;
  location?: { range?: BreadcrumbSymbolRangeLike } | null;
  children?: BreadcrumbSymbolLike[] | null;
  [key: string]: unknown;
}

export function findBreadcrumbSymbolChain(
  symbols: BreadcrumbSymbolLike[] | null | undefined,
  line: number | undefined,
  symbolRangeToLineBoundsFn: (range: BreadcrumbSymbolRangeLike) => BreadcrumbLineBounds | null,
): BreadcrumbSymbolLike[] {
  if (typeof line !== 'number' || !Number.isFinite(line)) return [];

  const chain: BreadcrumbSymbolLike[] = [];
  let current = Array.isArray(symbols) ? symbols : [];
  while (current.length > 0) {
    let found: BreadcrumbSymbolLike | null = null;
    for (const symbol of current) {
      const range = symbol.range || symbol.location?.range;
      if (!range) continue;
      const bounds = symbolRangeToLineBoundsFn(range);
      if (!bounds) continue;
      if (line >= bounds.startLine && line <= bounds.endLine) {
        found = symbol;
        break;
      }
    }
    if (!found) break;
    chain.push(found);
    current = Array.isArray(found.children) ? found.children : [];
  }
  return chain;
}
