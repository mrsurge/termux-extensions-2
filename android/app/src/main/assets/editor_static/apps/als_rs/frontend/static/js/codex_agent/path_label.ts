type PathLabelOptions = {
  className?: string;
  title?: string;
  strong?: boolean;
  basenameClass?: string;
};

const PATH_SCROLL_RETRY_DELAYS_MS = [0, 50, 150];

export function scrollPathLabelToEnd(el: HTMLElement | null | undefined): void {
  if (!(el instanceof HTMLElement)) return;
  const apply = () => {
    el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  };
  apply();
  const win = el.ownerDocument?.defaultView;
  if (!win) return;
  const applyAfterPaint = () => {
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => {
        apply();
        win.requestAnimationFrame(apply);
      });
      return;
    }
    apply();
  };
  applyAfterPaint();
  PATH_SCROLL_RETRY_DELAYS_MS.forEach((delayMs) => {
    win.setTimeout(applyAfterPaint, delayMs);
  });
}

export function scrollPathLabelsToEnd(root: ParentNode | null | undefined): void {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll<HTMLElement>('.path-scroll-label').forEach((el) => {
    scrollPathLabelToEnd(el);
  });
}

export function applyPathScrollLabel(
  el: HTMLElement,
  label: string,
  options: PathLabelOptions = {},
): HTMLElement {
  const classes = ['path-scroll-label', options.className || '', options.strong ? 'path-scroll-strong' : '']
    .filter(Boolean)
    .join(' ');
  el.classList.add(...classes.split(/\s+/).filter(Boolean));
  el.textContent = label || 'file';
  if (options.basenameClass) {
    const text = label || 'file';
    const slash = text.lastIndexOf('/') + 1;
    const name = el.ownerDocument.createElement('span');
    name.className = options.basenameClass;
    name.textContent = text.slice(slash);
    el.replaceChildren(text.slice(0, slash), name);
  }
  if (options.title) {
    el.title = options.title;
  }
  scrollPathLabelToEnd(el);
  return el;
}

export function createPathScrollLabel(
  documentRef: Document,
  label: string,
  options: PathLabelOptions = {},
): HTMLSpanElement {
  const el = documentRef.createElement('span');
  applyPathScrollLabel(el, label, options);
  return el;
}

export function pathScrollLabelHtml(
  label: string,
  escapeHtml: (text: string) => string,
  options: Pick<PathLabelOptions, 'className' | 'strong' | 'basenameClass'> = {},
): string {
  const classes = ['path-scroll-label', options.className || '', options.strong ? 'path-scroll-strong' : '']
    .filter(Boolean)
    .join(' ');
  const text = label || 'file';
  const slash = text.lastIndexOf('/') + 1;
  const content = options.basenameClass
    ? `${escapeHtml(text.slice(0, slash))}<span class="${escapeHtml(options.basenameClass)}">${escapeHtml(text.slice(slash))}</span>`
    : escapeHtml(text);
  return `<span class="${escapeHtml(classes)}">${content}</span>`;
}
