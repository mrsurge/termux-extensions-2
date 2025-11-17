import * as CM from "nicegui-codemirror";

const searchExtension = typeof CM.search === 'function' ? CM.search : null;
const searchKeymap = Array.isArray(CM.searchKeymap) ? CM.searchKeymap : null;
const highlightSelectionMatches = typeof CM.highlightSelectionMatches === 'function' ? CM.highlightSelectionMatches : null;
const openSearchPanel = typeof CM.openSearchPanel === 'function' ? CM.openSearchPanel : null;
const indentationMarkers = typeof CM.indentationMarkers === 'function' ? CM.indentationMarkers : null;

// Inline diff decorations helper (extracted from diff_decorations.js)
function buildDiffDecorations(view, hunks, CM, getWordWrap) {
  const { Decoration, RangeSetBuilder, WidgetType } = CM;
  
  if (!hunks || hunks.length === 0) {
    return Decoration.none;
  }

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

  const wordWrap = getWordWrap();
  const builder = new RangeSetBuilder();
  const doc = view.state.doc;
  
  console.log('[buildDiffDecorations] Doc has', doc.lines, 'lines');
  
  const lineDecorations = new Map();
  const deletionWidgets = [];
  
  for (const hunk of hunks) {
    let newLine = Math.max(1, hunk.newStart || 1);
    console.log('[buildDiffDecorations] Processing hunk, newStart:', hunk.newStart, 'lines:', hunk.lines?.length);
    for (const line of hunk.lines || []) {
      const kind = line.type;
      console.log('[buildDiffDecorations]   Line type:', kind, 'newLine:', newLine, 'text:', line.text?.substring(0, 30));
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
  
  console.log('[buildDiffDecorations] Line decorations:', Array.from(lineDecorations.keys()));
  console.log('[buildDiffDecorations] Deletion widgets:', deletionWidgets.map(w => `line ${w.line}: ${w.text.substring(0, 20)}`));
  
  deletionWidgets.sort((a, b) => a.line - b.line);
  
  let widgetIndex = 0;
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const lineInfo = safeLine(doc, lineNum);
    if (!lineInfo) continue;
    
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
    
    while (widgetIndex < deletionWidgets.length && deletionWidgets[widgetIndex].line === lineNum) {
      const widget = deletionWidgets[widgetIndex];
      builder.add(lineInfo.from, lineInfo.from, Decoration.widget({
        side: -1,
        block: true,
        widget: new RemovedLineWidget(widget.text, wordWrap),
      }));
      widgetIndex++;
    }
    
    builder.add(lineInfo.from, lineInfo.from, linePlainDeco);
    
    if (lineDecorations.has(lineNum)) {
      builder.add(lineInfo.from, lineInfo.from, lineDecorations.get(lineNum));
    }
  }
  
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

export default {
  template: `
    <div></div>
  `,
  props: {
    value: String,
    language: String,
    theme: String,
    lineWrapping: Boolean,
    disable: Boolean,
    indent: String,
    highlightWhitespace: Boolean,
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
  },
  data() {
    return {
      // To let other methods wait for the editor to be created because
      // they might be called by the server before the editor is created.
      editorPromise: new Promise((resolve) => {
        this.resolveEditor = resolve;
      }),
      pendingFontScale: 1,
    };
  },
  methods: {
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

      console.error(`Language not found: ${this.language}`);
      console.info("Supported language names:", languages.map((lang) => lang.name).join(", "));
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
        this.editor.dispatch({
          effects: this.languageConfig.reconfigure([]),
        });
        return;
      }

      const lang_description = this.findLanguage(language, this.languages);
      if (!lang_description) {
        console.error("Language not found:", language);
        return;
      }

      lang_description.load().then((extension) => {
        this.editor.dispatch({
          effects: this.languageConfig.reconfigure([extension]),
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
    setTheme(theme) {
      const new_theme = this.themes[theme];
      if (new_theme === undefined) {
        console.error("Theme not found:", theme);
        return;
      }
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
      const { EditorView, StateEffect, Compartment } = CM;
      const parsed = Number(scale);
      const clamped = Math.min(2, Math.max(0.5, isNaN(parsed) ? 1 : parsed));
      this.pendingFontScale = clamped;
      if (!this.editor) return;

      if (!this.fontSizeCompartment) {
        this.fontSizeCompartment = new Compartment();
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.fontSizeCompartment.of([])),
        });
      }

      const fontTheme = EditorView.theme({
        "&": {
          fontSize: `${clamped * 100}%`,
          lineHeight: "1.45",
        },
        "& .cm-content, & .cm-line": {
          fontSize: "inherit",
          lineHeight: "inherit",
        },
      });

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
              light: '#8B7355',    // darker muted tan for inactive guides
              dark: '#8B7355',     // darker muted tan for inactive guides
              activeLight: '#A0826D',  // medium tan for active block
              activeDark: '#A0826D'    // medium tan for active block
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
    async applyDiffDecorations(hunks) {
      console.log('[applyDiffDecorations] Called with hunks:', JSON.stringify(hunks, null, 2));
      console.log('[applyDiffDecorations] Doc has', this.editor?.state?.doc?.lines, 'lines');
      
      // Initialize diff compartment on first call
      if (!this.diffCompartment) {
        const { StateEffect, StateField, Compartment } = CM;
        
        this.diffCompartment = new Compartment();
        this.setDiffEffect = StateEffect.define();
        this.clearDiffEffect = StateEffect.define();
        
        // Capture effects for use in the field
        const setDiffEffect = this.setDiffEffect;
        const clearDiffEffect = this.clearDiffEffect;
        
        // Create a StateField to hold diff decorations
        const diffField = StateField.define({
          create() {
            return CM.Decoration.none;
          },
          update(value, tr) {
            // Map decorations through document changes
            if (tr.docChanged && value !== CM.Decoration.none) {
              value = value.map(tr.changes);
            }
            // Apply effects
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
        
        // Store the field for effects
        this.diffField = diffField;
        
        // Install the compartment with the field
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.diffCompartment.of([diffField]))
        });
      }
      
      // Build decorations using the proven helper function
      const getWordWrap = () => this.lineWrapping || false;
      console.log('[applyDiffDecorations] Building decorations, wordWrap:', getWordWrap());
      const decoSet = buildDiffDecorations(this.editor, hunks, CM, getWordWrap);
      console.log('[applyDiffDecorations] Built', decoSet.size, 'decorations');
      
      // Dispatch the decoration update via effect
      this.editor.dispatch({
        effects: this.setDiffEffect.of(decoSet)
      });
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

      const extensions = [
        CM.basicSetup,
        changeSender,
        // Enables the Tab key to indent the current lines https://codemirror.net/examples/tab/
        CM.keymap.of([CM.indentWithTab]),
        // Sets indentation https://codemirror.net/docs/ref/#language.indentUnit
        CM.indentUnit.of(this.indent),
        // We will set these Compartments later and dynamically through props
        this.themeConfig.of([]),
        this.languageConfig.of([]),
        this.editableConfig.of([]),
        this.lineWrappingConfig.of([]),
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

      return extensions;
    },
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
  },
};
