// app/apps/file_editor_cm6/static/js/explorer_extensions/sticky_scopes.js
//
// "Sticky scopes" for the explorer tree (Monaco-ish).
// - Shows the directory ancestry of the first visible node.
// - Uses geometry (DOM rects) for push-up/pull-down animation between sibling scopes.
// - Sticky rows are non-interactive except for the ⋮ menu button.

function isElementVisibleRect(rect) {
  return !!(rect && rect.width > 0 && rect.height > 0);
}

function findClosestTreeNode(treeElement, el) {
  if (!el || !el.closest) return null;
  const li = el.closest('li.fe-tree-node');
  if (!li) return null;
  if (!treeElement || !treeElement.contains(li)) return null;
  return li;
}

function getDirectoryChainFromNode(li) {
  if (!li) return [];
  let cursor = li;
  if (cursor.dataset.kind !== 'dir') {
    cursor = cursor.parentElement?.closest('li.fe-tree-node[data-kind="dir"]');
  } else if (cursor.dataset.open !== 'true') {
    // Closed directories shouldn't become scopes just because they're visible.
    cursor = cursor.parentElement?.closest('li.fe-tree-node[data-kind="dir"]');
  }
  const chain = [];
  while (cursor) {
    const rel = cursor.dataset.rel || '';
    const isRoot = rel === '.';
    const isOpen = cursor.dataset.open === 'true';
    if (isRoot || isOpen) {
      chain.push(cursor);
    }
    cursor = cursor.parentElement?.closest('li.fe-tree-node[data-kind="dir"]');
  }
  chain.reverse();
  return chain;
}

function findNextSiblingDirectory(li) {
  if (!li) return null;
  let sib = li.nextElementSibling;
  while (sib) {
    if (
      sib.matches &&
      sib.matches('li.fe-tree-node[data-kind="dir"]')
    ) {
      return sib;
    }
    sib = sib.nextElementSibling;
  }
  return null;
}

function buildEntryFromLi(li) {
  return {
    rel: li?.dataset?.rel || '',
    name:
      li?.dataset?.name ||
      li?.querySelector('.fe-tree-text')?.textContent ||
      '',
    kind: li?.dataset?.kind || 'dir',
    gitStatus: li?.dataset?.gitStatus || '',
  };
}

function copyExplorerVisualClasses(srcLi, destLi) {
  if (!srcLi || !destLi) return;
  // Keep only the classes that affect visuals (git/draft + root).
  destLi.className = 'fe-tree-node fe-sticky-scope';
  srcLi.classList.forEach((cls) => {
    if (cls === 'fe-tree-root') destLi.classList.add(cls);
    if (cls === 'fe-draft') destLi.classList.add(cls);
    if (cls.startsWith('fe-git-')) destLi.classList.add(cls);
    if (cls.startsWith('fe-dir-has-')) destLi.classList.add(cls);
  });
}

