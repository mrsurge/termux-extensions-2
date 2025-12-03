# Implementing a Monaco‑Style Sticky Scroll in CodeMirror 6 (Corrected Guide)

## Overview: Sticky Headers in Code Editors

“Sticky scroll” (as introduced in VS Code’s Monaco editor) pins the current function or class signature to the top of the viewport, providing context while scrolling through a long block of code [1]. CodeMirror 6 does **not** have a built‑in sticky header feature, so we must implement it via a custom extension.

The key idea is to display a fixed header panel showing the nearest enclosing function or class name as the editor scrolls. CodeMirror’s creator notes that you **cannot** simply freeze a line in place – instead, you can overlay a separate element (e.g. a panel) at the top of the editor [2]. We’ll leverage CodeMirror 6’s extension APIs (particularly `ViewPlugin` and `showPanel`) to create this behavior.

---

## Using a Fixed Panel for the Sticky Header

CodeMirror 6 supports *panels* – UI elements rendered above or below the editor content that remain visible during scrolling [3]. We will use a top panel to display the current function/class name, ensuring it stays persistently at the top. The panel will update its content as the viewport changes.

By using CodeMirror’s panel system (via the `showPanel` facet), we integrate cleanly into the editor’s DOM without hacking external CSS. Panels occupy space in the editor’s layout and automatically stay in view when the editor scrolls [3], making them ideal for a sticky header.

**How the panel works:**

- We provide a panel constructor function that creates a DOM element (e.g. a `<div>` with a custom class like `.cm-stickyHeader`).
- This panel is added at the top of the editor (`top: true` in the panel spec).
- The panel’s DOM can be styled via a base theme extension (for example, giving it a subtle background or bold text to distinguish the context line).
- The panel object can implement an `update(update)` method that CodeMirror calls on every view update [4]. We use this to refresh the header text whenever needed.

---

## Tracking the Current Function/Class via the Syntax Tree

To determine what function or class is “currently visible,” we rely on the editor’s parsed syntax tree. CodeMirror 6’s language packs (via Lezer parsers) produce a syntax tree for the document, accessible with `syntaxTree(state)` [5]. This tree lets us find the code construct encompassing a given position.

### Strategy

1. **Identify the top of the viewport in document terms**

   - Use `view.viewport.from` (the first drawn position) as a representative position near the top of the visible area [6].
   - Alternatively, for more precision, we could:
     - Find the position at the top pixel of the editor using `view.posAtCoords`, or
     - Examine the first line block in `view.viewportLineBlocks`.
   - In practice, `view.viewport.from` is a convenient starting point (it’s an over‑approximation of the first visible position, which is fine for context purposes).

2. **Find the enclosing function or class node**

   - Using the syntax tree, we resolve the innermost syntax node at that position and then traverse up its parent chain to find a node that represents a function or class definition.
   - Lezer’s `Tree.resolveInner(pos)` method gives the deepest node covering a given position [7].
   - From there, we walk upward (`node.parent`) until we encounter a node type corresponding to a function or class.
   - We’ll need to check node type names – for example:
     - JavaScript: `"FunctionDeclaration"`, `"MethodDeclaration"`, `"ClassDeclaration"`, etc.
     - Python: `"FunctionDefinition"`, `"ClassDefinition"`, etc.
   - Each language’s Lezer grammar defines these node names. We may have to handle multiple possible node types (e.g. constructor functions or arrow functions in JS have different node labels) – but focusing on classes and named functions is a good start.

3. **Nearest vs. outermost context**

   - Typically we want the **innermost relevant scope** that’s currently active.
   - Example: Inside a method of a class, the sticky header should show the method name (and possibly the class name above it if we choose to display nested context).
   - To mimic Monaco/VS Code, you can show a **stack of context lines** (one for each level of nesting). A simple implementation might only show the deepest function or class. A more advanced approach is to collect all containing function/class nodes up to the top‑level and display each on its own line in the panel (outermost at top, innermost last), similar to VS Code’s multi‑line sticky scroll.

