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
  }
  const chain = [];
  while (cursor) {
    chain.push(cursor);
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

  let listEl = container.querySelector('ul.fe-sticky-scopes-list');
  if (!listEl) {
    listEl = document.createElement('ul');
    listEl.className = 'fe-tree fe-sticky-scopes-list';
    container.appendChild(listEl);
  }

  let rafId = null;
  let disposed = false;
  let lastKey = '';
  let stickyRows = [];
  let stickySourceLis = [];
  let rowStepPx = 0;

  const PADDING_TOP = 8; // mirrors .fe-tree padding-top
  const INDENT_PER_DEPTH = 12;
  const BASE_PADDING_LEFT = 10;

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

  function computeFocusNode() {
    const rect = treeElement.getBoundingClientRect();
    if (!isElementVisibleRect(rect)) return null;

    // Use a point closer to the center so we don't hit a left gutter,
    // especially when deeply-indented directories are visible.
    const x = Math.min(
      rect.right - 12,
      rect.left + Math.min(160, rect.width * 0.5),
    );
    const y = rect.top + 12;
    const els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
    for (const el of els) {
      const li = findClosestTreeNode(treeElement, el);
      if (li) return li;
    }
    return findClosestTreeNode(treeElement, document.elementFromPoint(x, y));
  }

  function renderChain(chain) {
    listEl.innerHTML = '';
    stickyRows = [];
    stickySourceLis = chain.slice();

    chain.forEach((srcLi, depth) => {
      const rel = srcLi.dataset.rel || '';
      if (!rel) return;

      const li = document.createElement('li');
      copyExplorerVisualClasses(srcLi, li);
      li.dataset.kind = 'dir';
      li.dataset.rel = rel;
      li.dataset.name =
        srcLi.dataset.name ||
        srcLi.querySelector('.fe-tree-text')?.textContent ||
        '';
      if (srcLi.dataset.gitStatus) {
        li.dataset.gitStatus = srcLi.dataset.gitStatus;
      }
      if (srcLi.dataset.gitFlags) {
        li.dataset.gitFlags = srcLi.dataset.gitFlags;
      }
      if (srcLi.dataset.hasDraft) {
        li.dataset.hasDraft = srcLi.dataset.hasDraft;
      }

      li.style.position = 'absolute';
      li.style.left = '0';
      li.style.right = '0';
      li.style.top = `${depth * rowStepPx}px`;
      li.style.paddingLeft = `${BASE_PADDING_LEFT + depth * INDENT_PER_DEPTH}px`;

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

      li.appendChild(icon);
      li.appendChild(text);
      li.appendChild(menuBtn);
      listEl.appendChild(li);

      stickyRows.push(li);
    });
  }

  function applyPushTransforms() {
    if (!stickyRows.length || !stickySourceLis.length) return;
    const listRect = listEl.getBoundingClientRect();
    if (!isElementVisibleRect(listRect)) return;

    let cumulativePush = 0;
    for (let depth = 0; depth < stickySourceLis.length; depth++) {
      const rowEl = stickyRows[depth];
      const srcLi = stickySourceLis[depth];
      if (!rowEl || !srcLi) continue;

      let push = 0;
      const nextDir = findNextSiblingDirectory(srcLi);
      if (nextDir) {
        const nextRect = nextDir.getBoundingClientRect();
        const anchorY = listRect.top + (depth + 1) * rowStepPx + cumulativePush;
        const overlap = nextRect.top - anchorY;
        if (overlap < 0) {
          push = Math.max(overlap, -rowStepPx);
        }
      }

      rowEl.style.transform = `translateY(${cumulativePush + push}px)`;
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
      listEl.style.height = '0px';
      listEl.innerHTML = '';
      stickyRows = [];
      stickySourceLis = [];
      return;
    }
    rowStepPx = step;

    const focusLi = computeFocusNode();
    const chain = getDirectoryChainFromNode(focusLi);
    const key = chain.map((li) => li.dataset.rel || '').join('|');

    if (!key || chain.length === 0) {
      lastKey = '';
      container.style.height = '0px';
      listEl.style.height = '0px';
      listEl.innerHTML = '';
      stickyRows = [];
      stickySourceLis = [];
      return;
    }

    // Set fixed geometry first; render can rely on rowStepPx.
    const contentHeight = chain.length * rowStepPx;
    container.style.height = `${PADDING_TOP + contentHeight}px`;
    listEl.style.height = `${contentHeight}px`;

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
        const rowEl = stickyRows[depth];
        if (!rowEl) return;
        copyExplorerVisualClasses(srcLi, rowEl);
        rowEl.style.top = `${depth * rowStepPx}px`;
        rowEl.style.paddingLeft = `${BASE_PADDING_LEFT + depth * INDENT_PER_DEPTH}px`;
        const text = rowEl.querySelector('.fe-tree-text');
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

  treeElement.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  scheduleUpdate();

  return {
    update: scheduleUpdate,
    destroy() {
      disposed = true;
      observer.disconnect();
      treeElement.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      container.remove();
    },
  };
}
