// app/apps/code_te2/src/explorer/chrome/sticky-scopes.ts
//
// "Sticky scopes" for the explorer tree (Monaco-ish).
// - Shows the directory ancestry of the first visible node.
// - Uses geometry (DOM rects) for push-up/pull-down animation between sibling scopes.
// - Sticky rows are non-interactive except for the ⋮ menu button.

import type { ExplorerTreeMenuEntry } from '../tree/types.ts';
import {
  getCanonicalTreeNodeName,
  renderExplorerTreeLabel,
} from '../tree/label.ts';

const PADDING_TOP = 8;
const BOTTOM_SHADOW_PAD_PX = 8;
const STICKY_MAX_VIEW_RATIO = 0.4;
const MIN_VISIBLE_TREE_ROWS = 4;

export function computeStickyScopeSlotLimit(
  viewportHeight: number,
  rowHeight: number,
  chainLength: number,
): number {
  if (viewportHeight <= 0 || rowHeight <= 0 || chainLength <= 0) {
    return 0;
  }

  const chromeHeight = PADDING_TOP + BOTTOM_SHADOW_PAD_PX;
  const ratioBudget = viewportHeight * STICKY_MAX_VIEW_RATIO - chromeHeight;
  const reservedRowsBudget =
    viewportHeight - MIN_VISIBLE_TREE_ROWS * rowHeight - chromeHeight;
  const rowBudget = Math.max(
    rowHeight,
    Math.min(ratioBudget, reservedRowsBudget),
  );
  return Math.min(chainLength, Math.max(1, Math.floor(rowBudget / rowHeight)));
}

export function constrainStickyScopeChain<T>(
  chain: readonly T[],
  slotLimit: number,
): T[][] {
  if (!chain.length || slotLimit <= 0) {
    return [];
  }
  if (chain.length <= slotLimit) {
    return chain.map((item) => [item]);
  }

  const individualCount = Math.max(0, slotLimit - 1);
  return [
    ...chain.slice(0, individualCount).map((item) => [item]),
    chain.slice(individualCount),
  ];
}

export interface ExplorerStickyScopesDeps {
  treeElement: HTMLElement;
  drawerBodyEl: HTMLElement;
  openCardMenuForEntry(
    entry: ExplorerTreeMenuEntry,
    anchorEl: HTMLElement,
  ): void;
}

export interface ExplorerStickyScopesApi {
  update(): void;
  destroy(): void;
}

interface NextTreeNodeAfterSubtree {
  node: HTMLLIElement;
  climbed: number;
}