4. **Extracting the header text**

   - Once we have the syntax node for the function or class, we need a human‑readable label (usually the signature or name).
   - If the parse tree provides a child node for the identifier name, we could extract that token’s text.
   - A simpler approach is to grab the entire line(s) of the definition from the document text. For example:
     - Let `defNode.from` be the start position of the function definition.
     - Retrieve the line at that position via `state.doc.lineAt(defNode.from)` and use its `.text` [5].
   - Trimming indentation and perhaps truncating after the parameter list or opening brace can make it cleaner. Often, just showing the first line of the definition (e.g. `function foo(bar) {` or `class MyClass:`) is sufficient to identify the scope.
   - We update the panel’s DOM text to this line (or multi‑line stack).

5. **Handling absence of scope**

   - If the top of the viewport is not inside any function or class (e.g. in global/top‑level code), the extension can simply render nothing or hide the panel.
   - This might be done by setting the panel text to an empty string or a placeholder like `[No function]`.
   - You could also only enable the panel when a scope is present (by toggling the panel facet on and off), but it’s often acceptable to show an empty panel or hide via CSS when not in use.

---

## Building the Panel and View Logic

We’ll implement the logic as a `showPanel` panel whose `update()` responds to view updates.

### Panel constructor

```js
import {showPanel, EditorView} from "@codemirror/view";
import {syntaxTree} from "@codemirror/language";

function createStickyPanel(view) {
  const dom = document.createElement("div");
  dom.className = "cm-stickyHeader";
  dom.textContent = ""; // initial blank

  return {
    top: true,
    dom,
    update(update) {
      // Only recompute if the visible content changed or document changed
      if (!update.viewportChanged && !update.docChanged) return;

      const state = update.state;
      const pos = view.viewport.from; // representative top-of-viewport position

      const tree = syntaxTree(state); // current parse tree
      let scopeName = "";

      if (tree) {
        // Find enclosing function/class nodes for `pos`
        let node = tree.resolveInner(pos);
        const scopes = [];

        for (; node; node = node.parent) {
          const name = node.name;
          if (
            name === "FunctionDeclaration" ||
            name === "FunctionDefinition" ||
            name === "MethodDeclaration"   ||
            name === "ClassDeclaration"    ||
            name === "ClassDefinition"
          ) {
            scopes.push(node);
          }
        }

        if (scopes.length) {
          // Use innermost scope for a single-line header
          const defNode = scopes[scopes.length - 1];
          const defLine = state.doc.lineAt(defNode.from);

          // Avoid duplicating the definition if it's still visible in the viewport
          const vp = view.viewport;
          const defIsFullyAbove = defLine.to <= vp.from;

          if (defIsFullyAbove) {
            scopeName = defLine.text.trim();
          } else {
            // definition line is still visible; don't show a sticky header
            scopeName = "";
          }

          // Alternatively, build a multi-line context:
          // const contextLines = scopes
          //   .map(n => state.doc.lineAt(n.from).text.trim());
          // scopeName = defIsFullyAbove ? contextLines.join(" / ") : "";
        }
      }

      dom.textContent = scopeName;
    },
  };
}

export const stickyHeaderPanel = showPanel.of(createStickyPanel);
```

This uses `view.viewport.from` as the scroll reference and the syntax tree to derive the current scope. We also explicitly avoid showing a header if the definition line is still visible in the viewport to reduce duplication.

---

## Handling Parsing and Large Files

Because we query the syntax tree when the viewport changes, performance is a concern with very large files. CodeMirror’s incremental parsing makes tree queries quite fast, and by using `viewportChanged` we limit updates to when needed.

However, the syntax tree may not be immediately available for code far outside the viewport – the parser runs incrementally and may stop after parsing the visible region plus some margin.

### Ensuring the tree exists where we need it

The language package gives you helpers to deal with this:

