/**
 * Explorer Diagnostics tab — thin wrapper around the shared createProblemsPanel.
 * Renders inside the search overlay results container, visually identical to
 * the bottom-drawer Problems panel.
 *
 * The panel instance is kept alive so that diff-aware updates work without
 * thrashing the DOM. On first call the container is created; subsequent calls
 * reuse the existing panel and call panel.update().
 */

import { createProblemsPanel } from '../problems.js';

const CONTAINER_ID = 'explorer-diagnostics-container';

let _panel = null;             // singleton panel instance
let _panelContainer = null;    // the results container the panel lives in

/**
 * Ensure the panel is mounted inside `resultsContainer`. If the container
 * changed (e.g. overlay was recreated) or the inner div was orphaned (user
 * switched to another tab and back — that tab's render cleared the container),
 * re-mount the panel.
 */
function _ensurePanel(resultsContainer, callbacks) {
  if (_panel && _panelContainer === resultsContainer) {
    // Check that the inner container div is still in the DOM
    const existingInner = resultsContainer.querySelector('#' + CONTAINER_ID);
    if (existingInner) return _panel;

    // Inner div was orphaned — destroy old panel and recreate below
    _panel.destroy();
    _panel = null;
    _panelContainer = null;
  }

  // Clear any leftover children from other search modes
  resultsContainer.innerHTML = '';
  resultsContainer.classList.add('fe-search-diagnostics-container');

  const inner = document.createElement('div');
  inner.id = CONTAINER_ID;
  resultsContainer.appendChild(inner);

  const proj = callbacks.getProjectPath() || '';

  _panel = createProblemsPanel({
    containerId: CONTAINER_ID,
    onNavigate: (absPath, line, col) => {
      const rel = proj && absPath.startsWith(proj + '/')
        ? absPath.slice(proj.length + 1) : absPath;
      callbacks.openFileAndMaybeJump(rel, line || 1, { column: col || 1 });
    },
    onMention: async (payload) => {
      try {
        const hostBase = typeof window.__agentHostBase === 'string'
          ? window.__agentHostBase.trim() : '';
        if (!hostBase) { callbacks.toast('Agent host unavailable'); return; }
        const resp = await fetch(`${hostBase}/api/appserver/mention`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await resp.json();
        if (result && result.ok) callbacks.toast('Mentioned in conversation');
        else callbacks.toast(result?.error || 'Failed to mention');
      } catch (err) {
        console.warn('[ExplorerDiagnostics] mention failed:', err);
        callbacks.toast('Failed to mention in conversation');
      }
    },
  });

  _panelContainer = resultsContainer;
  return _panel;
}

/**
 * Render (or update) the diagnostics tab content.
 *
 * @param {HTMLElement} resultsContainer - the search overlay results area
 * @param {Object} detail - { absPath: markers[] } snapshot from diagnostics:detail
 * @param {Object} callbacks
 * @param {function(string, number?, Object?):Promise<void>} callbacks.openFileAndMaybeJump
 * @param {function(string):void} callbacks.toast
 * @param {function():string}     callbacks.getProjectPath
 * @param {string} [callbacks.activeFileAbs] - absolute path of the currently open file
 */
export function renderExplorerDiagnostics(resultsContainer, detail, callbacks) {
  const panel = _ensurePanel(resultsContainer, callbacks);
  if (callbacks.activeFileAbs) {
    panel.setActiveFile(callbacks.activeFileAbs);
  }
  panel.update(detail || {});
}

/** Return the live panel instance (for getSummary / getDetail). */
export function getExplorerDiagnosticsPanel() {
  return _panel;
}
