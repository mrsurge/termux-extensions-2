// zebra_runtime.js
console.log('[ZebraRuntime] Loaded (Global Mode).');

// This function will be called directly from Python
window.applyZebra = async (enabled) => {
  // Relies on the modified NiceGUI component to set this global variable
  const view = window.theEditorView;

  if (!view) {
    console.error('[ZebraRuntime] window.theEditorView not found. Is the editor ready?');
    return;
  }
  console.log(`[ZebraRuntime] Applying zebra stripes: ${enabled}`);

  // Define and install the extension on first run
  if (!window.__zebraCompartment) {
    try {
      const [viewMod, stateMod] = await Promise.all([
        import('https://esm.sh/@codemirror/view@6'),
        import('https://esm.sh/@codemirror/state@6'),
      ]);
      const { EditorView, Decoration, ViewPlugin } = viewMod;
      const { Facet, RangeSetBuilder, StateEffect, Compartment } = stateMod;

      window.__zebraCompartment = new Compartment();

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

      window.__zebraExtensions = [baseTheme, stepSize.of(2), zebraPlugin];
      
      view.dispatch({
        effects: StateEffect.appendConfig.of(window.__zebraCompartment.of([]))
      });
      console.log('[ZebraRuntime] Compartment installed.');

    } catch (e) {
      console.error('[ZebraRuntime] Failed to initialize CM6 modules:', e);
      return;
    }
  }

  const extensions = enabled ? window.__zebraExtensions : [];
  view.dispatch({
    effects: window.__zebraCompartment.reconfigure(extensions)
  });
};
