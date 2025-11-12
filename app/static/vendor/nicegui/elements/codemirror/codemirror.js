import * as CM from "nicegui-codemirror";

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
    };
  },
  methods: {
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
      // Initialize diff compartment on first call
      if (!this.diffCompartment) {
        const { EditorView, Decoration, ViewPlugin, WidgetType } = CM;
        const { StateEffect, Compartment, RangeSetBuilder } = CM;
        
        this.diffCompartment = new Compartment();
        
        // Widget for displaying deleted lines
        class RemovedLineWidget extends WidgetType {
          constructor(lines) {
            super();
            this.lines = lines;
          }
          toDOM() {
            const wrap = document.createElement('div');
            wrap.className = 'cm-diff-removed';
            for (const line of this.lines) {
              const lineEl = document.createElement('div');
              lineEl.className = 'cm-diff-removed-line';
              lineEl.textContent = line.text || '';
              wrap.appendChild(lineEl);
            }
            return wrap;
          }
        }
        
        // Store for later use
        this.RemovedLineWidget = RemovedLineWidget;
        this.diffDecorationTypes = {
          addedLine: Decoration.line({ attributes: { class: 'cm-diff-line-added' } }),
        };
        
        // Install empty compartment
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.diffCompartment.of([]))
        });
      }
      
      // Build decorations from hunks
      const decorations = [];
      if (hunks && hunks.length > 0) {
        for (const hunk of hunks) {
          const newStart = hunk.newStart || 0;
          
          // Find added and deleted lines
          const addedLines = [];
          const deletedLines = [];
          if (hunk.lines) {
            for (const line of hunk.lines) {
              if (line.type === 'add') addedLines.push(line);
              else if (line.type === 'del') deletedLines.push(line);
            }
          }
          
          // Add line decorations for additions
          for (let i = 0; i < addedLines.length; i++) {
            const lineNum = newStart + i;
            if (lineNum > 0 && lineNum <= this.editor.state.doc.lines) {
              const line = this.editor.state.doc.line(lineNum);
              decorations.push(this.diffDecorationTypes.addedLine.range(line.from));
            }
          }
          
          // Add widget for deletions (before the first added line or at newStart)
          if (deletedLines.length > 0) {
            const insertAt = newStart > 0 && newStart <= this.editor.state.doc.lines
              ? this.editor.state.doc.line(newStart).from
              : 0;
            const widget = Decoration.widget({
              widget: new this.RemovedLineWidget(deletedLines),
              side: -1,
              block: true
            });
            decorations.push(widget.range(insertAt));
          }
        }
      }
      
      // Build the decoration set
      const { RangeSetBuilder } = CM;
      decorations.sort((a, b) => a.from - b.from);
      const builder = new RangeSetBuilder();
      for (const deco of decorations) {
        builder.add(deco.from, deco.from, deco.value);
      }
      const decoSet = builder.finish();
      
      // Create a ViewPlugin that provides these decorations
      const { ViewPlugin } = CM;
      const diffPlugin = ViewPlugin.fromClass(class {
        constructor() {
          this.decorations = decoSet;
        }
      }, { decorations: v => v.decorations });
      
      // Reconfigure compartment with the plugin
      this.editor.dispatch({
        effects: this.diffCompartment.reconfigure(decoSet.size > 0 ? [diffPlugin] : [])
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
          update(update) {
            if (!update.docChanged) return;
            if (!self.emitting) return;
            self.$emit("update:value", update.changes);
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
  },
};
