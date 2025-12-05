import { EditorView } from "nicegui-codemirror";

export const STICKY_MODE = {
  N_PLUS_ONE: 'n_plus_1',
  MONACO: 'monaco',
  HYBRID: 'hybrid',
};

class ScopeCache {
  constructor() {
    this.scopes = [];
    this.version = 0;
  }

  rebuild(view, scopeTypes) {
    const state = view.state;
    const tree = EditorView.syntaxTree ? EditorView.syntaxTree(state) : null;
    this.scopes = [];

    const doc = state.doc;
    const addScope = (node, depth) => {
      const startLine = doc.lineAt(node.from).number;
      const endLine = doc.lineAt(node.to).number;
      if (endLine < startLine) return;
      this.scopes.push({
        from: node.from,
        to: node.to,
        startLine,
        endLine,
        depth,
      });
    };

    const walk = (node, depth) => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (scopeTypes.has(child.name)) {
          addScope(child, depth);
          walk(child, depth + 1);
        } else {
          walk(child, depth);
        }
      }
    };

    if (tree && tree.topNode) {
      walk(tree.topNode, 0);
    } else {
      // Fallback: regex for top-level defs/classes (Python-ish)
      for (let i = 1; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        if (/^\s*(def |class )/.test(text)) {
          this.scopes.push({ startLine: i, endLine: i, depth: 0 });
        }
      }
    }
    this.scopes.sort((a, b) => a.startLine - b.startLine || a.depth - b.depth);
    this.version++;
  }

  getScopesAtLine(line) {
    return this.scopes.filter((s) => line >= s.startLine && line <= s.endLine);
  }

  getNextSibling(scope) {
    return this.scopes.find((s) => s.depth === scope.depth && s.startLine > scope.startLine);
  }
}

function getScopeTypesForLanguage(language) {
  const SCOPE_NODE_TYPES = {
    javascript: new Set([
      "FunctionDeclaration", "FunctionExpression", "ArrowFunction",
      "MethodDeclaration", "MethodDefinition",
      "ClassDeclaration", "ClassExpression",
      "ExportDefault", "ExportDefaultDeclaration", "ExportDeclaration", "export"
    ]),
    typescript: new Set([
      "FunctionDeclaration", "FunctionExpression", "ArrowFunction",
      "MethodDeclaration", "MethodDefinition",
      "ClassDeclaration", "ClassExpression",
      "ExportDefault", "ExportDefaultDeclaration", "ExportDeclaration", "export",
      "InterfaceDeclaration", "TypeAliasDeclaration", "EnumDeclaration"
    ]),
    python: new Set([
      "FunctionDefinition", "ClassDefinition"
    ]),
    default: new Set([
      "FunctionDeclaration", "FunctionDefinition", "FunctionExpression",
      "ArrowFunction", "MethodDeclaration", "MethodDefinition",
      "ClassDeclaration", "ClassDefinition", "ClassExpression"
    ])
  };
  const lang = (language || 'default').toLowerCase();
  return SCOPE_NODE_TYPES[lang] || SCOPE_NODE_TYPES.default;
}