```js
import {syntaxTree, ensureSyntaxTree, syntaxTreeAvailable, forceParsing} from "@codemirror/language";

// In your update handler, for example:
if (!syntaxTreeAvailable(state, pos)) {
  // Try to make sure parsing reaches at least the end of the viewport
  ensureSyntaxTree(state, view.viewport.to);
  // Or, if you have access to the view here:
  forceParsing(view, view.viewport.to);
}
```

Notes:

- `syntaxTree(state)` returns the current (possibly partial) tree.
- `syntaxTreeAvailable(state, pos)` lets you check whether a given position is fully parsed.
- `ensureSyntaxTree(state, upto, timeout?)` parses up to a given position on demand.
- `forceParsing(view, upto?, timeout?)` is a helper that drives parsing based on the current view.

In most cases, slowly scrolling through a file keeps the tree ahead of you and you won’t need explicit forcing. It’s mainly useful when the user jumps deep into a file via “Go to Definition” or similar.

---

## Line Wrapping Considerations

With word‑wrap enabled, a single logical line can occupy multiple visual lines. It’s possible that the start of a long function signature is scrolled off while the tail end of that same line is still visible. In such a scenario, you might momentarily see the sticky header duplicating the line’s content.

To refine this, you can detect partial visibility of the definition line using line blocks:

```js
const block = view.lineBlockAt(defNode.from);
const scrollTop = view.scrollDOM.scrollTop;
const blockTop = block.top;
const blockBottom = block.bottom;

// Example heuristic: only treat it as fully off-screen when its bottom is above scrollTop
const fullyOffscreen = blockBottom <= scrollTop;
```

You can combine this with the earlier check so that the sticky header appears only when the function line is truly off the top of the scroll area.

Even if you don’t handle this edge perfectly, the feature will still be usable; a brief overlap is usually not critical.

---

## Styling and Z‑Index

Define a base theme to style the panel:

```js
const stickyHeaderTheme = EditorView.baseTheme({
  ".cm-stickyHeader": {
    backgroundColor: "#f0f0f0",
    fontWeight: "bold",
    padding: "2px 4px",
    borderBottom: "1px solid #ccc",
  },
});
```

Then include `stickyHeaderTheme` alongside the panel extension:

```js
const stickyHeaderExtension = [stickyHeaderTheme, stickyHeaderPanel];
```

Panels live within the editor’s own DOM and are stacked vertically with other panels (like search bars) in the order they are added. If your editor has multiple top panels, you may need to control their ordering by where you place `stickyHeaderPanel` in the extension list.

Gutters (line numbers, diff markers, etc.) are independent of panels; they remain visually aligned with the code while the sticky header sits above the content area.

---

## Integration with NiceGUI’s CM6 Setup

Since the editor is embedded via NiceGUI’s `ui.codemirror` (with CodeMirror 6 vendored), we need to integrate our extension into that system.

NiceGUI’s vendored CodeMirror typically instantiates the editor with a base extension list (language, theme, line numbers, diff and minimap extensions, etc.). It also uses `Compartment`s for togglable features.

### 1. Compartment‑based toggling

Inside your vendored `codemirror.js` (or equivalent), create a compartment for the sticky header:

```js
import * as CM from "@codemirror/state";
import {stickyHeaderExtension} from "./sticky_header_extension"; // where you defined it

const stickyHeaderCompartment = new CM.Compartment();

const baseExtensions = [
  // ... existing extensions
  stickyHeaderCompartment.of([]), // initially disabled
];

export function setStickyHeader(view, enabled) {
  view.dispatch({
    effects: stickyHeaderCompartment.reconfigure(
      enabled ? stickyHeaderExtension : [],
    ),
  });
}
```

From the NiceGUI Python side (`codemirror.py`), you can expose a method that calls `setStickyHeader(view, bool)` via `run_method`. That aligns with how other dynamic options (minimap, line wrapping, diff gutters, etc.) are already wired in your framework.

