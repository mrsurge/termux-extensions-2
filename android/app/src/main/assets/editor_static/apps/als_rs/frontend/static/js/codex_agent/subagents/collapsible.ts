import {
  applyTranscriptCardMetadata,
  type TranscriptCardMetadata,
} from '../transcript_card_metadata.ts';
import { scrollPathLabelsToEnd } from '../path_label.ts';
import type { ToggleableRow, UnknownRecord } from '../shared_types.ts';

interface CollapsibleOptions {
  headerEl?: HTMLElement | null;
  persist?: boolean;
  fullHeaderToggle?: boolean;
  toggleZone?: boolean;
  onToggle?: ((expanded: boolean) => void) | null;
}

interface SubagentContainerRecord {
  row: ToggleableRow;
  body: HTMLDivElement;
  header: HTMLDivElement;
  statusEl: HTMLSpanElement;
  label: HTMLSpanElement;
  items: HTMLElement[];
}

interface SubagentsCollapsibleContext {
  clearPlaceholder(): void;
  insertRow(row: HTMLElement, beforeEl?: ChildNode | null): void;
  maybeAutoScroll(force?: boolean): void;
  documentRef: Document;
  mutateRow?(row: HTMLElement, mutation: () => void): void;
}

export function bindSubagentsCollapsible(ctx: SubagentsCollapsibleContext) {
  const {
    clearPlaceholder,
    insertRow,
    maybeAutoScroll,
    documentRef,
    mutateRow,
  } = ctx;

  const subagentContainers = new Map<string, SubagentContainerRecord>();
  let mostRecentlyExpanded = '';

  function isInteractiveHeaderTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest([
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[data-project-action]',
      '[data-agent-diff-action]',
      '.project-file-actions',
      '.project-agent-diff-actions',
      '.project-category-actions',
      '.twisty',
      '.ribbon-toggle-zone',
    ].join(',')));
  }

  function makeCollapsible(
    row: HTMLElement | null,
    cardId: string,
    startExpanded: boolean,
    options: CollapsibleOptions = {},
  ) {
    if (!(row instanceof HTMLElement)) return;
    const rowEl = row as ToggleableRow;
    const {
      headerEl = rowEl.querySelector('.command-ribbon') || rowEl.querySelector('.diff-path-label'),
      fullHeaderToggle = false,
      toggleZone = !fullHeaderToggle,
      onToggle = null,
    } = options;
    if (!(headerEl instanceof HTMLElement)) return;
    const headerNode = headerEl;

    rowEl.classList.add('collapsible');
    if (cardId) rowEl.dataset.virtualRowKey = cardId;
    const isExpanded = Boolean(startExpanded);
    rowEl.classList.toggle('expanded', isExpanded);
    rowEl.classList.toggle('expanded-mru', isExpanded && cardId === mostRecentlyExpanded);

    let twistyEl = headerNode.querySelector(':scope > .twisty') as HTMLElement | null;
    if (!(twistyEl instanceof HTMLElement)) {
      twistyEl = headerNode.querySelector('.twisty') as HTMLElement | null;
    }
    if (!(twistyEl instanceof HTMLElement)) {
      twistyEl = documentRef.createElement('span');
      twistyEl.className = 'twisty';
      twistyEl.textContent = '▶';
      headerNode.appendChild(twistyEl);
    }

    function syncExpandedState(expanded: boolean) {
      headerNode.dataset.expanded = expanded ? 'true' : 'false';
      headerNode.querySelector('.ribbon-toggle-zone')?.setAttribute('aria-expanded', String(expanded));
    }

    function syncExpandedPathLabels(expanded: boolean) {
      if (!expanded) return;
      scrollPathLabelsToEnd(rowEl);
      const win = rowEl.ownerDocument?.defaultView;
      if (win && typeof win.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(() => scrollPathLabelsToEnd(rowEl));
      }
    }

    function toggleCollapse(forceExpanded?: boolean) {
      const expanded = typeof forceExpanded === 'boolean'
        ? forceExpanded
        : !rowEl.classList.contains('expanded');
      const applyMutation = () => {
        rowEl.classList.toggle('expanded', expanded);
        if (!rowEl.classList.contains('project-file-card')) {
          if (expanded && forceExpanded === undefined) {
            documentRef.querySelectorAll('#agent-timeline .expanded-mru').forEach((el) => el.classList.remove('expanded-mru'));
            mostRecentlyExpanded = cardId;
          }
          rowEl.classList.toggle('expanded-mru', expanded && cardId === mostRecentlyExpanded);
        }
        syncExpandedState(expanded);
        syncExpandedPathLabels(expanded);
        if (typeof onToggle === 'function') onToggle(expanded);
      };
      if (mutateRow) mutateRow(rowEl, applyMutation);
      else applyMutation();
      maybeAutoScroll();
      return expanded;
    }

    rowEl._toggleCollapse = toggleCollapse;
    syncExpandedState(isExpanded);
    syncExpandedPathLabels(isExpanded);

    twistyEl.style.pointerEvents = 'auto';
    twistyEl.style.cursor = 'pointer';
    twistyEl.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCollapse();
    });

    if (toggleZone) {
      let toggleZoneEl = headerNode.querySelector(':scope > .ribbon-toggle-zone') || headerNode.querySelector('.ribbon-toggle-zone');
      if (!(toggleZoneEl instanceof HTMLElement)) {
        toggleZoneEl = documentRef.createElement('span');
        toggleZoneEl.className = 'ribbon-toggle-zone';
        headerNode.appendChild(toggleZoneEl);
      }
      toggleZoneEl.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCollapse();
      });
      toggleZoneEl.setAttribute('role', 'button');
      toggleZoneEl.setAttribute('tabindex', '0');
      toggleZoneEl.setAttribute('aria-label', 'Expand or collapse card');
      toggleZoneEl.setAttribute('aria-expanded', String(isExpanded));
      toggleZoneEl.addEventListener('keydown', (event) => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopPropagation();
          toggleCollapse();
        }
      });
    }

    if (fullHeaderToggle) {
      headerNode.addEventListener('click', (event) => {
        if (isInteractiveHeaderTarget(event.target)) return;
        toggleCollapse();
      });
    }
  }

  function getSubagentContainer(
    id: string,
    name: string,
    intent: string,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    let subagent = subagentContainers.get(id);
    if (!subagent) {
      clearPlaceholder();
      const row = documentRef.createElement('div');
      row.className = 'timeline-row subagent-card';
      row.dataset.subagentId = id;

      const header = documentRef.createElement('div');
      header.className = 'subagent-header command-ribbon';
      const label = documentRef.createElement('span');
      label.textContent = `${name || 'subagent'}: ${intent || 'working'}`;
      const statusEl = documentRef.createElement('span');
      statusEl.className = 'subagent-status';
      statusEl.textContent = '⏳ running';
      header.append(label, statusEl);
      row.appendChild(header);

      const body = documentRef.createElement('div');
      body.className = 'subagent-body';
      row.appendChild(body);
      applyTranscriptCardMetadata(row, metadata);

      insertRow(row);
      makeCollapsible(row, `subagent:${id}`, false, {
        headerEl: header,
        fullHeaderToggle: true,
      });
      subagent = { row, body, header, statusEl, label, items: [] };
      subagentContainers.set(id, subagent);
    } else if (subagent.row instanceof HTMLElement) {
      applyTranscriptCardMetadata(subagent.row, metadata);
    }
    return subagent;
  }

  function getLiveEventParent(evt: UnknownRecord | null | undefined) {
    const subagentId = typeof evt?.subagent_id === 'string' ? evt.subagent_id : '';
    if (!subagentId) return null;
    return getSubagentContainer(subagentId, '', '').body;
  }

  function finalizeSubagent(id: string, summary: string, success: boolean) {
    const subagent = subagentContainers.get(id);
    if (!subagent) return;
    subagent.statusEl.textContent = success !== false ? '✓ done' : '✗ failed';
    if (summary) {
      const summaryEl = documentRef.createElement('div');
      summaryEl.className = 'subagent-summary';
      summaryEl.style.cssText = 'padding: 4px 14px; font-size: 0.85em; opacity: 0.7; font-style: italic;';
      summaryEl.textContent = summary;
      subagent.body.appendChild(summaryEl);
    }
  }

  return {
    getSubagentContainer,
    getLiveEventParent,
    finalizeSubagent,
    makeCollapsible,
  };
}
