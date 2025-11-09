 // app/apps/file_editor_cm6/static/js/diff_decorations.js

import {
  EditorView,
  StateEffect,
  StateField,
  RangeSetBuilder,
  Decoration,
  WidgetType,
} from '/static/vendor/codemirror.3/cm6.bundle.js';

/**
 * Diff decorations controller for the CM6 editor.
 *
 * Usage
 *   const controller = createDiffController({ fetchDiff, onStatus });
 *   controller.bindView(view);
 *   controller.setEnabled(true/false);
 *   controller.setContext({ path, sha });
 *   controller.refresh();
 *   some other diff test
 */

export function createDiffController(options = {}) {
  const fetchDiff = options.fetchDiff || (async () => null);
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const getWordWrap = typeof options.getWordWrap === 'function' ? options.getWordWrap : () => false;

  const setDiffEffect = StateEffect.define();
  const clearDiffEffect = StateEffect.define();

  const diffField = StateField.define({
    create() {
      return Decoration.none;
    },
    update(value, tr) {
      if (tr.docChanged && value !== Decoration.none) {
        value = value.map(tr.changes);
      }
      for (const effect of tr.effects) {
        if (effect.is(setDiffEffect)) {
          value = effect.value;
        } else if (effect.is(clearDiffEffect)) {
          value = Decoration.none;
        }
      }
      return value;
    },
    provide: field => EditorView.decorations.from(field)
  });

  const lineAddedDeco = Decoration.line({
    class: 'cm-diff-line cm-diff-line-added',
    attributes: { 'data-diff-marker': '+' },
  });

  const lineContextDeco = Decoration.line({
    class: 'cm-diff-line cm-diff-line-context',
    attributes: { 'data-diff-marker': '│' },
  });

  const linePlainDeco = Decoration.line({
    class: 'cm-diff-line cm-diff-line-plain',
  });

  class RemovedLineWidget extends WidgetType {
    constructor(text, wordWrap) {
      super();
      this.text = text;
      this.wordWrap = wordWrap;
    }
    toDOM() {
      const lineEl = document.createElement('div');
      lineEl.className = 'cm-diff-line cm-diff-line-removed';
      if (this.wordWrap) {
        lineEl.classList.add('cm-diff-wrap');
      }
      lineEl.setAttribute('data-diff-marker', '−');

      const content = document.createElement('span');
      content.className = 'cm-diff-removed-text';
      content.textContent = this.text ?? '';

      lineEl.append(content);
      return lineEl;
    }
    ignoreEvent() { return true; }
  }

  let controllerView = null;
  let enabled = false;
  let suspended = false;
  let queuedDecorations = null;
  let queuedSummary = null;
  let queuedOpts = null;
  let pendingRefresh = false;
  let currentContext = null; // { path, sha }
  let currentDecorations = Decoration.none;
  let pendingKey = null;
  const cache = new Map(); // key -> { payload, decorations, summary }

  function bindView(view) {
    controllerView = view;
    if (enabled) {
      // If decorations come from another document, discard them until we fetch fresh diffs.
      currentDecorations = Decoration.none;
      controllerView.dispatch({ effects: [clearDiffEffect.of(null)] });
      refresh(true);
    } else {
      clearDecorations();
    }
  }

  function unbindView(view) {
    if (controllerView === view) {
      controllerView = null;
    }
  }

  function setEnabled(flag) {
    const next = !!flag;
    if (next === enabled) return;
    enabled = next;
    if (!enabled) {
      applyDecorations(Decoration.none, null);
    } else {
      refresh(true);
    }
  }

  function setContext(ctx) {
    if (!ctx || !ctx.path) {
      currentContext = null;
      clearDecorations();
      return;
    }
    const normalized = {
      path: ctx.path,
      sha: ctx.sha || null,
    };
    const prevKey = contextKey(currentContext);
    currentContext = normalized;
    const newKey = contextKey(currentContext);
    if (enabled && newKey !== prevKey) {
      refresh(true);
    }
  }

  function refresh(force = false) {
    if (suspended) {
      pendingRefresh = true;
      return;
    }
    if (!enabled || !controllerView || !currentContext) {
      return;
    }
    const key = contextKey(currentContext);
    if (!key) return;

    if (!force && cache.has(key)) {
      const entry = cache.get(key);
      applyDecorations(entry.decorations, entry.summary);
      return;
    }

    pendingKey = key;
    fetchDiff(currentContext.path)
      .then((payload) => {
        if (pendingKey !== key) {
          return;
        }
        const decorations = buildDecorations(
          controllerView,
          payload,
          Decoration,
          RangeSetBuilder,
          lineAddedDeco,
          lineContextDeco,
          linePlainDeco,
          RemovedLineWidget,
          getWordWrap,
        );
        const summary = payload?.summary || null;
        cache.set(key, { payload, decorations, summary });
        applyDecorations(decorations, summary);
      })
      .catch((err) => {
        console.error('Failed to fetch diff:', err);
        if (pendingKey === key) {
          applyDecorations(Decoration.none, null);
        }
      })
      .finally(() => {
        if (pendingKey === key) {
          pendingKey = null;
        }
      });
  }

  function invalidateCacheForPath(path) {
    if (!path) return;
    const keys = Array.from(cache.keys());
    for (const key of keys) {
      if (key.startsWith(`${path}::`)) {
        cache.delete(key);
      }
    }
  }

  function applyDecorations(deco, summary, opts = {}) {
    if (suspended) {
      queuedDecorations = deco;
      queuedSummary = summary;
      queuedOpts = opts;
      return;
    }
    currentDecorations = deco || Decoration.none;
    if (controllerView) {
      const effects = [];
      if (currentDecorations === Decoration.none) {
        effects.push(clearDiffEffect.of(null));
      } else {
        effects.push(setDiffEffect.of(currentDecorations));
      }
      controllerView.dispatch({ effects });
    }
    if (!opts.silentStatus) {
      if (summary && summary.tracked !== false) {
        onStatus(summary);
      } else {
        onStatus(null);
      }
    }
  }

  function clearDecorations() {
    applyDecorations(Decoration.none, null);
  }
  
  function setSuspended(flag) {
    if (suspended === flag) return;
    suspended = flag;
    if (!suspended) {
      // Flush one coalesced apply or a forced refresh; never both
      if (queuedDecorations) {
        const d = queuedDecorations, s = queuedSummary, o = queuedOpts;
        queuedDecorations = queuedSummary = queuedOpts = null;
        applyDecorations(d, s, o);
      } else if (pendingRefresh) {
        pendingRefresh = false;
        refresh(true);
      }
    }
  }

  function contextKey(ctx) {
    if (!ctx || !ctx.path) return null;
    return `${ctx.path}::${ctx.sha || 'no-sha'}`;
  }

  return {
    extension: diffField,
    bindView,
    unbindView,
    setEnabled,
    setSuspended,
    setContext,
    refresh,
    invalidateCacheForPath,
    isEnabled: () => enabled,
    currentSummary: () => {
      if (!currentContext) return null;
      const key = contextKey(currentContext);
      const entry = cache.get(key);
      return entry?.summary || null;
    },
  };
}

