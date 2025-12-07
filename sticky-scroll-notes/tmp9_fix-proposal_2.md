Yeah, I get exactly why you’re doing the `n+1` thing now, especially with the Replit minimap logic in mind:

* Base minimap logic only “captures” a line once it is fully pushed off the top.
* You fixed that by triggering **one line early** (so it’s captured while still visible).
* Sticky overlay adds a *new* hidden band equal to its own height (`n` lines), so you need the trigger point to move down by **`n` lines of height + 1 extra line** → that’s the `n+1` formula.

Right now your plugin is *almost* doing that, but the way you’re using `displayedCount` is what breaks nested scopes.

Let me show you exactly where and how to fix it.

---

## Where it’s going wrong

From your current `applyStickyScroll` plugin: 

```js
// Trigger offset...
const lineHeight = view.defaultLineHeight;

// How many scopes are currently displayed from previous render
const displayedCount = this.currentScopes.length;

// Filter: only show scopes whose definition line is above viewport (with offset)
const filteredScopes = [];
for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);
    // For scope at index i:
    // - If i < displayedCount, it was already shown, use (i + 1) offset
    // - If i >= displayedCount, it's new, use (displayedCount + 1) offset
    const levelOffset = Math.min(i, displayedCount) + 1;
    const triggerOffset = levelOffset * lineHeight;
    
    if (defBlock.bottom <= scrollTop + triggerOffset) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes.push({
        node: scopeNode,
        lineText: defLine.text
      });
    }
  } catch {}
}
```

### Problem 1: deeper scopes share the same trigger

Say last frame you were showing only the top-level scope:

* `displayedCount = 1`
* scopes (outer → inner):

  * `i = 0` → top-level
  * `i = 1` → nested #1
  * `i = 2` → nested #2

`levelOffset = Math.min(i, displayedCount) + 1` gives you:

* `i = 0` → `min(0,1)+1 = 1` (OK)
* `i = 1` → `min(1,1)+1 = 2` (OK: second scope uses `2 * lineHeight`)
* `i = 2` → `min(2,1)+1 = 2` (**not** OK; third scope also uses `2 * lineHeight`, not `3 * lineHeight`)

So anything deeper than the previously-shown count is using the **same trigger height**, not its own “`n+1` line” band. That’s why deeper levels feel “late” or inconsistent.

### Problem 2: trigger isn’t tied to overlay growth *this frame*

You’re keying offsets off the *previous* `this.currentScopes.length`, but the actual overlay height this frame is determined by how many scopes you decide to show **in this pass**.

What you really want is:

* Start with `n = 0` (overlay covers 0 lines).
* For each ancestor scope (outer → inner):

  * trigger when the scope’s definition has moved above `scrollTop + (n+1) * lineHeight`,
  * then **increment `n` when you decide to show it**,
  * so the next scope’s trigger is based on the new overlay height.

That is literally your “`n+1` early capture” model.

---

## The fix: compute `n+1` based on *this* render, not last render

Replace the `displayedCount` logic with a local counter that tracks how many scopes you’re going to show **in this pass**, and update it as you go.

Patch just the offset/filter section inside `updateStickyHeader`:

```js
// ============================================================================
const lineHeight = view.defaultLineHeight;

// Filter: only show scopes whose definition line is above viewport (with n+1 offset)
// n = how many sticky lines we are already planning to show in THIS render
// trigger line i when its defBlock.bottom <= scrollTop + (n+1) * lineHeight
// ============================================================================
const filteredScopes = [];
let visibleCount = 0;  // this is your “n”

for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);

    // n+1: early trigger for the next scope based on current overlay height
    const triggerOffset = (visibleCount + 1) * lineHeight;

    if (defBlock.bottom <= scrollTop + triggerOffset) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes.push({
        node: scopeNode,
        lineText: defLine.text,  // keep indentation
      });
      visibleCount += 1;  // overlay grows by one sticky line
    } else {
      // Once an outer scope hasn't reached its threshold,
      // don't allow deeper scopes without their parent.
      break;
    }
  } catch {
    // ignore bad lineBlockAt cases (off-doc, etc.)
  }
}

this.currentScopes = filteredScopes;
```

Key points:

* **`visibleCount` is “n”** in your `n+1` formula.

  * First scope: `n = 0` → trigger at `1 * lineHeight` above `scrollTop`
    → same “capture as line hits top” behavior that fixed the minimap.
  * Second scope: `n = 1` when you reach it → trigger at `2 * lineHeight`,
    which exactly compensates for the overlay already covering 1 line.
  * Third scope: `n = 2` → trigger at `3 * lineHeight`, etc.
* Using a local `visibleCount` means the math is based on the *new* overlay shape you’re about to draw, not stale data from the previous frame.
* The `break` ensures you never show a deeper scope without all of its ancestors. That keeps the stack consistent and matches Monaco’s behavior.

---

## Sanity-check with your mental model

Let’s walk the simple two-level example:

* `scope[0]` = top-level function
* `scope[1]` = nested function

Assume single-line defs, so each has height `L`.

1. **Top-level capture (no sticky lines yet)**

   * `visibleCount = 0` → trigger offset = `1 * L`
   * Condition: `defBottom_0 <= scrollTop + L`

     * This equivalently is `scrollTop >= defTop_0`
     * i.e. as soon as its top hits the top of the viewport. ✔

2. **Nested capture while top-level already sticky**

   * Once top-level is captured, `visibleCount = 1`
   * For nested: trigger offset = `(1+1) * L = 2L`
   * Condition: `defBottom_1 <= scrollTop + 2L`

     * Rearranged: `scrollTop >= defTop_1 - L`
     * That is: nested def gets captured while it’s still **one line below** the future overlay bottom.
       Which is exactly what you want: it’s grabbed early enough that when the overlay grows, you never see the nested header “slide under” it first.

And this generalizes:

* After `n` scopes are sticky, the next one is captured when its definition has moved up past `n+1` lines above the top of the scroll window.
* The overlay then grows to `n+1` lines, so content never visibly passes behind it before being “sticky-ified”.

---

## Optional micro-tweak (only if needed)

If you still see edge weirdness with wrapped lines or very large fonts, the only extra tweak I’d consider (and only if you see it misbehave) is:

* Use the **actual overlay height** as your base, instead of assuming exactly `n * lineHeight`.

That’s just a different way to compute the same idea:

```js
const overlayHeight = this.dom.offsetHeight || 0;
const lineHeight = view.defaultLineHeight;

let filteredScopes = [];
let overlayLines = Math.round(overlayHeight / lineHeight);  // n from DOM
for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  const defBlock = view.lineBlockAt(scopeNode.from);

  const triggerOffset = (overlayLines + 1) * lineHeight;

  if (defBlock.bottom <= scrollTop + triggerOffset) {
    ...
    overlayLines += 1;  // overlay grows by one line
  } else {
    break;
  }
}
```

But I’d start with the simpler `visibleCount` version above — it already matches your `n+1` reasoning and Replit’s “capture one line early” fix, and it stays independent of any small CSS padding differences.

---

If you patch that section and keep everything else as-is (posAtCoords, absolute overlay, etc.), you should see:

* Top-level captured exactly as now.
* Each extra nested scope “snapped” into the overlay as soon as it approaches that `n+1` band, instead of lagging behind or only appearing once it’s fully vanished under the sticky area.
**SIGNED** _DEX_