export interface BreadcrumbPathClickTarget {
  isFile: boolean;
  absDir: string;
}

export function getBreadcrumbPathClickTarget(ev: Event): BreadcrumbPathClickTarget {
  const el = ev.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
  return {
    isFile: el?.dataset.isFile === '1',
    absDir: el?.dataset.path || '',
  };
}