function buildDecorations(
  view,
  payload,
  Decoration,
  RangeSetBuilder,
  lineAddedDeco,
  lineContextDeco,
  linePlainDeco,
  RemovedLineWidget,
  getWordWrap,
) {
  const hunks = payload?.hunks;
  if (!hunks || hunks.length === 0) {
    return Decoration.none;
  }

  const wordWrap = getWordWrap();
  const builder = new RangeSetBuilder();
  const doc = view.state.doc;
  
  // Build a map of line numbers to their diff types
  const lineDecorations = new Map();
  const deletionWidgets = [];
  
  for (const hunk of hunks) {
    let newLine = Math.max(1, hunk.newStart || 1);
    for (const line of hunk.lines || []) {
      const kind = line.type;
      if (kind === 'add' || kind === 'context') {
        const deco = kind === 'add' ? lineAddedDeco : lineContextDeco;
        lineDecorations.set(newLine, deco);
        newLine += 1;
      } else if (kind === 'del') {
        deletionWidgets.push({
          line: newLine > 0 ? newLine : 1,
          text: line.text || '',
        });
      }
    }
  }
  
  // Sort deletion widgets by line number
  deletionWidgets.sort((a, b) => a.line - b.line);
  
  // Apply decorations in sorted order (line by line)
  let widgetIndex = 0;
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const lineInfo = safeLine(doc, lineNum);
    if (!lineInfo) continue;
    
    // Add any deletion widgets that come before this line
    while (widgetIndex < deletionWidgets.length && deletionWidgets[widgetIndex].line < lineNum) {
      const widget = deletionWidgets[widgetIndex];
      const anchorLine = safeLine(doc, widget.line);
      const pos = anchorLine ? anchorLine.from : doc.length;
      builder.add(pos, pos, Decoration.widget({
        side: -1,
        block: true,
        widget: new RemovedLineWidget(widget.text, wordWrap),
      }));
      widgetIndex++;
    }
    
    // Add deletion widgets at the start of this line (before line decorations)
    while (widgetIndex < deletionWidgets.length && deletionWidgets[widgetIndex].line === lineNum) {
      const widget = deletionWidgets[widgetIndex];
      builder.add(lineInfo.from, lineInfo.from, Decoration.widget({
        side: -1,
        block: true,
        widget: new RemovedLineWidget(widget.text, wordWrap),
      }));
      widgetIndex++;
    }
    
    // Add the plain decoration (for alignment)
    builder.add(lineInfo.from, lineInfo.from, linePlainDeco);
    
    // Then add specific diff decoration if this line has one
    if (lineDecorations.has(lineNum)) {
      builder.add(lineInfo.from, lineInfo.from, lineDecorations.get(lineNum));
    }
  }
  
  // Add any remaining deletion widgets after the last line
  while (widgetIndex < deletionWidgets.length) {
    const widget = deletionWidgets[widgetIndex];
    const anchorLine = safeLine(doc, widget.line);
    const pos = anchorLine ? anchorLine.from : doc.length;
    builder.add(pos, pos, Decoration.widget({
      side: -1,
      block: true,
      widget: new RemovedLineWidget(widget.text, wordWrap),
    }));
    widgetIndex++;
  }

  return builder.finish();
}

function safeLine(doc, lineNumber) {
  if (!doc) return null;
  const total = doc.lines;
  if (total <= 0) return null;
  if (lineNumber < 1) lineNumber = 1;
  if (lineNumber > total) {
    return doc.line(total);
  }
  return doc.line(lineNumber);
}
