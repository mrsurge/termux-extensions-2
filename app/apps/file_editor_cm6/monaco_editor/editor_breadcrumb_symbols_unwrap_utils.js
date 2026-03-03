export function unwrapBreadcrumbSymbols(result) {
  var symbols = result;
  if (symbols && typeof symbols === 'object' && !Array.isArray(symbols)) {
    symbols = symbols.result || symbols.symbols || [];
  }
  return Array.isArray(symbols) ? symbols : [];
}
