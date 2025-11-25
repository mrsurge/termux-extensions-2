Pattern is:

1. **Tag your diff decorations/widgets with metadata** (`spec.diffKind = "insert" | "delete"`).
2. **Scan the diff DecorationSet** to collect line numbers for each kind.
3. **Convert those into minimap `gutters` maps** (one gutter for inserts, one for deletes).
4. Plug those gutters into `showMinimap.compute`.

That’s it. Everything else is plumbing.

---

## 1. Tag the diff decorations

Where you build your diff decorations now (mark decorations for insertions, widget decorations for inline deletions), give them a `spec.diffKind` field so we can recognize them later. CM6 explicitly allows arbitrary metadata on `spec`. ([CodeMirror][1])

Roughly:

```ts
// Inserted text (mark decoration)
const insertDecoration = Decoration.mark({
  class: "cm-diff-insert",
  // custom metadata:
  diffKind: "insert",
});

// Inline deletion widget
class DeletionWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-diff-delete-widget";
    span.textContent = this.text;
    return span;
  }
}

const deleteWidgetDecoration = Decoration.widget({
  widget: new DeletionWidget("…"),
  side: 1,
  // custom metadata:
  diffKind: "delete",
});
```

All of these end up in your existing `DecorationSet` (probably stored in a `StateField` that drives your diff view). ([CodeMirror][2])

---

## 2. Collect “insert” vs “delete” lines from the DecorationSet

Given a diff `StateField<DecorationSet>` (call it `diffField`), you can iterate all ranges/widgets in it with `.between`. That’s the recommended pattern for inspecting a `DecorationSet`. ([discuss.CodeMirror][3])

```ts
import { EditorState } from "@codemirror/state";
import { DecorationSet } from "@codemirror/view"; // just for types

// diffField: your existing StateField<DecorationSet> used for diff decorations
// state.field(diffField) gives the DecorationSet

function diffMinimapGuttersFromDecorations(
  state: EditorState,
  diffField: any, // StateField<DecorationSet>
) {
  const decos: DecorationSet | undefined = state.field(diffField, false);
  if (!decos) return [];

  const insertLines: Record<number, string> = {};
  const deleteLines: Record<number, string> = {};

  decos.between(0, state.doc.length, (from, to, deco) => {
    const kind = (deco.spec && deco.spec.diffKind) as
      | "insert"
      | "delete"
      | undefined;
    if (!kind) return;

    // Map this decoration/widget to line numbers in the *current* doc
    const lineFrom = state.doc.lineAt(from).number;
    const lineTo = state.doc.lineAt(to).number;

    for (let line = lineFrom; line <= lineTo; line++) {
      if (kind === "insert") {
        // “decoration markers”
        insertLines[line] = "#18c95b"; // green-ish
      } else if (kind === "delete") {
        // “widget markers” for inline deletions
        deleteLines[line] = "#ff4b6e"; // red-ish
      }
    }
  });

  const gutters: Array<Record<number, string>> = [];
  if (Object.keys(insertLines).length) gutters.push(insertLines);
  if (Object.keys(deleteLines).length) gutters.push(deleteLines);
  return gutters;
}
```

Notes:

* **Insertions** and **inline deletions** are treated the same structurally: they’re both decorations, but we distinguish them via `spec.diffKind`.
* For a widget (inline deletion), `from === to` but `lineAt(from)` still gives you the line where the widget lives.

This is O(#diff-decorations), not O(#lines), and uses CM6’s normal `DecorationSet.between` API. ([discuss.CodeMirror][3])

---

## 3. Feed those line sets into the minimap `gutters`

Now wire that into your existing minimap config. From the minimap README, `gutters` is:

```ts
/**
 * gutters?: Array<Record<number, string>>
 * Where `number` is line number, and `string` is a color
 */
```

([GitHub][4])

So in your `showMinimap.compute` call (inside `applyMinimapMode` that we talked about earlier), you change it from:

```ts
showMinimap.compute(["doc"], (state) => ({
  create,
  displayText: "blocks",
  showOverlay: "always",
  gutters: [], // previously
}));
```

to:

```ts
showMinimap.compute(["doc"], (state) => {
  const isMobile = mode === "mobile";

  const gutters = diffMinimapGuttersFromDecorations(state, diffField);

  return {
    create,
    displayText: "blocks",
    showOverlay: isMobile ? "always" : "mouse-over",
    gutters, // [insertLines, deleteLines]
  };
});
```

If you also have **breakpoint markers** or other line-level markers, you can merge them:

```ts
const diffGutters = diffMinimapGuttersFromDecorations(state, diffField);
const breakpointGutter: Record<number, string> = collectBreakpointLines(state);
// e.g. yellow for breakpoints

const gutters = [
  breakpointGutter,
  ...diffGutters, // insert + delete
];
```

Each object in the array becomes one minimap gutter column; lines that have both inserts and deletes will show both colors (side-by-side ticks).

---

## 4. How this maps to your terms

> “decoration markers” for insertions

Those are your **mark / line** diff decorations tagged with `spec.diffKind = "insert"`, collected into `insertLines` → first minimap gutter.

> “widget markers” inline deletions

Those are your **inline widgets** used to show deleted content, tagged with `spec.diffKind = "delete"`, collected into `deleteLines` → second minimap gutter.

As long as both your mark decorations and widget decorations carry that `diffKind` metadata, the aggregation function above doesn’t care how they render in the main editor; it only cares “what line(s) does this diff thing touch?” and turns that into colored line markers in the minimap.

(maintainers note.... 
getting this error in the console:
```console-message
VM1271 nicegui.js:354 reloading because handshake failed for clientId d88437c7-227e-4b26-8477-e08148bf21f4
```
to be delt with later... only experiencing on remote device... may be becase of edge case testing issues)

[1]: https://codemirror.net/docs/ref/ "Reference Manual"
[2]: https://codemirror.net/examples/decoration/ "Example: Decorations"
[3]: https://discuss.codemirror.net/t/how-to-get-all-markers-on-a-editor/ "How to get all markers on a Editor? - v6"
[4]: https://github.com/replit/codemirror-minimap "GitHub - replit/codemirror-minimap: Minimap extension for Codemirror 6"
