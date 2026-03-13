/**
 * Explorer Diagnostics tab — thin wrapper around the shared createProblemsPanel.
 * Renders inside the search overlay results container, visually identical to
 * the bottom-drawer Problems panel.
 */

import { createProblemsPanel } from '../problems.js';

const CONTAINER_ID = 'explorer-diagnostics-container';

/**
 * Render (or re-render) the diagnostics tab content.
 *
 * @param {HTMLElement} resultsContainer - the search overlay results area
 * @param {Object} detail - { absPath: markers[] } snapshot from diagnostics:detail
 * @param {Object} callbacks
 * @param {function(string, number?, Object?):Promise<void>} callbacks.openFileAndMaybeJump
 * @param {function(string):void} callbacks.toast
 * @param {function():string}     callbacks.getProjectPath
 */
export function renderExplorerDiagnostics(resultsContainer, detail, callbacks) {
  resultsContainer.innerHTML = '';
  resultsContainer.classList.add('fe-search-diagnostics-container');

  // Create a child div for the panel factory (it looks up by ID).
  const inner = document.createElement('div');
  inner.id = CONTAINER_ID;
  resultsContainer.appendChild(inner);

  const proj = callbacks.getProjectPath() || '';

  const panel = createProblemsPanel({
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

  panel.update(detail || {});
}