function computeState(view, cache, opts, prevKeys) {
  const scrollTop = view.scrollDOM.scrollTop;
  const lineHeight = view.defaultLineHeight;
  const doc = view.state.doc;

  // Reference line: line at the top of viewport
  let refLine = doc.lineAt(view.viewport.from).number;
  try {
    const block = view.lineBlockAtHeight(scrollTop);
    refLine = doc.lineAt(block.from).number;
  } catch {}

  const scopes = cache.getScopesAtLine(refLine).sort((a, b) => a.depth - b.depth);
  const active = [];
  const maxLines = 5;

  for (const scope of scopes) {
    const next = cache.getNextSibling(scope);
    const trigger = scope.startLine - (scope.depth + 2);
    let endTrigger = scope.endLine - (scope.depth + 2);
    if (next) {
      const handoff = (opts.mode === STICKY_MODE.MONACO) ? next.startLine - 1 : next.startLine - 1;
      endTrigger = Math.min(endTrigger, handoff);
    }

    if (opts.mode === STICKY_MODE.MONACO) {
      // Geometric docking
      const slotTop = scope.depth * lineHeight;
      const slotBottom = slotTop + lineHeight;
      let topOfLine = 0;
      let bottomOfLine = 0;
      try {
        const startBlock = view.lineBlockAt(doc.line(scope.startLine).from);
        const endBlock = view.lineBlockAt(doc.line(scope.endLine).to);
        topOfLine = startBlock.top - scrollTop;
        bottomOfLine = endBlock.bottom - scrollTop;
      } catch {}
      if (slotTop >= topOfLine && slotTop <= bottomOfLine) {
        active.push(scope);
      }
    } else {
      // n+1 or hybrid activation
      const was = prevKeys.has(`${scope.depth}:${scope.startLine}`);
      const lower = was ? trigger - 0.4 : trigger + 0.4;
      const upper = was ? endTrigger + 1.0 : endTrigger - 0.4;
      if (refLine > lower && refLine <= upper) {
        active.push(scope);
      }
    }
    if (active.length >= maxLines) break;
  }

  // Push-up calculation (Monaco-style) for hybrid and Monaco, else simple
  let pushUp = 0;
  if (active.length) {
    const innermost = active[active.length - 1];
    try {
      const endBlock = view.lineBlockAt(doc.line(innermost.endLine).to);
      const bottomOfEnd = endBlock.bottom - scrollTop;
      const stackBottom = active.length * lineHeight;
      if (bottomOfEnd < stackBottom) {
        pushUp = bottomOfEnd - stackBottom;
      }
    } catch {}
  }

  return { activeScopes: active, pushUp, refLine };
}

function buildLayers(dom, state, view, lineNumberFontSize, lineNumberLineHeight) {
  const doc = view.state.doc;
  dom.innerHTML = '';
  state.activeScopes.forEach((scope, idx) => {
    const layer = document.createElement('div');
    layer.className = 'cm-sticky-layer';
    if (idx === state.activeScopes.length - 1) layer.classList.add('innermost');
    layer.style.top = `${idx * view.defaultLineHeight}px`;
    layer.style.zIndex = String(100 - idx);
    layer.style.setProperty('--cm-sticky-line-height', `${view.defaultLineHeight}px`);
    layer.style.transform = idx === state.activeScopes.length - 1 ? `translateY(${state.pushUp}px)` : 'translateY(0)';
    layer.style.height = `${idx === state.activeScopes.length - 1 ? Math.max(0, view.defaultLineHeight + state.pushUp) : view.defaultLineHeight}px`;

    const line = document.createElement('div');
    line.className = 'cm-sticky-line';

    const gutter = document.createElement('div');
    gutter.className = 'cm-sticky-gutter';
    gutter.style.width = `${(view.dom.querySelector('.cm-gutters')?.offsetWidth) || 0}px`;
    if (lineNumberFontSize) gutter.style.fontSize = lineNumberFontSize;
    if (lineNumberLineHeight) gutter.style.lineHeight = lineNumberLineHeight;
    gutter.style.padding = '0 10px 0 1px';

    const seg = document.createElement('div');
    seg.className = 'cm-sticky-gutter-segment';
    seg.style.width = gutter.style.width;
    if (lineNumberFontSize) seg.style.fontSize = lineNumberFontSize;
    if (lineNumberLineHeight) seg.style.lineHeight = lineNumberLineHeight;
    seg.style.paddingRight = '5px';
    seg.textContent = String(scope.startLine);
    gutter.appendChild(seg);

    const content = document.createElement('div');
    content.className = 'cm-sticky-content';
    content.textContent = doc.line(scope.startLine).text;

    line.appendChild(gutter);
    line.appendChild(content);
    layer.appendChild(line);
    dom.appendChild(layer);
  });
}

