You’re right: *your* CM6 code already knows how to “stack scopes at the top.” The missing piece vs Monaco is **where the `n+1` lives in Monaco’s math** and how to port *that* into your plugin.

I’ll give you exactly that:

---

## 1. Where Monaco hides the `n+1`

### 1.1 Provider: pre-computing the “slot top” (`top`) per sticky line

In Monaco, the `StickyScrollProvider` walks the outline tree and, for every candidate sticky line, it stores:

* `startLineNumber`
* `endLineNumber`
* `top`  ⬅️ **this is the per-row vertical slot**
* `height` (line height)

As it recurses, it calls itself with `top + lineHeight`, so every deeper / lower row gets a larger `top`:

* Row 0 → `top = 0`
* Row 1 → `top = 1 * lineHeight`
* Row 2 → `top = 2 * lineHeight`
* etc.

That `top` is *not* document space. It’s **overlay space**: “if this candidate ends up in sticky row `n`, draw it starting at `top = n * lineHeight`”.

So `top` is literally your “virtual slot index” times line height — the `n` in your `n+1` write-up.

### 1.2 Controller: intersecting slot `top` with real scope geometry

In `StickyScrollController.findScrollWidgetState`, Monaco then takes each candidate (with `top` and `height`) and compares it to the *real* layout from the editor:

Conceptually:

```ts
const topOfElement   = candidate.top;             // overlay slot Y (0, H, 2H, …)
const bottomOfElement = topOfElement + candidate.height;

const topOfBeginningLine  = getTopForLineNumber(start) - scrollTop;
const bottomOfEndLine     = getBottomForLineNumber(end) - scrollTop;

// "Does this scope cover this horizontal slot in the viewport?"
if (topOfElement > topOfBeginningLine &&
    topOfElement <= bottomOfEndLine) {
    // this candidate fills this sticky row
}
```

Interpretation:

* `[topOfBeginningLine, bottomOfEndLine]` = **actual vertical interval** of the scope in *viewport coordinates*.
* `topOfElement` = **sample point inside the sticky overlay**: row 0 = 0px, row 1 = 1 line, row 2 = 2 lines, etc.

So:

> “Scope X belongs in sticky row `n` if the horizontal line at `y = n * lineHeight` lies inside that scope’s vertical interval.”

If you rewrite that assuming uniform line height `H` and `topLine = scrollTop/H`, this condition is equivalent to:

* `startLine < topLine + n + 1`
* and `topLine + n` is still before the end of the scope

which is exactly your **“depth-aware early capture: `n + 1` lines ahead of the raw topLine”** story.

### 1.3 Push-up / compression at the bottom

Monaco also computes a `lastLineRelativePosition`:

```ts
if (bottomOfElement > bottomOfEndLine) {
    lastLineRelativePosition = bottomOfEndLine - bottomOfElement; // ≤ 0
}
```

Then the widget uses `top + lastLineRelativePosition` as its effective height, sliding the stack up when the innermost scope’s end is about to collide with it.

You already have a CM6 analogue of this in your `topOffset` / `stackBottom` logic, so the *core* missing part isn’t compression — it’s the **slot-based intersection using `top`**.

---

## 2. What your CM6 implementation is doing instead

In your current `stickyScrollPlugin.updateStickyHeader`, once you have `ancestorNodes`, you’re picking active scopes with a simple “header has scrolled above top of viewport” rule:

```js
const refLine = state.doc.lineAt(refPos).number;

const MAX_STICKY_LINES = 5;
const activeScopes = [];
for (const n of ancestorNodes) {
  const startLine = state.doc.lineAt(n.from).number;
  const endLine   = state.doc.lineAt(n.to).number;
  if (startLine < refLine) {
    activeScopes.push({
      node: n,
      startLine,
      endLine,
      text: state.doc.lineAt(n.from).text,
    });
  }
}
```

That’s exactly the “stateless topLine only” algorithm you described in `tmp22.md`:

* It only knows `startLine` vs `refLine`.
* It **never** looks at “slot `n` has its own vertical position `top = n * lineHeight`”.
* So every depth uses the *same* trigger condition, and the overlay height never feeds back into the geometry.

This is why you’re stuck in the “underscroll vs janky hacks” trade-off you spelled out in that doc.

---

## 3. Porting Monaco’s `n+1` into your CM6 plugin

You don’t need OutlineModel or Monaco’s types — you already have the ancestors and CM6’s layout info. You just need to **recreate the same intersection test using a synthetic `slotTop = depth * lineHeight`**.

