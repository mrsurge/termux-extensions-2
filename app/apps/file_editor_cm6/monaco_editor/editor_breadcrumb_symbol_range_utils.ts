interface BreadcrumbLspPointLike {
  line?: unknown;
}

interface BreadcrumbSymbolRangeObjectLike {
  startLineNumber?: unknown;
  endLineNumber?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  start?: BreadcrumbLspPointLike | null;
  end?: BreadcrumbLspPointLike | null;
}

type BreadcrumbSymbolRangeLike = BreadcrumbSymbolRangeObjectLike | unknown[] | null | undefined;

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function symbolRangeToLineBounds(r: BreadcrumbSymbolRangeLike): { startLine: number; endLine: number } | null {
  if (!r) return null;
  if (Array.isArray(r) && r.length >= 3) {
    return {
      startLine: Number(r[0]) + 1,
      endLine: Number(r[2]) + 1,
    };
  }

  const range = r as BreadcrumbSymbolRangeObjectLike;
  if (asFiniteNumber(range.startLineNumber) != null) {
    return {
      startLine: Number(range.startLineNumber),
      endLine: asFiniteNumber(range.endLineNumber) ?? 999999,
    };
  }
  if (asFiniteNumber(range.start?.line) != null) {
    return {
      startLine: Number(range.start?.line) + 1,
      endLine: asFiniteNumber(range.end?.line) != null ? Number(range.end?.line) + 1 : 999999,
    };
  }
  if (asFiniteNumber(range.startLine) != null) {
    return {
      startLine: Number(range.startLine),
      endLine: asFiniteNumber(range.endLine) ?? 999999,
    };
  }
  return null;
}
