import { appendElement, historyIconId, renderCounts, type HistoryCommitRow, type HistoryDetailsRow } from './pane-platform.ts';
import { SWIMLANE_HEIGHT, SWIMLANE_WIDTH, renderSCMHistoryGraphPlaceholder, getHistoryItemIndex } from './adapted/browser/scmHistory.ts';
import { asCssVariable } from './platform.ts';

/** Shared presentation only: totals arrive on the existing statistics stream. */
export function renderHistoryDetails(container: HTMLElement, row: HistoryCommitRow): void {
  container.replaceChildren();
  const counts = appendElement(container, 'history-detail-counts history-commit-statistics');
  renderCounts(counts, row.counts);
  const refs = appendElement(container, 'history-detail-refs');
  for (const ref of row.historyItemViewModel.historyItem.references || []) {
    const reference = appendElement(refs, 'history-detail-ref');
    reference.title = ref.id;
    if (ref.color) reference.style.color = asCssVariable(ref.color);
    const iconId = historyIconId(ref.icon);
    if (iconId) {
      const icon = appendElement(reference, `history-detail-ref-icon codicon codicon-${iconId}`);
      icon.setAttribute('aria-hidden', 'true');
    }
    const name = appendElement(reference, 'history-detail-ref-name');
    name.textContent = ref.name;
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
    const graph = renderSCMHistoryGraphPlaceholder(vm.outputSwimlanes, getHistoryItemIndex(vm));
    graph.classList.add('history-details-graph');
    graph.setAttribute('viewBox', `0 0 ${SWIMLANE_WIDTH * (vm.outputSwimlanes.length + 1)} ${SWIMLANE_HEIGHT}`);
    graph.setAttribute('preserveAspectRatio', 'none');
    graph.style.height = '100%';
    template.graph.replaceChildren(graph);
    renderHistoryDetails(template.body, owner);
  }
  renderCompressedElements(): never { throw Error('History details are incompressible'); }
  disposeTemplate(template: DetailsTemplate): void { template.element.remove(); }
}

export const HISTORY_DETAILS_HOVER_DELAY_MS = 1000;
export const HISTORY_DETAILS_HOVER_GRACE_MS = 400;

/** Desktop hover/focus is lazy DOM, not a second Git fetch or native title.
 * The portal follows live totals, remains owned by this host, and dies with it. */
