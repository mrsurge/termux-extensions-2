import { appendElement, renderCounts, type HistoryCommitRow, type HistoryDetailsRow } from './pane-platform.ts';
import { renderSCMHistoryGraphPlaceholder, getHistoryItemIndex } from './adapted/browser/scmHistory.ts';
import { asCssVariable } from './platform.ts';

/** Shared presentation only: totals arrive on the existing statistics stream. */
export function renderHistoryDetails(container: HTMLElement, row: HistoryCommitRow): void {
  container.replaceChildren();
  const counts = appendElement(container, 'history-detail-counts history-commit-statistics');
  renderCounts(counts, row.counts);
  const refs = appendElement(container, 'history-detail-refs');
  for (const ref of row.historyItemViewModel.historyItem.references || []) {
    const label = appendElement(refs, 'history-detail-ref');
    label.textContent = ref.name;
    label.title = ref.id;
    if (ref.color) label.style.color = asCssVariable(ref.color);
  }
  if (!refs.childElementCount) refs.textContent = 'No branch or tag heads';
}

interface DetailsTemplate { element: HTMLElement; graph: HTMLElement; body: HTMLElement; }
/** Mobile gets one ordinary tree child; its graph continues through the row. */
export class HistoryDetailsRenderer {
  readonly templateId = 'history-item-details';
  constructor(private readonly current: (id: string) => HistoryCommitRow | undefined) {}
  renderTemplate(container: HTMLElement): DetailsTemplate {
    const element = appendElement(container, 'history-item-details');
    return { element, graph: appendElement(element, 'graph-placeholder'), body: appendElement(element, 'history-detail-body') };
  }
  renderElement(node: { readonly element: HistoryDetailsRow }, _index: number, template: DetailsTemplate): void {
    const owner = this.current(node.element.owner.historyItemViewModel.historyItem.id) || node.element.owner;
    const vm = owner.historyItemViewModel;
    template.graph.replaceChildren(renderSCMHistoryGraphPlaceholder(vm.outputSwimlanes, getHistoryItemIndex(vm)));
    renderHistoryDetails(template.body, owner);
  }
  renderCompressedElements(): never { throw Error('History details are incompressible'); }
  disposeTemplate(template: DetailsTemplate): void { template.element.remove(); }
}

/** Desktop hover/focus is lazy DOM, not a second Git fetch or native title.
 * The panel stays within its host, follows live totals, and dies with that host. */
export class HistoryDetailsHover {
  private panel: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private id: string | null = null;
  private readonly over = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.history-details-hover')) return;
    const anchor = target.closest<HTMLElement>('.history-item[data-commit-id]');
    if (!anchor || !this.host.contains(anchor)) { this.hide(); return; }
    this.anchor = anchor; this.id = anchor.dataset.commitId || null; this.refresh();
  };
  private readonly leave = () => this.hide();
  private readonly key = (event: KeyboardEvent) => { if (event.key === 'Escape') this.hide(); };
  constructor(private readonly host: HTMLElement, private readonly current: (id: string) => HistoryCommitRow | undefined) {
    host.addEventListener('pointerover', this.over);
    host.addEventListener('focusin', this.over);
    host.addEventListener('pointerleave', this.leave);
    host.addEventListener('keydown', this.key);
  }
  show(id: string | null): void {
    this.anchor = Array.from(this.host.querySelectorAll<HTMLElement>('.history-item[data-commit-id]'))
      .find(element => element.dataset.commitId === id) || null;
    this.id = id; this.refresh();
  }
  refresh(): void {
    const row = this.id ? this.current(this.id) : undefined;
    if (!row || !this.anchor?.isConnected) { this.hide(); return; }
    if (!this.panel) {
      this.panel = appendElement(this.host, 'history-details-hover');
      this.panel.setAttribute('role', 'tooltip');
    }
    const item = row.historyItemViewModel.historyItem;
    this.panel.replaceChildren();
    const title = appendElement(this.panel, 'history-hover-title');
    title.textContent = `${item.subject}\n${item.id}\n${item.author || ''}`;
    renderHistoryDetails(appendElement(this.panel, 'history-detail-body'), row);
    const hostBox = this.host.getBoundingClientRect(), anchorBox = this.anchor.getBoundingClientRect();
    const height = this.panel.getBoundingClientRect().height;
    this.panel.style.top = `${Math.max(0, Math.min(anchorBox.bottom - hostBox.top, hostBox.height - height))}px`;
  }
  hide(): void { this.panel?.remove(); this.panel = null; this.id = null; this.anchor = null; }
  dispose(): void {
    this.hide(); this.host.removeEventListener('pointerover', this.over);
    this.host.removeEventListener('focusin', this.over); this.host.removeEventListener('pointerleave', this.leave);
    this.host.removeEventListener('keydown', this.key);
  }
}
