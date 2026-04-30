interface BreadcrumbIconResult {
  svg?: string;
  color?: string;
}

export function applyBreadcrumbFileIcon(
  getIconFn: (
    name: string,
    theme: Record<string, string>,
  ) => unknown,
  iconSpan: HTMLElement,
  name: string,
  theme: Record<string, string>,
): void {
  Promise.resolve(getIconFn(name, theme))
    .then((icon) => {
      const result =
        icon && typeof icon === 'object'
          ? (icon as BreadcrumbIconResult)
          : null;
      if (result?.svg) iconSpan.innerHTML = result.svg;
      if (result?.color) iconSpan.style.color = result.color;
    })
    .catch(() => {});
}
