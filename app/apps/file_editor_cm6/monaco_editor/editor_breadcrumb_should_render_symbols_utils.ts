export function shouldRenderBreadcrumbSymbolChain(
  symbols: unknown[] | null | undefined,
  cursorLine: number | undefined,
): boolean {
  return !!(Array.isArray(symbols) && symbols.length > 0 && typeof cursorLine === 'number' && cursorLine > 0);
}