### 3.1 Replace your `activeScopes` selection with a slot-based intersection

Inside `updateStickyHeader`, **after** you build `ancestorNodes` and **before** you render DOM, replace your current `activeScopes` loop with something like this:

```js
// 3) Slot-based selection à la Monaco: each depth gets its own "slotTop"
const lineHeight = view.defaultLineHeight || 16;
const MAX_STICKY_LINES = 5;
const activeScopes = [];

ancestorNodes.forEach((n, depth) => {
  if (activeScopes.length >= MAX_STICKY_LINES) return;

  const startLine = state.doc.lineAt(n.from).number;
  const endLine   = state.doc.lineAt(n.to).number;

  // Map scope start/end to block geometry in *document space*
  const startPos   = state.doc.line(startLine).from;
  const endPos     = state.doc.line(endLine).to;
  const startBlock = view.lineBlockAt(startPos);
  const endBlock   = view.lineBlockAt(endPos);

  // Convert to *viewport* coordinates by subtracting scrollTop
  const topOfBeginningLine = startBlock.top   - scrollTop;
  const bottomOfEndLine    = endBlock.bottom - scrollTop;

  // This is the Monaco "top" field: overlay slot Y for this depth
  const slotTop = depth * lineHeight;

  // Monaco-style test:
  //   "Does this scope cover the horizontal slice at y = slotTop?"
  if (slotTop > topOfBeginningLine && slotTop <= bottomOfEndLine) {
    activeScopes.push({
      node: n,
      startLine,
      endLine,
      text: state.doc.lineAt(n.from).text,
      // you can keep these for debug if you want:
      slotTop,
      bottomOfEndLine,
    });
  }
});
```

Key points:

* `slotTop = depth * lineHeight` is your **`n`** (how far down in overlay space this row is).
* The inequality `slotTop > topOfBeginningLine && slotTop <= bottomOfEndLine` is Monaco’s **“is this scope covering this slot?”** check, which algebraically becomes your `n+1` virtual viewport logic.
* No more naïve `startLine < refLine` — the trigger is now “horizontal slice intersection,” not “header offscreen.”

Everything else in your function can stay almost as is.

### 3.2 Keep your existing “push-up” logic as the Monaco `lastLineRelativePosition` analogue

You already compute a `topOffset` based on the innermost scope’s bottom vs `stackBottom` (scrollTop + headerHeight):

```js
const innermost = activeScopes[activeScopes.length - 1];
const measuredHeight = this.dom.offsetHeight || 0;
const idealHeight = activeScopes.length * lineHeight;
const headerHeight =
  measuredHeight && Math.abs(measuredHeight - idealHeight) < lineHeight
    ? measuredHeight
    : idealHeight;

let topOffset = 0;
try {
  const endLineBlock = view.lineBlockAt(innermost.node.to);
  const endLineBottom = endLineBlock.bottom;
  const stackBottom = scrollTop + headerHeight;
  if (endLineBottom < stackBottom) {
    topOffset = endLineBottom - stackBottom;   // ≤ 0
  }
} catch (e) {}
this.dom.style.top = `${topOffset}px`;
```

That’s functionally the same as Monaco’s `lastLineRelativePosition` adjustment: when the bottom of the innermost scope is above the bottom of the sticky stack, you shift the overlay up so it feels “pinned” to the end of the scope instead of overlapping it.

You don’t need to change this to get `n+1`; the crucial difference is **how you pick `activeScopes`**.

---

## 4. Summary in your terms

* Monaco’s fix for the `n+1` problem is **not** a magic constant; it’s:

  * `top` per candidate = “where this row would live in the overlay if it’s shown”.
  * An intersection test that asks: *“Is the horizontal line at `top` inside this scope’s vertical range in the viewport?”*
* Your CM6 code so far only does “`startLine < refLine`”, i.e., “has this header scrolled past the raw topLine?” — exactly the stateless logic you warned about in `tmp22.md`.
* Porting Monaco’s behavior = **compute `slotTop = depth * lineHeight` and run the same intersection test in CM6 space**, then keep your existing compression logic.

If you drop that block into your `updateStickyHeader` where the current `activeScopes` loop is, you’ll literally be doing what Monaco does for the `n+1` dynamic, just with CM6’s `lineBlockAt` instead of `getTopForLineNumber`.


_circuitScribe_ *new te2 contributor* 12-3-2025