export class HistoryDetailsHover {
  private portal: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private id: string | null = null;
  private revealTimer: number | null = null;
  private revealFrame: number | null = null;
  private warmResetTimer: number | null = null;
  private warm = false;
  private readonly over = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLElement>('.history-item[data-commit-id]');
    if (!anchor || !this.host.contains(anchor)) { this.hide(); return; }
    this.schedule(anchor, anchor.dataset.commitId || null);
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
    const anchor = Array.from(this.host.querySelectorAll<HTMLElement>('.history-item[data-commit-id]'))
      .find(element => element.dataset.commitId === id) || null;
    this.schedule(anchor, id);
  }
  private schedule(anchor: HTMLElement | null, id: string | null): void {
    if (!anchor || !id) { this.hide(); return; }
    if (this.anchor === anchor && this.id === id) {
      if (this.panel) this.refresh();
      return;
    }
    this.clearRevealWork();
    this.removePortal();
    this.anchor = anchor;
    this.id = id;
    const view = this.host.ownerDocument.defaultView;
    if (!view) { this.hide(); return; }
    this.cancelWarmReset();
    if (this.warm) {
      this.reveal();
      return;
    }
    this.revealTimer = view.setTimeout(() => {
      this.revealTimer = null;
      this.reveal();
    }, HISTORY_DETAILS_HOVER_DELAY_MS);
  }
  private reveal(): void {
    const row = this.id ? this.current(this.id) : undefined;
    if (!row || !this.anchor?.isConnected) { this.hide(); return; }
    const body = this.host.ownerDocument.body;
    if (!body) { this.hide(); return; }
    this.portal = appendElement(body, 'te2-scm-history te2-history-details-hover-portal');
    this.panel = appendElement(this.portal, 'history-details-hover');
    this.panel.setAttribute('role', 'tooltip');
    this.content = appendElement(this.panel, 'history-details-hover-content');
    this.warm = true;
    this.cancelWarmReset();
    this.refresh();
    const view = this.host.ownerDocument.defaultView;
    if (view) this.revealFrame = view.requestAnimationFrame(() => {
      this.revealFrame = null;
      this.portal?.classList.add('is-visible');
    });
  }
  refresh(): void {
    const row = this.id ? this.current(this.id) : undefined;
    if (!this.panel || !this.portal || !this.content) return;
    if (!row || !this.anchor?.isConnected) { this.hide(); return; }
    const item = row.historyItemViewModel.historyItem;
    this.content.replaceChildren();
    const title = appendElement(this.content, 'history-hover-title');
    title.textContent = `${item.subject}\n${item.id}\n${item.author || ''}`;
    renderHistoryDetails(appendElement(this.content, 'history-detail-body'), row);
    this.position();
  }
  private position(): void {
    if (!this.panel || !this.portal || !this.content || !this.anchor) return;
    const view = this.host.ownerDocument.defaultView;
    if (!view) return;
    const edge = 8, gap = 12;
    const hostBox = this.host.getBoundingClientRect(), anchorBox = this.anchor.getBoundingClientRect();
    const left = hostBox.right + gap;
    const availableWidth = Math.max(0, view.innerWidth - left - edge);
    const width = Math.min(Math.max(0, hostBox.width - edge), availableWidth);
    const maxHeight = Math.max(0, Math.min(hostBox.height * .8, view.innerHeight - edge * 2));
    this.portal.style.left = `${left}px`;
    this.portal.style.width = `${width}px`;
    for (let index = 0; index < this.host.style.length; index++) {
      const property = this.host.style.item(index);
      if (property.startsWith('--vscode-scmGraph-')) {
        this.portal.style.setProperty(property, this.host.style.getPropertyValue(property));
      }
    }
    const countWidth = view.getComputedStyle(this.host).getPropertyValue('--history-count-width').trim();
    if (countWidth) this.portal.style.setProperty('--history-count-width', countWidth);
    else this.portal.style.removeProperty('--history-count-width');
    this.content.style.maxHeight = `${Math.max(0, maxHeight - 2)}px`;
    const height = Math.min(this.panel.getBoundingClientRect().height, maxHeight);
    const anchorCenter = anchorBox.top + anchorBox.height / 2;
    const top = Math.max(edge, Math.min(anchorCenter - height / 2, view.innerHeight - height - edge));
    this.portal.style.top = `${top}px`;
    const caretTop = Math.max(8, Math.min(anchorCenter - top, Math.max(8, height - 8)));
    this.portal.style.setProperty('--history-hover-caret-top', `${caretTop}px`);
  }
  private clearRevealWork(): void {
    const view = this.host.ownerDocument.defaultView;
    if (this.revealTimer !== null && view) view.clearTimeout(this.revealTimer);
    if (this.revealFrame !== null && view) view.cancelAnimationFrame(this.revealFrame);
    this.revealTimer = null;
    this.revealFrame = null;
  }
  private removePortal(): void {
    this.portal?.remove();
    this.portal = null;
    this.panel = null;
    this.content = null;
  }
  private cancelWarmReset(): void {
    const view = this.host.ownerDocument.defaultView;
    if (this.warmResetTimer !== null && view) view.clearTimeout(this.warmResetTimer);
    this.warmResetTimer = null;
  }
  private startWarmReset(): void {
    if (!this.warm) return;
    const view = this.host.ownerDocument.defaultView;
    if (!view) { this.warm = false; return; }
    this.cancelWarmReset();
    this.warmResetTimer = view.setTimeout(() => {
      this.warmResetTimer = null;
      this.warm = false;
    }, HISTORY_DETAILS_HOVER_GRACE_MS);
  }
  hide(): void {
    this.clearRevealWork();
    this.removePortal();
    this.id = null;
    this.anchor = null;
    this.startWarmReset();
  }
  dispose(): void {
    this.clearRevealWork(); this.cancelWarmReset(); this.removePortal();
    this.id = null; this.anchor = null; this.warm = false;
    this.host.removeEventListener('pointerover', this.over);
    this.host.removeEventListener('focusin', this.over); this.host.removeEventListener('pointerleave', this.leave);
    this.host.removeEventListener('keydown', this.key);
  }
}