function isElementVisibleRect(rect: DOMRect | null | undefined): boolean {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function closestTreeNodeBySelector(
  start: Element | null,
  selector: string,
): HTMLLIElement | null {
  if (!(start instanceof Element)) return null;
  const match = start.closest(selector);
  return match instanceof HTMLLIElement ? match : null;
}

function findClosestTreeNode(
  treeElement: HTMLElement,
  el: Element | null,
): HTMLLIElement | null {
  const li = closestTreeNodeBySelector(el, 'li.fe-tree-node');
  if (!li) return null;
  return treeElement.contains(li) ? li : null;
}

function getDirectoryChainFromNode(li: HTMLLIElement | null): HTMLLIElement[] {
  if (!li) return [];
  let cursor: HTMLLIElement | null = li;
  if (cursor.dataset.kind !== 'dir') {
    cursor = closestTreeNodeBySelector(
      cursor.parentElement,
      'li.fe-tree-node[data-kind="dir"]',
    );
  } else if (cursor.dataset.open !== 'true') {
    // Closed directories shouldn't become scopes just because they're visible.
    cursor = closestTreeNodeBySelector(
      cursor.parentElement,
      'li.fe-tree-node[data-kind="dir"]',
    );
  }
  const chain: HTMLLIElement[] = [];
  while (cursor) {
    const rel = cursor.dataset.rel || '';
    const isRoot = rel === '.';
    const isOpen = cursor.dataset.open === 'true';
    if (isRoot || isOpen) {
      chain.push(cursor);
    }
    cursor = closestTreeNodeBySelector(
      cursor.parentElement,
      'li.fe-tree-node[data-kind="dir"]',
    );
  }
  chain.reverse();
  return chain;
}

function findNextTreeNodeAfterSubtree(
  li: HTMLLIElement | null,
): NextTreeNodeAfterSubtree | null {
  if (!li) return null;
  // We need the first *tree row* after this directory's entire subtree,
  // regardless of whether that row is a dir or a file. This avoids a common
  // edge case where the "last directory" in a scope never gets pushed out
  // because only files follow it.
  let cursor: HTMLLIElement | null = li;
  let climbed = 0;
  while (cursor) {
    let sib: Element | null = cursor.nextElementSibling;
    while (sib) {
      if (sib instanceof HTMLLIElement && sib.matches('li.fe-tree-node')) {
        return { node: sib, climbed };
      }
      sib = sib.nextElementSibling;
    }
    cursor = closestTreeNodeBySelector(cursor.parentElement, 'li.fe-tree-node');
    climbed += 1;
  }
  return null;
}

function buildEntryFromLi(li: HTMLLIElement): ExplorerTreeMenuEntry {
  return {
    rel: li.dataset.rel || '',
    name: getCanonicalTreeNodeName(li),
    kind: li.dataset.kind || 'dir',
    gitStatus: li.dataset.gitStatus || '',
  };
}

function copyExplorerVisualClasses(
  srcLi: HTMLLIElement,
  destLi: HTMLLIElement,
): void {
  // Keep only the classes that affect visuals (git/draft + root).
  destLi.className = 'fe-tree-node fe-sticky-scope';
  srcLi.classList.forEach((cls) => {
    if (cls === 'fe-tree-root') destLi.classList.add(cls);
    if (cls === 'fe-draft') destLi.classList.add(cls);
    if (cls.startsWith('fe-git-')) destLi.classList.add(cls);
    if (cls.startsWith('fe-dir-has-')) destLi.classList.add(cls);
  });
}

export function createExplorerStickyScopes({
  treeElement,
  drawerBodyEl,
  openCardMenuForEntry,
}: ExplorerStickyScopesDeps): ExplorerStickyScopesApi | null {
  if (!treeElement || !drawerBodyEl) return null;

  let container =
    drawerBodyEl.querySelector<HTMLDivElement>('#fe-sticky-scopes');
  if (!container) {
    container = document.createElement('div');
    container.id = 'fe-sticky-scopes';
    container.className = 'fe-sticky-scopes';
    drawerBodyEl.appendChild(container);
  }

  // Cleanup from earlier iterations that used a single UL list container.
  container.querySelector('ul.fe-sticky-scopes-list')?.remove();

  let rafId: number | null = null;
  let disposed = false;
  let lastKey = '';
  let stickySlots: HTMLUListElement[] = [];
  let stickyUnderlays: HTMLDivElement[] = [];
  let stickyRows: HTMLLIElement[] = [];
  let stickySourceGroups: HTMLLIElement[][] = [];
  let rowStepPx = 0;
  let lastBottomTranslateY = 0;
  let lastScrollTop = 0;
  let scrollDirection: 'down' | 'up' = 'down';
  let pendingKey = '';
  let pendingKeyFrames = 0;
  let stabilityResampleBudget = 0;

  // Extra early capture rows. For the explorer we want the scope to "dock"
  // exactly as it reaches the sticky stack, so keep this at 0.
  const EARLY_ROWS = 0;
  // When scrolling up, release scopes slightly earlier to avoid "sticking"
  // for too long. (-1 row == release one row sooner).
  const UP_RELEASE_ROWS = 1;
  // Fine-tune (px) to make capture/push align visually.
  // Negative values move the capture trigger *later* (requires more scrolling).
  const CAPTURE_Y_ADJUST_PX = -12;
  // Positive values start the push-up sooner (and delay pull-down when scrolling up).
  const PUSH_TRIGGER_ADJUST_PX = 10;
  // When the next collision boundary comes from a *different* ancestor scope,
  // there is a small visual gap (card spacing) that makes push start a few px
  // late. Compensate only for those cases.
  const CROSS_SCOPE_GAP_PX = 10;
  // Small hysteresis to prevent rapid "scope-flapping" during push transitions.
  const KEY_STABILITY_FRAMES = 2;
  function scheduleUpdate(): void {
    if (disposed) return;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      updateNow();
    });
  }

  function computeRowStep(): number {
    // Prefer measuring a "leaf" row (no child <ul>) so we don't accidentally
    // measure an expanded directory/root that contains the entire subtree.
    const candidates = treeElement.querySelectorAll<HTMLLIElement>(
      'li.fe-tree-node:not(.fe-tree-root)',
    );
    let sample: HTMLLIElement | null = null;
    for (const li of candidates) {
      const childUl = li.querySelector<HTMLUListElement>(':scope > ul.fe-tree');
      if (!childUl) {
        sample = li;
        break;
      }
    }
    if (!sample) {
      sample = treeElement.querySelector<HTMLLIElement>(
        'li.fe-tree-node[data-kind="file"]',
      );
    }
    if (!sample) return 0;
    const rect = sample.getBoundingClientRect();
    return rect.height || 0;
  }

  function computeFocusNode(offsetTopPx = 12): HTMLLIElement | null {
    const rect = treeElement.getBoundingClientRect();
    if (!isElementVisibleRect(rect)) return null;

    // Use a point closer to the center so we don't hit a left gutter,
    // especially when deeply-indented directories are visible.
    const x = Math.min(
      rect.right - 12,
      rect.left + Math.min(160, rect.width * 0.5),
    );
    const y = Math.min(rect.bottom - 12, rect.top + Math.max(12, offsetTopPx));
    const els = document.elementsFromPoint
      ? document.elementsFromPoint(x, y)
      : [];
    for (const el of els) {
      const li = findClosestTreeNode(treeElement, el);
      if (li) return li;
    }
    return findClosestTreeNode(treeElement, document.elementFromPoint(x, y));
  }

  function computeStickyChainWithOffset(): HTMLLIElement[] {
    const rootLi = treeElement.querySelector<HTMLLIElement>(
      'li.fe-tree-node.fe-tree-root',
    );
    if (!rootLi) return [];

    // Start from previous chain length so we converge quickly.
    let assumedCount = Math.max(1, stickySourceGroups.length || 1);
    let chain: HTMLLIElement[] = [];
    let lastIterKey = '';
    const viewportHeight = treeElement.getBoundingClientRect().height;

    for (let i = 0; i < 5; i++) {
      const dirAdj = scrollDirection === 'up' ? -UP_RELEASE_ROWS : 0;
      const offsetRows = Math.max(0, assumedCount + EARLY_ROWS + dirAdj);
      const offsetPx =
        PADDING_TOP +
        12 +
        offsetRows * rowStepPx +
        CAPTURE_Y_ADJUST_PX +
        lastBottomTranslateY;
      const focusLi = computeFocusNode(offsetPx);
      chain = getDirectoryChainFromNode(focusLi);
      if (!chain.length) chain = [rootLi];
      const key = chain.map((li) => li.dataset.rel || '').join('|');
      if (key && key === lastIterKey) break;
      lastIterKey = key;
      assumedCount = Math.max(
        1,
        computeStickyScopeSlotLimit(viewportHeight, rowStepPx, chain.length),
      );
    }

    // Root is always slot 0.
    if (chain[0] !== rootLi) {
      // Ensure we don't duplicate root if already present.
      chain = [rootLi, ...chain.filter((li) => li !== rootLi)];
    }
    return chain;
  }

  function ensureSlotCount(count: number): void {
    while (stickySlots.length < count) {
      const underlay = document.createElement('div');
      underlay.className = 'fe-sticky-scope-underlay';
      container!.appendChild(underlay);
      stickyUnderlays.push(underlay);

      const slot = document.createElement('ul');
      slot.className = 'fe-tree fe-sticky-scope-slot';
      const li = document.createElement('li');
      li.className = 'fe-tree-node fe-sticky-scope';
      slot.appendChild(li);
      container!.appendChild(slot);
      stickySlots.push(slot);
      stickyRows.push(li);
    }
    while (stickySlots.length > count) {
      const slot = stickySlots.pop();
      slot?.remove();
      stickyRows.pop();

      const underlay = stickyUnderlays.pop();
      underlay?.remove();
    }
  }

  function scrollScopeToHead(srcLi: HTMLLIElement): void {
    const treeRect = treeElement.getBoundingClientRect();
    const srcRect = srcLi.getBoundingClientRect();
    if (!isElementVisibleRect(treeRect) || !isElementVisibleRect(srcRect)) {
      return;
    }

    const stickyHeight = PADDING_TOP + stickySourceGroups.length * rowStepPx;
    const delta = srcRect.top - (treeRect.top + stickyHeight);
    const maxScroll = Math.max(
      0,
      treeElement.scrollHeight - treeElement.clientHeight,
    );
    treeElement.scrollTop = Math.min(
      maxScroll,
      Math.max(0, treeElement.scrollTop + delta),
    );
    scheduleUpdate();
  }

  function appendDiagnosticMarker(containerEl: HTMLElement): void {
    const diagnostic = document.createElement('span');
    diagnostic.className = 'fe-diag-mark';
    diagnostic.setAttribute('aria-hidden', 'true');
    containerEl.appendChild(diagnostic);
  }

  function renderStickyRowContent(
    group: HTMLLIElement[],
    rowEl: HTMLLIElement,
  ): void {
    const menuSource = group[group.length - 1];
    if (!menuSource) return;

    rowEl.replaceChildren();

    const icon = document.createElement('span');
    icon.className = 'fe-entry-icon fe-entry-icon-dir';

    const text = document.createElement('span');
    text.className = 'fe-tree-text';
    if (group.length === 1) {
      renderExplorerTreeLabel(text, getCanonicalTreeNodeName(menuSource));
    } else {
      text.classList.add('fe-sticky-scope-path');
      group.forEach((source, index) => {
        if (index > 0) {
          const separator = document.createElement('span');
          separator.className = 'fe-sticky-scope-separator';
          separator.textContent = '/';
          text.appendChild(separator);
        }

        const segment = document.createElement('button');
        segment.type = 'button';
        segment.className = 'fe-sticky-scope-segment';
        segment.dataset.rel = source.dataset.rel || '';
        segment.textContent = getCanonicalTreeNodeName(source);
        segment.setAttribute(
          'aria-label',
          `Navigate to ${getCanonicalTreeNodeName(source)}`,
        );
        segment.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          scrollScopeToHead(source);
        });
        text.appendChild(segment);
      });
      appendDiagnosticMarker(text);
    }

    const menuBtn = document.createElement('button');
    menuBtn.className = 'fe-card-menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openCardMenuForEntry === 'function') {
        openCardMenuForEntry(buildEntryFromLi(menuSource), menuBtn);
      }
    });

    rowEl.append(icon, text, menuBtn);
  }

  function fillRowFromSources(
    group: HTMLLIElement[],
    depth: number,
    rebuild = true,
  ): void {
    const srcLi = group[0];
    const menuSource = group[group.length - 1];
    const rel = menuSource?.dataset.rel || '';
    if (!srcLi || !menuSource) return;
    if (!rel) return;
    const underlayEl = stickyUnderlays[depth];
    const slotEl = stickySlots[depth];
    const rowEl = stickyRows[depth];
    if (!slotEl || !rowEl || !underlayEl) return;

    // Match the source node's horizontal geometry (indent + width) so
    // sticky rows line up with their real DOM counterparts.
    const bodyRect = drawerBodyEl.getBoundingClientRect();
    const srcRect = srcLi.getBoundingClientRect();
    if (isElementVisibleRect(bodyRect) && isElementVisibleRect(srcRect)) {
      const left = srcRect.left - bodyRect.left;
      const right = bodyRect.right - srcRect.right;
      let leftPx = Math.max(0, left);
      let rightPx = Math.max(0, right);
      // Deeply indented scopes can accumulate a 1px rounding drift vs the
      // underlying tree cards. Nudge slot+underlay left for slot 5+ so the
      // underlay properly masks the scrolling content behind rounded corners.
      if (depth >= 4) {
        leftPx = Math.max(0, leftPx - 0.5);
        rightPx = Math.max(0, rightPx - 0.4);
      }
      slotEl.style.left = `${leftPx}px`;
      slotEl.style.right = `${rightPx}px`;
      underlayEl.style.left = `${leftPx}px`;
      underlayEl.style.right = `${rightPx}px`;
    } else {
      slotEl.style.left = '0px';
      slotEl.style.right = '0px';
      underlayEl.style.left = '0px';
      underlayEl.style.right = '0px';
    }

    slotEl.style.top = `${PADDING_TOP + depth * rowStepPx}px`;
    slotEl.style.height = `${rowStepPx}px`;
    const slotZ = 1000 - depth;
    slotEl.style.zIndex = `${slotZ}`;

    // Solid underlay behind the row area (per-scope width).
    underlayEl.style.top = '0px';
    underlayEl.style.zIndex = `${slotZ - 1}`;

    // Ensure slots stay transparent; the underlay provides the "container"
    // background behind rounded corners.
    slotEl.style.backgroundColor = '';
    slotEl.style.backgroundImage = '';

    // Underlay background should match the *parent* scope's background so
    // nested sticky cards reveal the same color as the real nested tree.
    const parentLi = depth > 0 ? stickySourceGroups[depth - 1]?.[0] : null;
    try {
      if (parentLi) {
        const cs = window.getComputedStyle(parentLi);
        underlayEl.style.backgroundColor = cs.backgroundColor || '';
        underlayEl.style.backgroundImage = cs.backgroundImage || '';
      } else {
        underlayEl.style.backgroundColor = '';
        underlayEl.style.backgroundImage = '';
      }
    } catch {
      underlayEl.style.backgroundColor = '';
      underlayEl.style.backgroundImage = '';
    }

    copyExplorerVisualClasses(menuSource, rowEl);
    rowEl.dataset.kind = 'dir';
    rowEl.dataset.rel = rel;
    rowEl.dataset.name = getCanonicalTreeNodeName(menuSource);
    rowEl.dataset.open = menuSource.dataset.open || 'true';
    if (menuSource.dataset.treeDepth) {
      rowEl.dataset.treeDepth = menuSource.dataset.treeDepth;
    } else {
      delete rowEl.dataset.treeDepth;
    }
    if (menuSource.dataset.depthParity) {
      rowEl.dataset.depthParity = menuSource.dataset.depthParity;
    } else {
      delete rowEl.dataset.depthParity;
    }
    if (menuSource.dataset.gitStatus) {
      rowEl.dataset.gitStatus = menuSource.dataset.gitStatus;
    } else {
      delete rowEl.dataset.gitStatus;
    }
    if (menuSource.dataset.gitFlags) {
      rowEl.dataset.gitFlags = menuSource.dataset.gitFlags;
    } else {
      delete rowEl.dataset.gitFlags;
    }
    if (menuSource.dataset.hasDraft) {
      rowEl.dataset.hasDraft = menuSource.dataset.hasDraft;
    } else {
      delete rowEl.dataset.hasDraft;
    }

    // Let CSS control padding; indentation comes from the slot geometry above.
    rowEl.style.paddingLeft = '';

    const contentKey = group
      .map(
        (source) =>
          `${source.dataset.rel || ''}\u0000${getCanonicalTreeNodeName(source)}`,
      )
      .join('\u0001');
    if (rebuild || rowEl.dataset.stickyContentKey !== contentKey) {
      rowEl.dataset.stickyContentKey = contentKey;
      renderStickyRowContent(group, rowEl);
    }
  }

  function renderChain(groups: HTMLLIElement[][]): void {
    stickySourceGroups = groups.map((group) => group.slice());
    ensureSlotCount(groups.length);
    groups.forEach((group, depth) => {
      fillRowFromSources(group, depth, true);
    });
  }

  function applyPushTransforms(): void {
    if (!stickySlots.length || !stickySourceGroups.length) return;
    const containerRect = container!.getBoundingClientRect();
    if (!isElementVisibleRect(containerRect)) return;
    const listTop = containerRect.top + PADDING_TOP;

    let cumulativePush = 0;
    let bottomTranslateY = 0;
    for (let depth = 0; depth < stickySourceGroups.length; depth++) {
      const underlayEl = stickyUnderlays[depth];
      const slotEl = stickySlots[depth];
      const srcLi = stickySourceGroups[depth]?.[0];
      if (!slotEl || !srcLi || !underlayEl) continue;

      const isBottomSlot = depth === stickySourceGroups.length - 1;
      slotEl.classList.toggle('fe-sticky-scope-slot-bottom', isBottomSlot);
      // Slight overlap to hide 1px seams between the docked overlay and the
      // scrolling tree border outline.
      slotEl.style.height = `${rowStepPx + (isBottomSlot ? 1 : 0)}px`;
      const rowEl = stickyRows[depth];
      if (rowEl) rowEl.style.height = isBottomSlot ? '100%' : '';

      let push = 0;
      const nextInfo = findNextTreeNodeAfterSubtree(srcLi);
      if (nextInfo?.node) {
        const nextRect = nextInfo.node.getBoundingClientRect();
        const anchorY =
          listTop +
          (depth + 1) * rowStepPx +
          cumulativePush +
          PUSH_TRIGGER_ADJUST_PX;
        const boundaryTop =
          nextRect.top - (nextInfo.climbed > 0 ? CROSS_SCOPE_GAP_PX : 0);
        const overlap = boundaryTop - anchorY;
        if (overlap < 0) {
          push = Math.max(overlap, -rowStepPx);
        }
      }

      const translateY = cumulativePush + push;
      slotEl.style.transform = `translateY(${translateY}px)`;
      if (depth === stickySourceGroups.length - 1) {
        bottomTranslateY = translateY;
      }

      // Per-scope background underlay: anchored at the top of the sticky region,
      // with its "bottom edge" landing around halfway down this scope row.
      // This hides noisy content behind the indented sides while preserving
      // the stepped/nested geometry.
      const underlayHeight = Math.max(
        0,
        PADDING_TOP + depth * rowStepPx + translateY + rowStepPx * 0.5,
      );
      underlayEl.style.height = `${underlayHeight}px`;
      underlayEl.style.transform = 'none';

      cumulativePush += push;
    }

    // Keep the focus probe aligned with the *visual* bottom of the sticky stack,
    // otherwise the chain can oscillate during push-up transitions (flicker).
    lastBottomTranslateY = bottomTranslateY;
  }

  function updateNow(): void {
    if (disposed) return;

    // Hide when drawer is closed / not measurable.
    const treeRect = treeElement.getBoundingClientRect();
    if (!isElementVisibleRect(treeRect)) {
      container!.style.display = 'none';
      return;
    }

    container!.style.display = 'block';

    const step = computeRowStep();
    if (!step) {
      container!.style.height = '0px';
      ensureSlotCount(0);
      stickySourceGroups = [];
      return;
    }
    rowStepPx = step;

    const rawChain = computeStickyChainWithOffset();
    const rawKey = rawChain.map((li) => li.dataset.rel || '').join('|');

    // Avoid rapid key oscillation when we are exactly on a geometric threshold
    // (common during push-up/pull-down transitions).
    let chain = rawChain;
    let key = rawKey;
    let needsStabilityResample = false;
    if (rawKey && lastKey && rawKey !== lastKey && stickySourceGroups.length) {
      if (rawKey === pendingKey) {
        pendingKeyFrames += 1;
      } else {
        pendingKey = rawKey;
        pendingKeyFrames = 1;
      }

      if (pendingKeyFrames < KEY_STABILITY_FRAMES) {
        chain = stickySourceGroups.flat();
        key = lastKey;
        needsStabilityResample = true;
        stabilityResampleBudget = Math.max(
          stabilityResampleBudget,
          KEY_STABILITY_FRAMES - pendingKeyFrames,
        );
      } else {
        pendingKey = '';
        pendingKeyFrames = 0;
        stabilityResampleBudget = 0;
      }
    } else {
      pendingKey = '';
      pendingKeyFrames = 0;
      stabilityResampleBudget = 0;
    }

    if (!key || chain.length === 0) {
      lastKey = '';
      container!.style.height = '0px';
      ensureSlotCount(0);
      stickySourceGroups = [];
      lastBottomTranslateY = 0;
      return;
    }

    const slotLimit = computeStickyScopeSlotLimit(
      treeRect.height,
      rowStepPx,
      chain.length,
    );
    const groups = constrainStickyScopeChain(chain, slotLimit);
    if (!groups.length) {
      container!.style.height = '0px';
      ensureSlotCount(0);
      stickySourceGroups = [];
      lastBottomTranslateY = 0;
      return;
    }

    // Set fixed geometry first; render can rely on rowStepPx.
    const contentHeight = groups.length * rowStepPx;
    container!.style.height = `${PADDING_TOP + contentHeight + BOTTOM_SHADOW_PAD_PX}px`;

    const sameIdentityChain =
      key === lastKey &&
      groups.length === stickySourceGroups.length &&
      groups.every(
        (group, groupIndex) =>
          group.length === stickySourceGroups[groupIndex]?.length &&
          group.every(
            (source, sourceIndex) =>
              source === stickySourceGroups[groupIndex]?.[sourceIndex],
          ),
      );

    if (!sameIdentityChain) {
      lastKey = key;
      renderChain(groups);
    } else {
      // Keep geometry, labels, and visual classes fresh without cloning source DOM.
      groups.forEach((group, depth) => {
        fillRowFromSources(group, depth, false);
      });
    }

    applyPushTransforms();

    // If we held the old chain for stability, ensure we sample again on the next
    // animation frame so the overlay can converge without requiring user scroll.
    if (needsStabilityResample && stabilityResampleBudget > 0) {
      stabilityResampleBudget -= 1;
      scheduleUpdate();
    }
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(treeElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'class',
      'data-open',
      'data-kind',
      'data-rel',
      'data-name',
      'data-tree-depth',
      'data-depth-parity',
      'data-git-status',
      'data-git-flags',
      'data-has-draft',
    ],
  });
  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleUpdate)
      : null;
  resizeObserver?.observe(treeElement);

  lastScrollTop = treeElement.scrollTop || 0;
  function onScroll(): void {
    const nextTop = treeElement.scrollTop || 0;
    if (nextTop < lastScrollTop) {
      scrollDirection = 'up';
    } else if (nextTop > lastScrollTop) {
      scrollDirection = 'down';
    }
    lastScrollTop = nextTop;
    scheduleUpdate();
  }

  treeElement.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  scheduleUpdate();

  return {
    update: scheduleUpdate,
    destroy(): void {
      disposed = true;
      observer.disconnect();
      resizeObserver?.disconnect();
      treeElement.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', scheduleUpdate);
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      container.remove();
    },
  };
}
