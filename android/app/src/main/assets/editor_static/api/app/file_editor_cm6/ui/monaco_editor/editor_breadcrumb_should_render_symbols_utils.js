export function shouldRenderBreadcrumbSymbolChain(symbols, cursorLine) {
  return !!(symbols && symbols.length && typeof cursorLine === 'number' && cursorLine > 0);
}