### 2. Always‑on inclusion

If you prefer sticky headers always enabled, simply include `stickyHeaderExtension` in the base extension list instead of a compartment. You can still later refactor it behind a compartment if you want user‑configurable behavior.

### 3. Iframe/container concerns

Because the sticky header is a CodeMirror panel inside the editor’s own DOM, it is not affected by outer scroll containers or iframes beyond the editor’s bounding box. As long as the editor widget itself has an internal scroll area (standard CM6 behavior), the sticky panel will remain at the top of that internal scroll area.

---

## Scroll, Virtualization, and Wrapping Recap

This implementation uses CM6‑native techniques – a panel plus syntax tree analysis – rather than general webpage scroll tricks. We’re not altering the browser’s scroll behavior or using `position: sticky` on actual code lines (which doesn’t interact correctly with the editor’s virtualization).

Instead, we rely on CodeMirror’s own update cycle and parsing:

- **Scroll position awareness**
  - By listening to view updates (especially the `viewportChanged` flag), we know when the user scrolls [10].
  - No direct DOM `scroll` listener is required, though you *can* attach to `view.scrollDOM` if absolutely needed.

- **Virtual rendering**
  - CodeMirror only renders the visible lines plus a margin.
  - Our logic uses the parse tree, which represents the document structure independent of what is currently rendered.
  - We can ensure the tree is available near the viewport using `syntaxTreeAvailable` and `ensureSyntaxTree` / `forceParsing` as needed.

- **Line wrapping**
  - Wrapping can cause partial visibility of long lines, so a bit of duplication is possible.
  - Optional block‑geometry checks (via `view.lineBlockAt`) can further reduce duplicates.

By composing this sticky header extension with your existing CM6 configuration (minimap, diff gutters, draft diff overlays, etc.), you get a Monaco‑style “sticky scroll” feature without leaving CodeMirror. From a user’s perspective, the behavior closely matches VS Code’s sticky scroll, while remaining compatible with your NiceGUI + iframe + backend‑driven architecture.

---

## Sources

1. **Sticky Scroll · Issue #5341 · ajaxorg/ace · GitHub**  
   https://github.com/ajaxorg/ace/issues/5341
2. **Sticky top line that stays fixed/frozen vertically at the top of the view? – v6 – discuss.CodeMirror**  
   https://discuss.codemirror.net/t/sticky-top-line-that-stays-fixed-frozen-vertically-at-the-top-of-the-view/8813
3. **CodeMirror Panel Example**  
   https://codemirror.net/examples/panel/
4. **CodeMirror Reference Manual**  
   https://codemirror.net/docs/ref/
5. **Given lezer parse tree and cursor location, retrieve node? – discuss.CodeMirror**  
   https://discuss.codemirror.net/t/given-lezer-parse-tree-and-cursor-location-retrieve-node/5294
6. **extend/overlay mode – v6 – discuss.CodeMirror**  
   https://discuss.codemirror.net/t/extend-overlay-mode/2818
7. **Lezer Tree API – CodeMirror / Lezer docs**  
   https://lezer.codemirror.net/docs/ref/#tree.Tree.resolveInner
8. **ViewPlugin / ViewUpdate – CodeMirror docs**  
   https://codemirror.net/docs/ref/#view.ViewPlugin
9. **Viewport updates and virtualization – CodeMirror docs**  
   https://codemirror.net/docs/ref/#view.ViewUpdate.viewportChanged
10. **scrollDOM / lineBlockAt – CodeMirror view API**  
    https://codemirror.net/docs/ref/#view.EditorView.lineBlockAt
11. **syntaxTreeAvailable / ensureSyntaxTree / forceParsing – @codemirror/language**  
    https://codemirror.net/docs/ref/#language
12. **termux-extensions-2 CodeMirror vendor (codemirror.js)**  
    https://github.com/mrsurge/termux-extensions-2/blob/main/app/static/vendor/nicegui/elements/codemirror/codemirror.js

