 // app/apps/file_editor_cm6/static/js/diff_decorations.js

import {
  EditorView,
  StateEffect,
  StateField,
  RangeSetBuilder,
  Decoration,
  WidgetType,
} from '/static/vendor/codemirror.1/codemirror.bundle.js';

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

  class RemovedLineWidget extends WidgetType {
    constructor(text) {
      super();
      this.text = text;
    }
    toDOM() {
      const lineEl = document.createElement('div');
      lineEl.className = 'cm-diff-line-removed';
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
  let currentContext = null; // { path, sha }
  let currentDecorations = Decoration.none;
  let pendingKey = null;
  const cache = new Map(); // key -> { payload, decorations, summary }

  function bindView(view) {
    controllerView = view;
    if (enabled) {
      applyDecorations(currentDecorations, null, { silentStatus: true });
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
          RemovedLineWidget,
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

  function contextKey(ctx) {
    if (!ctx || !ctx.path) return null;
    return `${ctx.path}::${ctx.sha || 'no-sha'}`;
  }

  return {
    extension: diffField,
    bindView,
    unbindView,
    setEnabled,
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
  RemovedLineWidget,
) {
  const hunks = payload?.hunks;
  if (!hunks || hunks.length === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder();
  const doc = view.state.doc;
  for (const hunk of hunks) {
    let newLine = Math.max(1, hunk.newStart || 1);
    for (const line of hunk.lines || []) {
      const kind = line.type;
      if (kind === 'add' || kind === 'context') {
        const lineInfo = safeLine(doc, newLine);
        if (lineInfo) {
          const deco = kind === 'add' ? lineAddedDeco : lineContextDeco;
          builder.add(lineInfo.from, lineInfo.from, deco);
        }
        newLine += 1;
      } else if (kind === 'del') {
        const anchorLine = safeLine(doc, newLine > 0 ? newLine : 1);
        const pos = anchorLine ? anchorLine.from : doc.length;
        builder.add(pos, pos, Decoration.widget({
          side: -1,
          block: true,
          widget: new RemovedLineWidget(line.text || ''),
        }));
      }
    }
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
