export interface BreadcrumbSymbolClickPosition {
  line: number;
  col: number;
}

export function getBreadcrumbSymbolClickPosition(ev: Event): BreadcrumbSymbolClickPosition {
  const el = ev.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
  const line = Number.parseInt(el?.dataset.line || '', 10);
  const col = Number.parseInt(el?.dataset.col || '', 10) || 1;
  return { line, col };
}
