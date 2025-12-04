import * as CM from "nicegui-codemirror";

const searchExtension = typeof CM.search === 'function' ? CM.search : null;
const searchKeymap = Array.isArray(CM.searchKeymap) ? CM.searchKeymap : null;
const highlightSelectionMatches = typeof CM.highlightSelectionMatches === 'function' ? CM.highlightSelectionMatches : null;
const openSearchPanel = typeof CM.openSearchPanel === 'function' ? CM.openSearchPanel : null;
const indentationMarkers = typeof CM.indentationMarkers === 'function' ? CM.indentationMarkers : null;
// Color picker extension is exported as colorView() function and colorTheme
const colorExtension = (typeof CM.colorView === 'function' && CM.colorTheme) ? [CM.colorView(), CM.colorTheme] : null;
const showMinimap = CM.showMinimap;

const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.0;

const clampFontScale = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, parsed));
};

const buildFontScaleTheme = (scale) => {
  return CM.EditorView.theme({
    "&": {
      fontSize: `${scale * 100}%`,
      lineHeight: "1.45",
    },
    "& .cm-content, & .cm-line": {
      fontSize: "inherit",
      lineHeight: "inherit",
    },
  });
};

// Language-specific indent unit mapping
const LANGUAGE_INDENT_MAP = {
  // 2-space languages
  'javascript': 2,
  'typescript': 2,
  'jsx': 2,
  'tsx': 2,
  'html': 2,
  'css': 2,
  'json': 2,
  'yaml': 2,
  'xml': 2,
  'vue': 2,
  'svelte': 2,
  
  // 4-space languages
  'python': 4,
  'java': 4,
  'c': 4,
  'cpp': 4,
  'c++': 4,
  'csharp': 4,
  'c#': 4,
  'php': 4,
  'ruby': 4,
  'go': 4,
  'rust': 4,
  'shell': 4,
  'bash': 4,
  'sh': 4,
  'markdown': 4,
  'md': 4,
};

function getIndentForLanguage(language) {
  if (!language) return 4;  // Default to 4 spaces
  const normalized = language.toLowerCase().trim();
  return LANGUAGE_INDENT_MAP[normalized] || 4;  // Default to 4 if unknown
}

const EMPTY_GUTTER_RANGESET = (() => {
  const builder = new CM.RangeSetBuilder();
  return builder.finish();
})();

// Deletion widget class (moved to outer scope for facet access)
class RemovedLineWidget extends CM.WidgetType {
  constructor(text, wordWrap, originalLine, isDraft=false) {
    super();
    this.text = text;
    this.wordWrap = wordWrap;
    this.originalLine = originalLine;
    this.isDraft = isDraft;
  }
  toDOM() {
    const lineEl = document.createElement('div');
    lineEl.className = 'cm-diff-line cm-diff-line-removed';
    if (this.isDraft) {
      lineEl.classList.add('cm-diff-line-removed-draft');
    }
    if (this.wordWrap) {
      lineEl.classList.add('cm-diff-wrap');
    }

    const content = document.createElement('span');
    content.className = 'cm-diff-removed-text';
    content.textContent = this.text ?? '';

    lineEl.append(content);
    return lineEl;
  }
  ignoreEvent() { return true; }
}

// Deleted line number marker for the standard line-number gutter
class DeletedLineNumberMarker extends CM.GutterMarker {
  constructor(num, isDraft = false) {
    super();
    this.num = num;
    this.isDraft = !!isDraft;
    // Apply classes to the gutter element itself
    this.elementClass = isDraft
      ? 'cm-diff-deleted-lineno cm-diff-deleted-lineno-draft'
      : 'cm-diff-deleted-lineno';
  }
  eq(other) { return other instanceof DeletedLineNumberMarker && other.num === this.num && other.isDraft === this.isDraft; }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = this.num;
    return span;
  }
}

// Marker for the fold gutter on deletion lines (empty but styled)
class DeletedFoldMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-deleted-lineno';
  }
  eq(other) { return other instanceof DeletedFoldMarker; }
  toDOM() {
    return document.createElement('div');
  }
}

// Marker to add class to added lines (for gutterLineClass)
class AddedLineClassMarker extends CM.GutterMarker {
  constructor() { 
    super(); 
    this.elementClass = 'cm-diff-added-lineno';
  }
  eq(other) { return other instanceof AddedLineClassMarker; }
}
const addedLineClassMarker = new AddedLineClassMarker();

class AddedDraftLineClassMarker extends CM.GutterMarker {
  constructor() { 
    super(); 
    this.elementClass = 'cm-diff-added-lineno-draft';
  }
  eq(other) { return other instanceof AddedDraftLineClassMarker; }
}
const addedDraftLineClassMarker = new AddedDraftLineClassMarker();

