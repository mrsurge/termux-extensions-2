interface BreadcrumbSymbolEnvelope {
  result?: unknown;
  symbols?: unknown;
}

function isEnvelope(value: unknown): value is BreadcrumbSymbolEnvelope {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapBreadcrumbSymbols(result: unknown): unknown[] {
  let symbols = result;
  if (isEnvelope(symbols)) {
    symbols = symbols.result ?? symbols.symbols ?? [];
  }
  return Array.isArray(symbols) ? symbols : [];
}
