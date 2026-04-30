interface BreadcrumbLspPointLike {
  line?: unknown;
  character?: unknown;
}

interface BreadcrumbSymbolRangeObjectLike {
  startLineNumber?: unknown;
  startLine?: unknown;
  startColumn?: unknown;
  start?: BreadcrumbLspPointLike | null;
}

type BreadcrumbSymbolRangeLike = BreadcrumbSymbolRangeObjectLike | unknown[] | null | undefined;

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getBreadcrumbSymbolPosition(symRange: BreadcrumbSymbolRangeLike): { line: number; col: number } {
  if (!symRange) return { line: 1, col: 1 };
  if (Array.isArray(symRange) && symRange.length >= 2) {
    return {
      line: Number(symRange[0]) + 1,
      col: Number(symRange[1]) + 1,
    };
  }

  const range = symRange as BreadcrumbSymbolRangeObjectLike;
  const startLine =
    asNumber(range.startLineNumber) ??
    asNumber(range.startLine) ??
    (asNumber(range.start?.line) != null ? Number(range.start?.line) + 1 : null) ??
    1;
  const startCol =
    asNumber(range.startColumn) ??
    (asNumber(range.start?.character) != null ? Number(range.start?.character) + 1 : null) ??
    1;
  return { line: startLine, col: startCol };
}