export function initExplorerStickyScopes({
  treeElement,
  drawerBodyEl,
  openCardMenuForEntry,
}) {
  if (!treeElement || !drawerBodyEl) return null;

  let container = drawerBodyEl.querySelector('#fe-sticky-scopes');
  if (!container) {
    container = document.createElement('div');
    container.id = 'fe-sticky-scopes';
    container.className = 'fe-sticky-scopes';
    drawerBodyEl.appendChild(container);
  }

  // Cleanup from earlier iterations that used a single UL list container.
  container.querySelector('ul.fe-sticky-scopes-list')?.remove();

  let rafId = null;
  let disposed = false;
  let lastKey = '';
  let stickySlots = [];
  let stickyUnderlays = [];
  let stickyRows = [];
  let stickySourceLis = [];
  let rowStepPx = 0;
  let lastScrollTop = 0;
  let scrollDirection = 'down'; // 'down' | 'up'

  // Mirrors `.fe-tree` padding: 8px 12px 8px 7px
  const PADDING_TOP = 8;
  // Extra early capture rows. For the explorer we want the scope to "dock"
  // exactly as it reaches the sticky stack, so keep this at 0.
  const EARLY_ROWS = 0;
  // When scrolling up, release scopes slightly earlier to avoid "sticking"
  // for too long. (-1 row == release one row sooner).
  const UP_RELEASE_ROWS = 1;
  // Fine-tune (px) to make capture/push align visually.
  // Negative values move the capture trigger *later* (requires more scrolling).
  const CAPTURE_Y_ADJUST_PX = -5;
  // Positive values start the push-up sooner (and delay pull-down when scrolling up).
  const PUSH_TRIGGER_ADJUST_PX = 5;

  function scheduleUpdate() {
    if (disposed) return;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      updateNow();
    });
  }

  function computeRowStep() {
    // Prefer measuring a "leaf" row (no child <ul>) so we don't accidentally
    // measure an expanded directory/root that contains the entire subtree.
    const candidates = treeElement.querySelectorAll(
      'li.fe-tree-node:not(.fe-tree-root)',
    );
    let sample = null;
    for (const li of candidates) {
      const childUl = li.querySelector(':scope > ul.fe-tree');
      if (!childUl) {
        sample = li;
        break;
      }
    }
    if (!sample) {
      sample = treeElement.querySelector(
        'li.fe-tree-node[data-kind="file"]',
      );
    }
    if (!sample) return 0;
    const rect = sample.getBoundingClientRect();
    return Math.round(rect.height || 0);
  }

  function computeFocusNode(offsetTopPx = 12) {
    const rect = treeElement.getBoundingClientRect();
    if (!isElementVisibleRect(rect)) return null;

    // Use a point closer to the center so we don't hit a left gutter,
    // especially when deeply-indented directories are visible.
    const x = Math.min(
      rect.right - 12,
      rect.left + Math.min(160, rect.width * 0.5),
    );
    const y = Math.min(rect.bottom - 12, rect.top + Math.max(12, offsetTopPx));
    const els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
    for (const el of els) {
      const li = findClosestTreeNode(treeElement, el);
      if (li) return li;
    }
    return findClosestTreeNode(treeElement, document.elementFromPoint(x, y));
  }

  function computeStickyChainWithOffset() {
    const rootLi = treeElement.querySelector('li.fe-tree-node.fe-tree-root');
    if (!rootLi) return [];

    // Start from previous chain length so we converge quickly.
    let assumedCount = Math.max(1, stickySourceLis.length || 1);
    let chain = [];
    let lastIterKey = '';

    for (let i = 0; i < 5; i++) {
      const dirAdj = scrollDirection === 'up' ? -UP_RELEASE_ROWS : 0;
      const offsetRows = Math.max(0, assumedCount + EARLY_ROWS + dirAdj);
      const offsetPx =
        PADDING_TOP + 12 + offsetRows * rowStepPx + CAPTURE_Y_ADJUST_PX;
      const focusLi = computeFocusNode(offsetPx);
      chain = getDirectoryChainFromNode(focusLi);
      if (!chain.length) chain = [rootLi];
      const key = chain.map((li) => li.dataset.rel || '').join('|');
      if (key && key === lastIterKey) break;
      lastIterKey = key;
      assumedCount = Math.max(1, chain.length);
    }

    // Root is always slot 0.
    if (chain[0] !== rootLi) {
      // Ensure we don't duplicate root if already present.
      chain = [rootLi, ...chain.filter((li) => li !== rootLi)];
    }
    return chain;
  }

  function ensureSlotCount(count) {
    while (stickySlots.length < count) {
      const underlay = document.createElement('div');
      underlay.className = 'fe-sticky-scope-underlay';
      container.appendChild(underlay);
      stickyUnderlays.push(underlay);

      const slot = document.createElement('ul');
      slot.className = 'fe-tree fe-sticky-scope-slot';
      const li = document.createElement('li');
      li.className = 'fe-tree-node fe-sticky-scope';
      slot.appendChild(li);
      container.appendChild(slot);
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

  function fillRowFromSource(srcLi, depth, rebuild = true) {
    const rel = srcLi?.dataset?.rel || '';
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
      const left = Math.round(srcRect.left - bodyRect.left);
      const right = Math.round(bodyRect.right - srcRect.right);
      const leftPx = Math.max(0, left);
      const rightPx = Math.max(0, right);
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

    copyExplorerVisualClasses(srcLi, rowEl);
    rowEl.dataset.kind = 'dir';
    rowEl.dataset.rel = rel;
    rowEl.dataset.name =
      srcLi.dataset.name ||
      srcLi.querySelector('.fe-tree-text')?.textContent ||
      '';
    if (srcLi.dataset.gitStatus) {
      rowEl.dataset.gitStatus = srcLi.dataset.gitStatus;
    } else {
      delete rowEl.dataset.gitStatus;
    }
    if (srcLi.dataset.gitFlags) {
      rowEl.dataset.gitFlags = srcLi.dataset.gitFlags;
    } else {
      delete rowEl.dataset.gitFlags;
    }
    if (srcLi.dataset.hasDraft) {
      rowEl.dataset.hasDraft = srcLi.dataset.hasDraft;
    } else {
      delete rowEl.dataset.hasDraft;
    }

    // Let CSS control padding; indentation comes from the slot geometry above.
    rowEl.style.paddingLeft = '';

    if (!rebuild) return;

    rowEl.innerHTML = '';

    const icon = document.createElement('span');
    icon.className = 'fe-entry-icon fe-entry-icon-dir';

    const text = document.createElement('span');
    text.className = 'fe-tree-text';
    text.textContent =
      srcLi.querySelector('.fe-tree-text')?.textContent ||
      srcLi.dataset.name ||
      '';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'fe-card-menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof openCardMenuForEntry === 'function') {
        openCardMenuForEntry(buildEntryFromLi(srcLi), menuBtn);
      }
    });

    rowEl.appendChild(icon);
    rowEl.appendChild(text);
    rowEl.appendChild(menuBtn);
  }

  function renderChain(chain) {
    stickySourceLis = chain.slice();
    ensureSlotCount(chain.length);
    chain.forEach((srcLi, depth) => {
      fillRowFromSource(srcLi, depth, true);
    });
  }

  function applyPushTransforms() {
    if (!stickySlots.length || !stickySourceLis.length) return;
    const containerRect = container.getBoundingClientRect();
    if (!isElementVisibleRect(containerRect)) return;
    const listTop = containerRect.top + PADDING_TOP;

    let cumulativePush = 0;
    for (let depth = 0; depth < stickySourceLis.length; depth++) {
      const underlayEl = stickyUnderlays[depth];
      const slotEl = stickySlots[depth];
      const srcLi = stickySourceLis[depth];
      if (!slotEl || !srcLi || !underlayEl) continue;

      let push = 0;
      const nextDir = findNextSiblingDirectory(srcLi);
      if (nextDir) {
        const nextRect = nextDir.getBoundingClientRect();
        const anchorY =
          listTop +
          (depth + 1) * rowStepPx +
          cumulativePush +
          PUSH_TRIGGER_ADJUST_PX;
        const overlap = nextRect.top - anchorY;
        if (overlap < 0) {
          push = Math.max(overlap, -rowStepPx);
        }
      }

      const translateY = cumulativePush + push;
      slotEl.style.transform = `translateY(${translateY}px)`;

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
  }

  function updateNow() {
    if (disposed) return;

    // Hide when drawer is closed / not measurable.
    const treeRect = treeElement.getBoundingClientRect();
    if (!isElementVisibleRect(treeRect)) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    const step = computeRowStep();
    if (!step) {
      container.style.height = '0px';
      ensureSlotCount(0);
      stickySourceLis = [];
      return;
    }
    rowStepPx = step;

    const chain = computeStickyChainWithOffset();
    const key = chain.map((li) => li.dataset.rel || '').join('|');

    if (!key || chain.length === 0) {
      lastKey = '';
      container.style.height = '0px';
      ensureSlotCount(0);
      stickySourceLis = [];
      return;
    }

    // Set fixed geometry first; render can rely on rowStepPx.
    const contentHeight = chain.length * rowStepPx;
    container.style.height = `${PADDING_TOP + contentHeight}px`;

    const sameIdentityChain =
      key === lastKey &&
      chain.length === stickySourceLis.length &&
      chain.every((li, idx) => li === stickySourceLis[idx]);

    if (!sameIdentityChain) {
      lastKey = key;
      renderChain(chain);
    } else {
      // Keep menu positioning / labels fresh (git classes can change).
      chain.forEach((srcLi, depth) => {
        fillRowFromSource(srcLi, depth, false);
        const rowEl = stickyRows[depth];
        const text = rowEl?.querySelector('.fe-tree-text');
        const srcText = srcLi.querySelector('.fe-tree-text')?.textContent || '';
        if (text && srcText) text.textContent = srcText;
      });
    }

    applyPushTransforms();
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
      'data-git-status',
      'data-git-flags',
      'data-has-draft',
    ],
  });

  lastScrollTop = treeElement.scrollTop || 0;
  function onScroll() {
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
    destroy() {
      disposed = true;
      observer.disconnect();
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