// Inline diff decorations helper (extracted from diff_decorations.js)
function buildDiffDecorations(view, hunks, CM, getWordWrap) {
  const { Decoration, RangeSetBuilder } = CM;
  
  if (!hunks || hunks.length === 0) {
    return { decorations: Decoration.none, gutter: EMPTY_GUTTER_RANGESET, gutterClasses: EMPTY_GUTTER_RANGESET };
  }

  const lineAddedDeco = Decoration.line({
    class: 'cm-diff-line-added',
    diffKind: 'insert',
  });
  
  const lineAddedDraftDeco = Decoration.line({
    class: 'cm-diff-line-added-draft',
    diffKind: 'insert-draft',
  });

  const lineContextDeco = Decoration.line({
    class: 'cm-diff-line-context',
  });

  const wordWrap = getWordWrap();
  const builder = new RangeSetBuilder();
  const gutterBuilder = new RangeSetBuilder();
  const gutterClassBuilder = new RangeSetBuilder();
  let gutterCount = 0;
  let classCount = 0;
  const doc = view.state.doc;
  
  const lineDecorations = new Map();
  const deletionWidgets = [];
  
  for (const hunk of hunks) {
    let newLine = Math.max(1, hunk.newStart || 1);
    let oldLine = Math.max(1, hunk.oldStart || 1);
    
    for (const line of hunk.lines || []) {
      const kind = line.type;
      if (kind === 'add') {
        lineDecorations.set(newLine, { decoration: lineAddedDeco, markerKind: '+', isAdd: true });
        newLine += 1;
      } else if (kind === 'add-draft') {
        lineDecorations.set(newLine, { decoration: lineAddedDraftDeco, markerKind: '+', isAddDraft: true });
        newLine += 1;
      } else if (kind === 'context') {
        lineDecorations.set(newLine, { decoration: lineContextDeco, markerKind: '│' });
        newLine += 1;
        oldLine += 1;
      } else if (kind === 'del' || kind === 'del-draft') {
        deletionWidgets.push({
          line: newLine > 0 ? newLine : 1,
          text: line.text || '',
          originalLine: oldLine,
          isDraft: (kind === 'del-draft')
        });
        oldLine += 1;
      }
    }
  }
  
  deletionWidgets.sort((a, b) => a.line - b.line);
  
  let widgetIndex = 0;
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const lineInfo = safeLine(doc, lineNum);
    if (!lineInfo) continue;
    
    // Widgets before the line
    while (widgetIndex < deletionWidgets.length && deletionWidgets[widgetIndex].line < lineNum) {
      const widget = deletionWidgets[widgetIndex];
      const anchorLine = safeLine(doc, widget.line);
      const pos = anchorLine ? anchorLine.from : doc.length;
      builder.add(pos, pos, Decoration.widget({
        side: -1,
        block: true,
        widget: new RemovedLineWidget(widget.text, wordWrap, widget.originalLine, widget.isDraft),
        diffKind: widget.isDraft ? 'delete-draft' : 'delete',
      }));
      widgetIndex++;
    }
    
    // Widgets AT the line
    while (widgetIndex < deletionWidgets.length && deletionWidgets[widgetIndex].line === lineNum) {
      const widget = deletionWidgets[widgetIndex];
      builder.add(lineInfo.from, lineInfo.from, Decoration.widget({
        side: -1,
        block: true,
        widget: new RemovedLineWidget(widget.text, wordWrap, widget.originalLine, widget.isDraft),
        diffKind: 'delete',
      }));
      widgetIndex++;
    }

    const entry = lineDecorations.get(lineNum);
    if (entry) {
      builder.add(lineInfo.from, lineInfo.from, entry.decoration);
      if (entry.markerKind) {
        gutterBuilder.add(lineInfo.from, lineInfo.from, new DiffGutterMarker(entry.markerKind));
        gutterCount++;
      }
      if (entry.isAdd) {
        gutterClassBuilder.add(lineInfo.from, lineInfo.from, addedLineClassMarker);
        classCount++;
      } else if (entry.isAddDraft) {
        gutterClassBuilder.add(lineInfo.from, lineInfo.from, addedDraftLineClassMarker);
        classCount++;
      }
    }
  }
  
  // Remaining widgets
  while (widgetIndex < deletionWidgets.length) {
    const widget = deletionWidgets[widgetIndex];
    const anchorLine = safeLine(doc, widget.line);
    const pos = anchorLine ? anchorLine.from : doc.length;
    builder.add(pos, pos, Decoration.widget({
      side: -1,
      block: true,
      widget: new RemovedLineWidget(widget.text, wordWrap, widget.originalLine, widget.isDraft),
      diffKind: widget.isDraft ? 'delete-draft' : 'delete',
    }));
    widgetIndex++;
  }

  const decorations = builder.finish();
  const gutter = gutterCount ? gutterBuilder.finish() : EMPTY_GUTTER_RANGESET;
  const gutterClasses = classCount ? gutterClassBuilder.finish() : EMPTY_GUTTER_RANGESET;
  return { decorations, gutter, gutterClasses };
}

// Helper to scan diff decorations and build minimap gutters
function diffMinimapGuttersFromDecorations(state, diffField) {
  if (!diffField) return [];
  
  // Get current decoration set from the state field
  const decos = state.field(diffField, false);
  if (!decos) return [];

  const colorBuckets = new Map();
  const ensureBucket = (color) => {
    if (!colorBuckets.has(color)) {
      colorBuckets.set(color, {});
    }
    return colorBuckets.get(color);
  };

  const colorForKind = (kind) => {
    switch (kind) {
      case 'insert':
        return '#34d399'; // git added
      case 'delete':
        return '#f87171'; // git deleted
      case 'insert-draft':
        return '#60a5fa'; // draft added (blue)
      case 'delete-draft':
        return '#facc15'; // draft deleted (yellow)
      default:
        return null;
    }
  };

  decos.between(0, state.doc.length, (from, to, deco) => {
    const kind = deco.spec?.diffKind;
    const bucketColor = colorForKind(kind);
    if (!bucketColor) return;

    // Map this decoration/widget to line numbers in the *current* doc
    const lineFrom = state.doc.lineAt(from).number;
    const lineTo = state.doc.lineAt(to).number;
    const bucket = ensureBucket(bucketColor);

    for (let line = lineFrom; line <= lineTo; line++) {
      bucket[line] = bucketColor;
    }
  });

  return Array.from(colorBuckets.values());
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

// Deletion widget gutter marker (Chad's solution)
class MinusGutterMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-deleted-lineno';
  }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = '−';
    span.className = 'cm-diff-minus-marker';
    return span;
  }
  eq(other) {
    return other instanceof MinusGutterMarker;
  }
}

const minusMarker = new MinusGutterMarker();

// Deletion widget gutter marker for drafts
class MinusDraftGutterMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-deleted-lineno-draft';
  }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = '−';
    span.className = 'cm-diff-minus-marker-draft';
    return span;
  }
  eq(other) {
    return other instanceof MinusDraftGutterMarker;
  }
}
const minusDraftMarker = new MinusDraftGutterMarker();