export function createStickyExtensions(CM, component, opts = {}) {
  const mode = opts.mode || STICKY_MODE.N_PLUS_ONE;

  const stickyScrollTheme = CM.EditorView.baseTheme({
    ".cm-stickyHeader": {
      position: "absolute",
      backgroundColor: "var(--cm-editor-bg, #1e1e1e)",
      fontFamily: "inherit",
      fontSize: "inherit",
      lineHeight: "1.4",
      zIndex: "10",
      pointerEvents: "auto",
      overflow: "hidden",
      boxShadow: "0 6px 8px rgba(0,0,0,0.35)",
    },
    ".cm-sticky-layer": {
      position: "absolute",
      left: "0",
      right: "0",
      height: "var(--cm-sticky-line-height, 1lh)",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      backgroundColor: "var(--cm-editor-bg, #1e1e1e)",
      pointerEvents: "auto",
      transition: "transform 0.12s ease-out, height 0.12s ease-out",
    },
    ".cm-sticky-layer.innermost": {
      boxShadow: "0 6px 8px rgba(0,0,0,0.35)",
    },
    ".cm-stickyHeader:empty": {
      display: "none",
    },
    ".cm-sticky-line": {
      padding: "1px 0 1px 0",
      display: "flex",
      alignItems: "center",
      cursor: "pointer",
      borderLeft: "2px solid transparent",
    },
    ".cm-sticky-line:hover": {
      backgroundColor: "rgba(255,255,255,0.05)",
      borderLeftColor: "#007acc",
    },
    ".cm-sticky-gutter": {
      display: "flex",
      flex: "0 0 auto",
      textAlign: "right",
      padding: "0 10px 0 1px",
      opacity: "0.75",
      fontVariantNumeric: "tabular-nums",
      color: "var(--cm-gutter-foreground, #858585)",
      boxSizing: "border-box",
      borderRight: "1px solid rgba(255,255,255,0.08)",
    },
    ".cm-sticky-gutter-segment": {
      flex: "0 0 auto",
      textAlign: "right",
      paddingRight: "5px",
      boxSizing: "border-box",
    },
    ".cm-sticky-content": {
      flex: "1 1 auto",
      padding: "0 8px 0 3px",
      whiteSpace: "pre",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
  });

  const cache = new ScopeCache();
  let lineNumberFontSize = '';
  let lineNumberLineHeight = '';

  const stickyScrollPlugin = CM.ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.dom = document.createElement('div');
      this.dom.className = 'cm-stickyHeader';
      this.cacheVersion = -1;
      this.lastSignature = '';
      this.prevActiveKeys = new Set();
      view.dom.appendChild(this.dom);
      cache.rebuild(view, getScopeTypesForLanguage(component.language));
      this.updateStickyHeader();
    }

    update(update) {
      if (update.docChanged) {
        cache.rebuild(this.view, getScopeTypesForLanguage(component.language));
      }
      this.updateStickyHeader();
    }

    destroy() {
      this.dom.remove();
    }

    updateStickyHeader() {
      const view = this.view;
      const state = view.state;
      const gutterRoot = view.dom.querySelector('.cm-gutters');
      const gutterChildren = gutterRoot ? Array.from(gutterRoot.children) : [];
      const lineNumberGutter = gutterChildren.find((el) => el.classList && el.classList.contains('cm-lineNumbers')) || gutterChildren[0] || null;
      if (lineNumberGutter) {
        try {
          const gs = window.getComputedStyle(lineNumberGutter);
          lineNumberFontSize = gs.fontSize;
          lineNumberLineHeight = gs.lineHeight;
        } catch {}
      }

      const stateInfo = computeState(view, cache, { mode }, this.prevActiveKeys);
      const signature = stateInfo.activeScopes.map((s) => `${s.depth}:${s.startLine}`).join('|');
      this.prevActiveKeys = new Set(stateInfo.activeScopes.map((s) => `${s.depth}:${s.startLine}`));

      // Update transform-only if same signature
      if (signature === this.lastSignature) {
        const layers = Array.from(this.dom.querySelectorAll('.cm-sticky-layer'));
        const lastIndex = stateInfo.activeScopes.length - 1;
        layers.forEach((layer, idx) => {
          const translate = idx === lastIndex ? `translateY(${stateInfo.pushUp}px)` : 'translateY(0)';
          layer.style.transform = translate;
        });
      } else {
        this.dom.innerHTML = '';
        buildLayers(this.dom, stateInfo, view, lineNumberFontSize, lineNumberLineHeight);
        this.lastSignature = signature;
      }
    }
  });

  return [stickyScrollTheme, stickyScrollPlugin];
}

