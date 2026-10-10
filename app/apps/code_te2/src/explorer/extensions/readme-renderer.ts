import * as smd from '../../../vendor/streaming-markdown/smd.js';
import { highlightReadmeCode } from '../search/render-styling.ts';

export function renderExtensionReadme(container: HTMLElement, markdown: string, baseUrl?: string): void {
  container.replaceChildren();
  const renderer = smd.default_renderer(container);
  const originalSetAttr = renderer.set_attr;
  renderer.set_attr = (data, type, value) => {
    const node = data.nodes[data.index];
    if (type === smd.LANG) {
      node.dataset.language = value.trim().split(/\s+/)[0].replace(/^language-/, '').toLowerCase();
      return;
    }
    if (type === smd.HREF || type === smd.SRC) {
      try {
        const url = new URL(value, baseUrl);
        if (url.protocol !== 'https:' || url.username || url.password) return;
        originalSetAttr(data, type, url.href);
        if (type === smd.HREF) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
        else { node.setAttribute('loading', 'lazy'); node.setAttribute('referrerpolicy', 'no-referrer'); }
      } catch { /* Unsafe/unresolvable URLs remain inert. */ }
      return;
    }
    originalSetAttr(data, type, value);
  };
  const parser = smd.parser(renderer);
  smd.parser_write(parser, markdown);
  smd.parser_end(parser);
  const document = container.ownerDocument;
  for (const table of container.querySelectorAll('table')) {
    const scroller = document.createElement('div'); scroller.className = 'fe-readme-table-scroll';
    scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Scrollable table');
    table.replaceWith(scroller); scroller.appendChild(table);
  }
  for (const code of container.querySelectorAll<HTMLElement>('pre > code')) {
    code.parentElement!.tabIndex = 0;
    highlightReadmeCode(code, code.dataset.language || '');
  }
}