class DiffGutterMarker extends CM.GutterMarker {
  constructor(marker) {
    super();
    this.marker = marker;
  }
  eq(other) {
    return other instanceof DiffGutterMarker && other.marker === this.marker;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-diff-gutter-marker';
    span.textContent = this.marker;
    if (this.marker === '+') {
      span.classList.add('cm-diff-marker-add');
    } else if (this.marker === '−') {
      span.classList.add('cm-diff-marker-del');
    } else if (this.marker === '│') {
      span.classList.add('cm-diff-marker-context');
    }
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}


export default {
  template: `
    <div></div>
  `,
  props: {
    value: String,
    language: String,
    theme: { type: String, required: true },
    fontScale: { type: Number, default: 1 },
    lineWrapping: Boolean,
    disable: Boolean,
    indent: String,
    highlightWhitespace: Boolean,
    showMinimap: Boolean,
    // Optional 1-based line number for initial scroll anchoring (backend-driven)
    initialScrollLine: { type: Number, default: null },
  },
  watch: {
    language(newLanguage) {
      this.setLanguage(newLanguage);
    },
    theme(newTheme) {
      this.setTheme(newTheme);
    },
    disable(newDisable) {
      this.setDisabled(newDisable);
    },
    lineWrapping(newLineWrapping) {
      this.setLineWrapping(newLineWrapping);
    },
    showMinimap(newVal) {
      this.updateMinimapState();
    },
  },
  data() {
    return {
      // To let other methods wait for the editor to be created because
      // they might be called by the server before the editor is created.
      editorPromise: new Promise((resolve) => {
        this.resolveEditor = resolve;
      }),
      pendingFontScale: clampFontScale(this.fontScale),
      colorPickerCompartment: null, // Color picker toggle compartment
      readOnlyCompartment: null,     // Read-only mode compartment
      stickyScrollCompartment: null, // Sticky scroll toggle compartment - Added: 2025-12-03 by vectorArc - TE2 Team
      isMobileLayout: false,
    };
  },
  methods: {
    updateMinimapState() {
      if (!this.showMinimap) {
        this.applyMinimapMode('off');
        return;
      }
      const mode = this.isMobileLayout ? 'mobile' : 'desktop';
      this.applyMinimapMode(mode);
    },
    handleLayoutChange(e) {
      this.isMobileLayout = e.matches;
      if (this.showMinimap) {
        this.updateMinimapState();
      }
    },
    openSearchPanelFromServer() {
      if (!this.editor || typeof openSearchPanel !== 'function') return;
      try {
        openSearchPanel(this.editor);
      } catch (err) {
        console.warn('[CodeMirror] Failed to open search panel:', err);
      }
    },
    request_content() {
      if (!this.editor) return "";
      return this.editor.state.doc.toString();
    },
    // Find the language's extension by its name. Case insensitive.
    findLanguage(name) {
      for (const language of this.languages)
        for (const alias of [language.name, ...language.alias])
          if (name.toLowerCase() === alias.toLowerCase()) return language;

      console.error(`Language not found: ${name}`);
      console.info("Supported language names:", this.languages.map((lang) => lang.name).join(", "));
      return null;
    },
    // Get the names of all supported languages
    async getLanguages() {
      if (!this.editor) await this.editorPromise;
      // Over 100 supported languages: https://github.com/codemirror/language-data/blob/main/src/language-data.ts
      return this.languages.map((lang) => lang.name).sort(Intl.Collator("en").compare);
    },
    setLanguage(language) {
      if (!language) {
        // Default to 4 spaces when no language
        this.editor.dispatch({
          effects: [
            this.languageConfig.reconfigure([]),
            this.indentUnitCompartment.reconfigure(CM.indentUnit.of('    '))
          ]
        });
        return;
      }

      const lang_description = this.findLanguage(language, this.languages);
      if (!lang_description) {
        console.error("Language not found:", language);
        return;
      }

      lang_description.load().then((extension) => {
        // Determine appropriate indent size for this language
        const indentSize = getIndentForLanguage(language);
        const indentString = ' '.repeat(indentSize);
        
        // Reconfigure both language and indent unit together
        this.editor.dispatch({
          effects: [
            this.languageConfig.reconfigure([extension]),
            this.indentUnitCompartment.reconfigure(CM.indentUnit.of(indentString))
          ]
        });
      });
    },
    async getThemes() {
      if (!this.editor) await this.editorPromise;
      // `this.themes` also contains some non-theme objects
      // The real themes are Arrays
      return Object.keys(this.themes)
        .filter((key) => Array.isArray(this.themes[key]))
        .sort(Intl.Collator("en").compare);
    },
    resolveThemeExtension(themeName) {
      if (!themeName) {
        throw new Error('[CodeMirror] No theme name provided by backend preferences');
      }
      if (!this.themes || typeof this.themes !== 'object') {
        throw new Error('[CodeMirror] Theme bundle not available; cannot resolve theme');
      }
      const extension = this.themes[themeName];
      if (!extension) {
        throw new Error(`[CodeMirror] Theme not found: ${themeName}`);
      }
      return extension;
    },
    setTheme(theme) {
      const new_theme = this.resolveThemeExtension(theme);
      this.editor.dispatch({
        effects: this.themeConfig.reconfigure([new_theme]),
      });
    },
    setEditorValueFromProps() {
      this.setEditorValue(this.value);
    },
    setEditorValue(value) {
      if (!this.editor) return;
      if (this.editor.state.doc.toString() === value) return;

      this.emitting = false;
      this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: value } });
      this.emitting = true;
    },
    emitCacheState(payload) {
      try {
        const envelope = Object.assign({ type: 'cm6-cache-state' }, payload || {});
        const target = window.parent || window;
        target.postMessage(envelope, '*');
      } catch (err) {
        console.warn('[CodeMirror] Failed to emit cache state event', err);
      }
    },
    notifyParent(type, data) {
      try {
        const target = window.parent || window;
        target.postMessage({
          type: type,
          data: data
        }, '*');
      } catch (err) {
        console.warn('[CodeMirror] Failed to notify parent', err);
      }
    },
    setDiffMode(mode) {
      if (!this.editor) return;
      if (mode === 'draft') {
        this.editor.dom.classList.add('cm-diff-mode-draft');
        this.editor.dom.classList.remove('cm-diff-mode-git');
      } else {
        this.editor.dom.classList.remove('cm-diff-mode-draft');
        this.editor.dom.classList.add('cm-diff-mode-git');
      }
    },
    setDisabled(disabled) {
      this.editor.dispatch({
        effects: this.editableConfig.reconfigure(this.editableStates[!disabled]),
      });
    },
    setLineWrapping(wrap) {
      this.editor.dispatch({
        effects: this.lineWrappingConfig.reconfigure(wrap ? [CM.EditorView.lineWrapping] : []),
      });
    },
    setFontScale(scale) {
      const { StateEffect, Compartment } = CM;
      const clamped = clampFontScale(scale);
      this.pendingFontScale = clamped;
      if (!this.editor) return;

      if (!this.fontSizeCompartment) {
        this.fontSizeCompartment = new Compartment();
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.fontSizeCompartment.of([])),
        });
      }

      const fontTheme = buildFontScaleTheme(clamped);

      this.editor.dispatch({
        effects: this.fontSizeCompartment.reconfigure([fontTheme]),
      });
    },
    async applyIndentGuides(enabled) {
      // Initialize indent guides compartment on first call
      if (!this.indentCompartment) {
        if (!indentationMarkers) {
          console.warn('[CM6] indentationMarkers not available in bundle');
          return;
        }
        
        const { Compartment, StateEffect } = CM;
        
        this.indentCompartment = new Compartment();
        
        // Extension configuration
        this.indentExtensions = [
          indentationMarkers({
            highlightActiveBlock: true,
            thickness: 1,
            hideFirstIndent: false,
            markerType: 'fullScope',
            colors: {
              light: '#c9b398ff',    // darker muted tan for inactive guides
              dark: '#3c3226ff',     // darker muted tan for inactive guides
              activeLight: '#7a6557ff',  // medium tan for active block
              activeDark: '#7a6557ff'    // medium tan for active block
            }
          })
        ];
        
        // Install empty compartment
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.indentCompartment.of([]))
        });
      }
      
      // Reconfigure compartment
      const extensions = enabled ? this.indentExtensions : [];
      this.editor.dispatch({
        effects: this.indentCompartment.reconfigure(extensions)
      });
    },
    async applyZebraStripes(enabled) {
      // Initialize zebra compartment on first call
      if (!this.zebraCompartment) {
        const { EditorView, Decoration, ViewPlugin } = CM;
        const { Facet, RangeSetBuilder, StateEffect, Compartment } = CM;
        
        this.zebraCompartment = new Compartment();
        
        const baseTheme = EditorView.baseTheme({
          "&light .cm-zebraStripe": { backgroundColor: "rgba(0,0,0,.035)" },
          "&dark .cm-zebraStripe": { backgroundColor: "rgba(255,255,255,.06)" },
        });
        
        const stepSize = Facet.define({ combine: v => v.length ? v[0] : 2 });
        const stripe = Decoration.line({ attributes: { class: "cm-zebraStripe" } });
        
        function stripeDeco(v) {
          const step = v.state.facet(stepSize);
          const b = new RangeSetBuilder();
          for (let { from, to } of v.visibleRanges) {
            for (let pos = from; pos <= to;) {
              const line = v.state.doc.lineAt(pos);
              if ((line.number % step) === 0) b.add(line.from, line.from, stripe);
              pos = line.to + 1;
            }
          }
          return b.finish();
        }
        
        const zebraPlugin = ViewPlugin.fromClass(class {
          constructor(v) { this.decorations = stripeDeco(v); }
          update(u) {
            if (u.docChanged || u.viewportChanged) this.decorations = stripeDeco(u.view);
          }
        }, { decorations: v => v.decorations });
        
        this.zebraExtensions = [baseTheme, stepSize.of(2), zebraPlugin];
        
        // Install empty compartment
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.zebraCompartment.of([]))
        });
      }
      
      // Reconfigure compartment
      const extensions = enabled ? this.zebraExtensions : [];
      this.editor.dispatch({
        effects: this.zebraCompartment.reconfigure(extensions)
      });
    },
    
    // Initialize diff compartments early so minimap can reference diffField
    initDiffCompartments() {
      if (this.diffCompartment) return; // Already initialized
      
      const { StateEffect, StateField, Compartment } = CM;
      
      this.diffCompartment = new Compartment();
      this.setDiffEffect = StateEffect.define();
      this.clearDiffEffect = StateEffect.define();
      
      const setDiffEffect = this.setDiffEffect;
      const clearDiffEffect = this.clearDiffEffect;
      
      const diffField = StateField.define({
        create() {
          return CM.Decoration.none;
        },
        update(value, tr) {
          if (tr.docChanged && value !== CM.Decoration.none) {
            value = value.map(tr.changes);
          }
          for (const effect of tr.effects) {
            if (effect.is(setDiffEffect)) {
              value = effect.value;
            } else if (effect.is(clearDiffEffect)) {
              value = CM.Decoration.none;
            }
          }
          return value;
        },
        provide: field => CM.EditorView.decorations.from(field)
      });
      
      this.diffField = diffField;
      
      this.editor.dispatch({
        effects: StateEffect.appendConfig.of(this.diffCompartment.of([diffField]))
      });
      
      // Also initialize gutter compartment
      this.diffGutterCompartment = new Compartment();
      this.setDiffGutterEffect = StateEffect.define();
      this.clearDiffGutterEffect = StateEffect.define();
      const setDiffGutterEffect = this.setDiffGutterEffect;
      const clearDiffGutterEffect = this.clearDiffGutterEffect;
      const diffGutterField = StateField.define({
        create() {
          return EMPTY_GUTTER_RANGESET;
        },
        update(value, tr) {
          if (tr.docChanged && value && typeof value.map === 'function') {
            value = value.map(tr.changes);
          }
          for (const effect of tr.effects) {
            if (effect.is(setDiffGutterEffect)) {
              value = effect.value;
            } else if (effect.is(clearDiffGutterEffect)) {
              value = EMPTY_GUTTER_RANGESET;
            }
          }
          return value;
        },
      });
      this.diffGutterField = diffGutterField;
      this.diffGutterExtension = [
        diffGutterField,
        CM.gutter({
          class: 'cm-diff-gutter',
          markers: view => view.state.field(diffGutterField),
          initialSpacer: () => new DiffGutterMarker(''),
          ...(CM.gutterWidgetClass ? { 
            widgetMarker: (view, widget, block) => {
              if (widget instanceof RemovedLineWidget) {
                return widget.isDraft ? minusDraftMarker : minusMarker;
              }
              return null;
            }
          } : {}),
        }),
        CM.lineNumberWidgetMarker.of((view, widget, block) => {
          if (widget instanceof RemovedLineWidget) {
            return new DeletedLineNumberMarker(widget.originalLine, widget.isDraft);
          }
          return null;
        }),
      ];
      this.editor.dispatch({
        effects: CM.StateEffect.appendConfig.of(this.diffGutterCompartment.of([]))
      });
      
      console.log('[CodeMirror] Diff compartments initialized early');
    },
    
    async applyDiffDecorations(hunks) {
      console.log('[applyDiffDecorations] Called with hunks:', JSON.stringify(hunks, null, 2));
      console.log('[applyDiffDecorations] Doc has', this.editor?.state?.doc?.lines, 'lines');
      
      // Initialize diff compartment if not already done (fallback for direct calls)
      if (!this.diffCompartment) {
        this.initDiffCompartments();
      }

      const normalizedHunks = Array.isArray(hunks) ? hunks : [];
      
      const getWordWrap = () => this.lineWrapping || false;
      console.log('[applyDiffDecorations] Building decorations, wordWrap:', getWordWrap());
      const { decorations: decoSet, gutter: gutterSet, gutterClasses: gutterClassSet } = buildDiffDecorations(this.editor, normalizedHunks, CM, getWordWrap);
      console.log('[applyDiffDecorations] Built diff decorations');
      const gutterActive = gutterSet !== EMPTY_GUTTER_RANGESET;
      
      const effects = [
        this.setDiffEffect.of(decoSet)
      ];
      if (this.diffGutterCompartment && this.diffGutterExtension) {
        if (gutterActive) {
          effects.push(this.diffGutterCompartment.reconfigure(this.diffGutterExtension));
          effects.push(this.setDiffGutterEffect.of(gutterSet));
        } else {
          effects.push(this.clearDiffGutterEffect.of(null));
          effects.push(this.diffGutterCompartment.reconfigure([]));
        }
      }
      
      // Reconfigure gutter classes
      if (this.gutterClassCompartment) {
        if (gutterActive && gutterClassSet !== EMPTY_GUTTER_RANGESET) {
          effects.push(this.gutterClassCompartment.reconfigure(CM.gutterLineClass.of(gutterClassSet)));
        } else {
          effects.push(this.gutterClassCompartment.reconfigure([]));
        }
      }
      
      this.editor.dispatch({ effects });
      
      // Force minimap update to reflect new diff gutters
      if (this.showMinimap) {
        this.updateMinimapState();
      }
    },
    setupExtensions() {
      const self = this;

      // Sends a ChangeSet https://codemirror.net/docs/ref/#state.ChangeSet
      // containing only the changes made to the document.
      // This could potentially be optimized further by sending updates
      // periodically instead of on every change and accumulating changesets
      // with ChangeSet.compose.
      const changeSender = CM.ViewPlugin.fromClass(
        class {
          constructor() {
            this.debounceTimer = null;
          }
          update(update) {
            if (!update.docChanged) return;
            if (!self.emitting) return;

            if (this.debounceTimer) {
              clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => {
              const newContent = update.state.doc.toString();
              self.$emit("change", { value: newContent });
            }, 500); // 500ms debounce
          }
        }
      );

      // Scroll activity detector for mobile minimap fade-in
      const scrollActivityPlugin = CM.ViewPlugin.fromClass(
        class {
          constructor(view) {
            this.view = view;
            this.timeout = null;
            this.onScroll = this.onScroll.bind(this);
            // Attach to scroller DOM
            this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
          }
          
          onScroll() {
            const wrapper = this.view.dom;
            if (!wrapper.classList.contains('cm-scrolling')) {
              wrapper.classList.add('cm-scrolling');
            }
            
            if (this.timeout) clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
              wrapper.classList.remove('cm-scrolling');
            }, 1500); // Keep visible for 1.5s after scroll stops
          }
          
          destroy() {
            this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
            if (this.timeout) clearTimeout(this.timeout);
          }
        }
      );

      // Create compartment for dynamic indent unit (before extensions array)
      this.indentUnitCompartment = new CM.Compartment();
      
      // Create compartments for toggleable features
      this.colorPickerCompartment = new CM.Compartment();
      this.readOnlyCompartment = new CM.Compartment();
      this.fontSizeCompartment = new CM.Compartment();
      this.gutterClassCompartment = new CM.Compartment();

      const initialFontScale = clampFontScale(this.fontScale);
      const initialFontTheme = buildFontScaleTheme(initialFontScale);
      this.pendingFontScale = initialFontScale;

      if (!this.theme) {
        throw new Error('[CodeMirror] Missing required theme prop; CodeMirror cannot initialize');
      }

      const initialThemeExtension = this.resolveThemeExtension(this.theme);

      const extensions = [
        CM.basicSetup,
        changeSender,
        scrollActivityPlugin, // Add the scroll listener
        // Enables the Tab key to indent the current lines https://codemirror.net/examples/tab/
        CM.keymap.of([CM.indentWithTab]),
        // Sets indentation https://codemirror.net/docs/ref/#language.indentUnit
        this.indentUnitCompartment.of(CM.indentUnit.of(this.indent)),
        // We will set these Compartments later and dynamically through props
        this.themeConfig.of([initialThemeExtension]),
        this.languageConfig.of([]),
        this.editableConfig.of([]),
        this.lineWrappingConfig.of([]),
        this.fontSizeCompartment.of([initialFontTheme]),
        this.colorPickerCompartment.of([]), // Color picker toggle
        this.readOnlyCompartment.of([]),     // Read-only mode toggle
        this.gutterClassCompartment.of([]), // Gutter line classes
        // Apply styling to ALL gutters for deletion widgets (fixes fold gutter tinting)
        (CM.gutterWidgetClass ? CM.gutterWidgetClass.of((view, widget, block) => {
            if (widget instanceof RemovedLineWidget) {
              return new DeletedFoldMarker();
            }
            return null;
        }) : []),
        CM.EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ];

      if (this.highlightWhitespace) extensions.push([CM.highlightWhitespace()]);
      if (searchExtension) extensions.push(searchExtension());
      if (highlightSelectionMatches) extensions.push(highlightSelectionMatches());
      if (searchKeymap && searchKeymap.length) {
        extensions.push(CM.keymap.of(searchKeymap));
      }

      // Scroll tracking via ViewPlugin (viewport-based; no focus assumptions)
      try {
        const self = this;
        const scrollTracker = CM.ViewPlugin.fromClass(class {
          constructor(view) {
            this.view = view;
            self.reportScrollPosition(view);
          }
          update(update) {
            if (update.viewportChanged || update.docChanged) {
              self.reportScrollPosition(update.view);
            }
          }
          destroy() {
            this.view = null;
          }
        });
        console.log('[CodeMirror] Installing scroll tracker plugin');
        extensions.push(scrollTracker);
      } catch (err) {
        console.warn('[CodeMirror] Failed to initialize scroll tracker plugin:', err);
      }

      return extensions;
    },
    // ============================================================================
    // CUSTOM METHOD: reportScrollPosition
    // Updated: 2025-12-03 by vectorArc - TE2 Team
    // Fix: Use lineBlockAtHeight instead of posAtCoords - stable during updates
    // Added: Bottom-of-document detection
    // ============================================================================
    reportScrollPosition(viewArg) {
      try {
        const view = viewArg || this.editor;
        if (!view) return;
        const state = view.state;
        if (!state) return;

        // Detect if at bottom of document first
        const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM;
        const atBottom = Math.abs(scrollTop + clientHeight - scrollHeight) < 2;

        if (atBottom) {
          // Report last line when at bottom
          const lastLine = state.doc.lines;
          console.log('[CodeMirror] reportScrollPosition (at bottom)', { line: lastLine, atBottom: true });
          this.notifyParent('cm6-scroll-state', {
            line: lastLine,
            column: 0,
            top: state.doc.length,
            atBottom: true,
            timestamp: Date.now(),
          });
          return;
        }

        // Use visibleRanges / viewport.from to avoid layout reads during update
        let pos = view.viewport.from;
        const ranges = view.visibleRanges;
        if (ranges && ranges.length > 0) {
          pos = ranges[0].from;
        }

        const lineInfo = state.doc.lineAt(pos);
        const line = lineInfo.number;
        const column = pos - lineInfo.from;

        console.log('[CodeMirror] reportScrollPosition', { line, column, pos });
        this.notifyParent('cm6-scroll-state', {
          line,
          column,
          top: pos,
          atBottom: false,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.warn('[CodeMirror] Failed to report scroll position:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: jumpToLine
    // Added: 2025-11-17 by TE-2 Team
    // Purpose: Jump to a specific line number in the editor
    // Used by: Explorer search feature, Go To Line menu
    // Note: Uses proper CM6 API via editor.dispatch() for reliable scrolling
    // ============================================================================
    jumpToLine(payload) {
      if (!this.editor) {
        console.warn('[CodeMirror] jumpToLine: editor not ready');
        return;
      }

      let shouldFocus = true;
      let input = payload;
      if (payload && typeof payload === 'object') {
        input = payload.line;
        if (Object.prototype.hasOwnProperty.call(payload, 'focus')) {
          shouldFocus = !!payload.focus;
        }
      }

      const line = parseInt(input, 10);
      if (isNaN(line) || line < 1) {
        console.warn('[CodeMirror] jumpToLine: invalid line number', input);
        return;
      }
      
      try {
        const doc = this.editor.state.doc;
        const maxLine = doc.lines;
        const targetLine = Math.max(1, Math.min(line, maxLine));
        const pos = doc.line(targetLine).from;
        
        this.editor.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true
        });

        if (shouldFocus) {
          this.editor.focus();
        }

        console.log('[CodeMirror] jumpToLine: jumped to line', targetLine, 'focus=', shouldFocus);
      } catch (err) {
        console.error('[CodeMirror] jumpToLine failed:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: toggleColorPicker
    // Added: 2025-11-19 by TE-2 Team
    // Purpose: Toggle CSS color picker extension on/off
    // Used by: Editor menu "Show Color Picker" toggle
    // ============================================================================
    toggleColorPicker(enabled) {
      if (!this.editor || !this.colorPickerCompartment) {
        console.warn('[CodeMirror] toggleColorPicker: editor not ready');
        return;
      }
      
      if (!colorExtension) {
        console.warn('[CodeMirror] colorExtension not available in bundle');
        return;
      }
      
      try {
        const effects = enabled
          ? this.colorPickerCompartment.reconfigure(colorExtension)
          : this.colorPickerCompartment.reconfigure([]);
        
        this.editor.dispatch({ effects });
        console.log('[CodeMirror] Color picker:', enabled ? 'enabled' : 'disabled');
      } catch (err) {
        console.error('[CodeMirror] toggleColorPicker failed:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: setReadOnly
    // Added: 2025-11-19 by TE-2 Team
    // Purpose: Set editor to read-only mode (disable editing)
    // Used by: Editor menu "Read Only Mode" toggle
    // Note: On mobile, keyboard may still appear on tap - this is a CM6 limitation
    // ============================================================================
    setReadOnly(readonly) {
      if (!this.editor || !this.readOnlyCompartment) {
        console.warn('[CodeMirror] setReadOnly: editor not ready');
        return;
      }
      
      try {
        const effects = readonly
          ? this.readOnlyCompartment.reconfigure([
              CM.EditorState.readOnly.of(true),
              CM.EditorView.editable.of(false)
            ])
          : this.readOnlyCompartment.reconfigure([]);
        
        this.editor.dispatch({ effects });
        console.log('[CodeMirror] Read-only mode:', readonly ? 'enabled' : 'disabled');
      } catch (err) {
        console.error('[CodeMirror] setReadOnly failed:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: applyMinimapMode
    // Added: 2025-11-24 by TE-2 Team
    // Purpose: Configure minimap extension based on mode (desktop/mobile/off)
    // Used by: Editor preferences and layout detection
    // ============================================================================
    async applyMinimapMode(mode) {
      // mode: "desktop" | "mobile" | "off"
      if (!this.editor || !showMinimap || typeof showMinimap.compute !== 'function') {
        console.warn('[CodeMirror] minimap not available');
        return;
      }

      if (!this.minimapCompartment) {
        this.minimapCompartment = new CM.Compartment();
        
        // Install empty compartment once
        this.editor.dispatch({
          effects: CM.StateEffect.appendConfig.of(
            this.minimapCompartment.of([])
          ),
        });
      }

      const targetMode = mode || 'off';
      let extensions = [];

      if (targetMode !== 'off') {
        // Include diffField in dependencies if it exists so minimap updates when diffs change
        const deps = this.diffField ? ['doc', this.diffField] : ['doc'];
        
        const minimapExt = showMinimap.compute(deps, (state) => {
          // We just need to give it a container DOM node and config
          const create = (view) => {
            const dom = document.createElement('div');
            // Base class + mode class; CSS will do the heavy lifting
            dom.className = `cm-minimap-container cm-minimap-${targetMode}`;
            return { dom };
          };

          // Desktop vs mobile are just different config knobs
          const isMobile = targetMode === 'mobile';
          
          // Collect diff gutters if diffField exists (diffs active)
          // Pass 'this.diffField' which is the StateField created in applyDiffDecorations
          const gutters = this.diffField 
            ? diffMinimapGuttersFromDecorations(state, this.diffField) 
            : [];

          return {
            create,
            // VS Code-ish “blocky” look works well in a tiny view
            displayText: 'blocks',
            // Always show overlay (we control visibility/opacity via CSS/Mode)
            showOverlay: 'always',
            // Inject the collected diff gutters
            gutters: gutters,
          };
        });

        extensions = [minimapExt];
      }

      this.editor.dispatch({
        effects: this.minimapCompartment.reconfigure(extensions),
      });
      console.log('[CodeMirror] Minimap mode set to:', targetMode);
      
      // Add class to editor DOM for desktop sidebar layout
      if (targetMode === 'desktop') {
        this.editor.dom.classList.add('cm-has-minimap-desktop');
      } else {
        this.editor.dom.classList.remove('cm-has-minimap-desktop');
      }
    },
    // ============================================================================

    // ============================================================================
    // CUSTOM METHOD: applyStickyScroll
    // Added: 2025-12-03 by vectorArc - TE2 Team
    // Purpose: Enable Monaco-style sticky scroll showing current function/class scope
    // Uses: CM6 ViewPlugin with absolute-positioned overlay + Lezer syntax tree
    // Fixed: 2025-12-03 - Converted to Monaco pixel-geometry approach for proper triggering
    // ============================================================================
    applyStickyScroll(enabled) {
      if (!this.editor) return;

      // Language-aware scope node types
      const SCOPE_NODE_TYPES = {
        javascript: new Set([
          "FunctionDeclaration", "FunctionExpression", "ArrowFunction",
          "MethodDeclaration", "MethodDefinition", 
          "ClassDeclaration", "ClassExpression"
        ]),
        typescript: new Set([
          "FunctionDeclaration", "FunctionExpression", "ArrowFunction",
          "MethodDeclaration", "MethodDefinition",
          "ClassDeclaration", "ClassExpression",
          "InterfaceDeclaration", "TypeAliasDeclaration", "EnumDeclaration"
        ]),
        python: new Set([
          "FunctionDefinition", "ClassDefinition"
        ]),
        // Fallback for other languages
        default: new Set([
          "FunctionDeclaration", "FunctionDefinition", "FunctionExpression",
          "ArrowFunction", "MethodDeclaration", "MethodDefinition",
          "ClassDeclaration", "ClassDefinition", "ClassExpression"
        ])
      };

      // Get scope types for current language
      const getScopeTypes = () => {
        const lang = (this.language || 'default').toLowerCase();
        return SCOPE_NODE_TYPES[lang] || SCOPE_NODE_TYPES.default;
      };

      // Escape HTML for safe rendering
      const escapeHtml = (str) => {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      };

      // Sticky scroll theme - ABSOLUTE overlay beside gutter
      const stickyScrollTheme = CM.EditorView.baseTheme({
        ".cm-stickyHeader": {
          position: "absolute",
          backgroundColor: "var(--cm-editor-bg, #1e1e1e)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: "1.4",
          zIndex: "10",
          pointerEvents: "auto",
        },
        ".cm-stickyHeader:empty": {
          display: "none",
        },
        ".cm-sticky-line": {
          padding: "1px 8px 1px 4px",
          whiteSpace: "pre",
          overflow: "hidden",
          textOverflow: "ellipsis",
          cursor: "pointer",
          borderLeft: "2px solid transparent",
        },
        ".cm-sticky-line:hover": {
          backgroundColor: "rgba(255,255,255,0.05)",
          borderLeftColor: "#007acc",
        },
        // Indent nested scopes slightly
        ".cm-sticky-line:not(:first-child)": {
          paddingLeft: "12px",
          opacity: "0.85",
        },
      });

      // ============================================================================
      // ViewPlugin using Monaco's pixel-geometry approach
      // Fixed: 2025-12-03 - Uses scrollTop-relative pixel positions instead of line numbers
      // ============================================================================
      const stickyScrollPlugin = CM.ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view;
          this.dom = document.createElement("div");
          this.dom.className = "cm-stickyHeader";
          this.currentScopes = [];
          this.lastRenderTime = 0;
          this.lastOverlayHeight = 0;
          
          // Append to editor DOM (works inside iframe)
          view.dom.appendChild(this.dom);
          
          // Click handler for jump-to-definition
          this.dom.addEventListener('click', (e) => {
            const target = e.target.closest('.cm-sticky-line');
            if (target && this.currentScopes.length > 0) {
              const index = parseInt(target.dataset.index, 10);
              const scope = this.currentScopes[index];
              if (!isNaN(index) && scope && scope.node) {
                view.dispatch({
                  selection: { anchor: scope.node.from },
                  scrollIntoView: true,
                });
                view.focus();
              }
            }
          });
          
          // Direct scroll listener for immediate response
          this.scrollHandler = () => this.updateStickyHeader();
          view.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true });
          
          // Initial render
          this.updateStickyHeader();
        }
        
        updateStickyHeader() {
          const view = this.view;
          const state = view.state;
          const scrollTop = view.scrollDOM.scrollTop;
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          // Simple time-based backoff to reduce boundary flicker
          if (now - this.lastRenderTime < 100) {
            return;
          }
          this.lastRenderTime = now;
          
          // Get gutter width to position overlay beside it
          const gutterEl = view.dom.querySelector('.cm-gutters');
          const gutterWidth = gutterEl ? gutterEl.offsetWidth : 0;
          
          // Position absolute overlay to the right of gutter
          this.dom.style.top = '0';
          this.dom.style.left = gutterWidth + 'px';
          this.dom.style.right = '0';

          const lineHeight = view.defaultLineHeight;

          // ---------------------------------------------------------------------------
          // 1) Compute reference line just below the overlay, but use the
          //    previous overlay height for sampling to avoid double-flash when
          //    the header grows/shrinks on this frame.
          // ---------------------------------------------------------------------------
          const currentOverlayHeight = this.dom.offsetHeight || 0;
          const samplingOverlayHeight = this.lastOverlayHeight || currentOverlayHeight;
          const effectiveTop = scrollTop + samplingOverlayHeight + lineHeight;

          console.log('[StickyScroll] top', {
            scrollTop,
            currentOverlayHeight,
            samplingOverlayHeight,
            lineHeight,
            effectiveTop,
          });
          let refPos;
          try {
            const block = view.lineBlockAtHeight(effectiveTop);
            refPos = block.from;
          } catch {
            refPos = view.viewport.from;
          }
          const refLine = state.doc.lineAt(refPos).number;

          // ---------------------------------------------------------------------------
          // 2) Build scope hierarchy at refPos (outer → inner)
          // ---------------------------------------------------------------------------
          const tree = CM.syntaxTree(state);
          if (!tree || !tree.topNode) {
            if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
            this.currentScopes = [];
            return;
          }

          const scopeTypes = getScopeTypes();
          const ancestorNodes = [];
          let node = tree.resolveInner(refPos);
          for (; node; node = node.parent) {
            if (scopeTypes.has(node.name)) {
              ancestorNodes.push(node);
            }
          }
          ancestorNodes.reverse(); // depth 0 = outermost

          const scopes = ancestorNodes.map((n, depth) => {
            const startLine = state.doc.lineAt(n.from).number;
            const endLine = state.doc.lineAt(n.to).number;
            const text = state.doc.lineAt(n.from).text;
            // depth 0 => offset -2, depth 1 => -3, etc. (n+1 with global early capture)
            const offset = -(depth + 2);
            const triggerLine = startLine + offset;
            // Apply the same offset to the effective end so scopes hand off cleanly
            const endTriggerLine = Math.max(startLine, endLine + offset);
            return { node: n, depth, startLine, endLine, text, triggerLine, endTriggerLine };
          });

          console.log(
            '[StickyScroll] scopes',
            scopes.map((s) => ({
              depth: s.depth,
              startLine: s.startLine,
              endLine: s.endLine,
              triggerLine: s.triggerLine,
              endTriggerLine: s.endTriggerLine,
            })),
            'refLine',
            refLine
          );

          // ---------------------------------------------------------------------------
          // 3) Decide active scopes based on refLine and per-depth triggerLine
          //    Condition: triggerLine < refLine <= endLine
          // ---------------------------------------------------------------------------
          const MAX_STICKY_LINES = 5;
          const activeScopes = [];
          for (const scope of scopes) {
            if (activeScopes.length >= MAX_STICKY_LINES) break;

            // If we haven't reached this scope's trigger yet, no deeper scopes should be active.
            if (refLine <= scope.triggerLine) {
              break;
            }

            // Active between triggerLine and endTriggerLine (early exit at both start and end)
            const active = refLine > scope.triggerLine && refLine <= scope.endTriggerLine;
            if (active) {
              activeScopes.push(scope);
            }
            console.log('[StickyScroll] eval', {
              depth: scope.depth,
              refLine,
              triggerLine: scope.triggerLine,
              endTriggerLine: scope.endTriggerLine,
              active,
            });
          }

          this.currentScopes = activeScopes;

          // ---------------------------------------------------------------------------
          // 4) Render overlay from activeScopes
          // ---------------------------------------------------------------------------
          if (activeScopes.length === 0) {
            if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
          } else {
            const newHtml = activeScopes.map((scope, idx) =>
              `<div class="cm-sticky-line" data-index="${idx}">${escapeHtml(scope.text)}</div>`
            ).join('');
            if (this.dom.innerHTML !== newHtml) {
              this.dom.innerHTML = newHtml;
            }
          }

          // Remember overlay height for the next sampling pass
          this.lastOverlayHeight = this.dom.offsetHeight || 0;
        }
        
        update(update) {
          // Re-render on document changes (syntax tree may have changed)
          if (update.docChanged) {
            this.updateStickyHeader();
          }
        }
        
        destroy() {
          this.view.scrollDOM.removeEventListener('scroll', this.scrollHandler);
          this.dom.remove();
        }
      });

      // Extension array - theme + plugin
      const stickyScrollExtension = [
        stickyScrollTheme,
        stickyScrollPlugin,
      ];

      // Compartment management
      if (!this.stickyScrollCompartment) {
        this.stickyScrollCompartment = new CM.Compartment();
        // Install compartment (initially empty)
        this.editor.dispatch({
          effects: CM.StateEffect.appendConfig.of(
            this.stickyScrollCompartment.of([])
          )
        });
      }

      // Reconfigure based on enabled state
      this.editor.dispatch({
        effects: this.stickyScrollCompartment.reconfigure(
          enabled ? stickyScrollExtension : []
        )
      });
      
      console.log('[CodeMirror] Sticky scroll set to:', enabled);
    },
    // ============================================================================
  },
  async mounted() {
    // This is used to prevent emitting the value we just received from the server.
    this.emitting = true;

    // The Compartments are used to change the properties of the editor ("extensions") dynamically
    this.themes = { ...CM.themes, oneDark: CM.oneDark };
    this.themeConfig = new CM.Compartment();
    this.languages = CM.languages;
    this.languageConfig = new CM.Compartment();
    this.editableConfig = new CM.Compartment();
    this.editableStates = { true: CM.EditorView.editable.of(true), false: CM.EditorView.editable.of(false) };
    this.lineWrappingConfig = new CM.Compartment();

    const extensions = this.setupExtensions();

    this.editor = new CM.EditorView({
      doc: this.value,
      extensions: extensions,
      parent: this.$el,
    });

    this.resolveEditor(this.editor);

    this.setLanguage(this.language);
    this.setTheme(this.theme);
    this.setDisabled(this.disable);
    this.setLineWrapping(this.lineWrapping);
    if (typeof this.pendingFontScale === 'number') {
      this.setFontScale(this.pendingFontScale);
    }

    // Notify parent when the editor surface is interacted with (focus/click inside iframe)
    try {
      const focusHandler = () => {
        try {
          this.notifyParent('cm6-editor-focus', { focused: true });
        } catch (err) {
          console.warn('[CodeMirror] Failed to notify parent of editor focus:', err);
        }
      };
      // Track both keyboard focus and pointer interaction
      this.editor.dom.addEventListener('focusin', focusHandler);
      this.editor.dom.addEventListener('mousedown', focusHandler);
      // Stash for potential future cleanup
      this._focusHandler = focusHandler;
    } catch (err) {
      console.warn('[CodeMirror] Failed to attach editor focus handlers:', err);
    }

    // Apply initial scroll position from backend, if provided
    if (typeof this.initialScrollLine === 'number' && this.initialScrollLine > 1) {
      try {
        const doc = this.editor.state.doc;
        const maxLine = doc.lines;
        const targetLine = Math.max(1, Math.min(this.initialScrollLine, maxLine));
        const line = doc.line(targetLine);
        this.editor.dispatch({
          selection: { anchor: line.from },
          scrollIntoView: true,
        });
        console.log('[CodeMirror] Initial scroll to line', targetLine);
      } catch (err) {
        console.warn('[CodeMirror] Failed to apply initial scroll line:', err);
      }
    }
    
    // Initialize layout detection for minimap
    const mql = window.matchMedia('(max-width: 900px)');
    this.isMobileLayout = mql.matches;
    mql.addEventListener('change', this.handleLayoutChange);
    
    // Initialize diff compartments BEFORE minimap so minimap can reference diffField
    // This ensures proper dependency order - minimap needs diffField to exist
    this.initDiffCompartments();
    
    // Apply initial minimap state (now diffField exists for minimap to reference)
    this.updateMinimapState();
  },
};
