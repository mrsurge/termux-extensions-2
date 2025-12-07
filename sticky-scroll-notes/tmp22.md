# Why `n + 1` Is Necessary for Sticky Scroll

**Context:** CodeMirror 6 sticky scroll overlay inside the editor iframe, emulating VS Code/Monaco. The header is an **overlay** sitting on top of the real viewport content.

## 1. The Core Problem: Overlay vs. Real Viewport

When you add a sticky header as an overlay at the top of the editor:

- The **browser’s viewport** hasn’t changed; `scrollTop` and `lineBlockAtHeight(0)` still think the top of the *scrollable* area is the first visible line.
- But the **user’s visible content window is smaller** by the height of the overlay.
  - If the overlay is 1 line tall, the *first visible code line* is effectively at `+1` line from the real top.
  - If the overlay is 2 lines tall, the first visible code line is at `+2`, etc.

If you trigger stickiness with a naïve rule like:

> "Make the header sticky when `startLine < topLine` (or when the function header has scrolled completely past the real viewport top)"

then:

- The function header **does not appear in the overlay** until after it has already disappeared from the actual visible code area (because part of that area is covered by the overlay itself).
- Visually, you get the classic **underscroll** effect:
  - The function name scrolls up.
  - It disappears *behind the sticky overlay*.
  - Only *after* it’s gone do you see the sticky header appear.

This is exactly the behavior we’ve been trying to avoid from day one.

## 2. What `n + 1` Actually Represents

`n + 1` is not a random fudge factor; it’s encoding the difference between:

- The **real scrollable coordinate system** (what CodeMirror reports via `scrollTop`, `lineBlockAtHeight`, etc.), and
- The **virtual viewport** that the user experiences once we’ve taken up some vertical space with our overlay.

Informally:

- `n` = number of sticky lines currently in the overlay (i.e., overlay height in *lines*).
- `+1` = the extra “early capture” we need so the header appears **just before** the real line reaches the overlay boundary.

So for each depth / sticky slot:

- Depth 0 (top-most scope) should trigger **1 line earlier** than its natural off-screen point.
- Depth 1 should trigger **2 lines earlier** than its natural off-screen point.
- Depth 2 should trigger **3 lines earlier**, etc.

In other words, `n + 1` is the **virtual slot offset** for that depth.

## 3. Why Stateless "topLine only" Logic Is Insufficient

A stateless geometric algorithm that only looks at:

- `topLine` (line at `scrollTop`), and
- `startLine` / `endLine` of scopes,

will always suffer one of two problems:

1. **Underscroll (no early capture)**
   - If you trigger when `startLine < topLine`, the header appears **after** the function has moved behind the overlay.
   - User sees the header only once they’ve already “lost” the function name.

2. **Overcompensated hacks**
   - If you try to hard-code a negative offset (e.g., "just trigger 1 line early" globally), you:
     - Fix depth 0 for one overlay height,
     - But break nested scopes and dynamic overlay growth.

Because our overlay height **changes with nesting** (and may change dynamically as scopes enter/leave), a purely stateless `topLine` rule **cannot account for the fact that the visible content window shrinks as the overlay grows**.

## 4. Why `n + 1` Has to Be Depth-Aware

The overlay is not a fixed-height bar. As you go deeper into nested scopes:

- The sticky header stack gets taller: 1 line → 2 lines → 3 lines → ...
- That means the **"visible code area" starts lower** each time:
  - With 1 sticky line, the first visible code line is effectively `+1`.
  - With 2 sticky lines, it’s effectively `+2`.
  - With 3 sticky lines, `+3`, and so on.

If you still use the same trigger condition for all depths, you get:

- Depth 0: maybe “okay-ish” after tuning.
- Depth 1: capturing late or early depending on how you hacked the offset.
- Depth 2+: usually misaligned or janky, because the overlay growth isn’t baked into the math.

Therefore, the early capture offset has to grow with depth:

- Level 0: trigger when the header is **1 line away** from the overlay.
- Level 1: trigger when the header is **2 lines away**.
- Level 2: trigger when the header is **3 lines away**, etc.

That’s exactly what the `n + 1` idea encodes.

## 5. UX Requirement: "Consumed by the Overlay"

The *design goal* (matching VS Code / Monaco) is:

> As you scroll down, each new scope header should feel like it is **captured and consumed** by the sticky overlay as it reaches it, without disappearing underneath first.

Concretely, that requires:

- When the header line hits the **virtual boundary** just under the overlay, the sticky version is already in place.
- The user never sees a gap where the header is neither in the content nor in the overlay.

Without `n + 1` early triggering (or an equivalent slot-based early-capture scheme), this is **impossible**:

- You’ll always either:
  - Let it scroll out of the effective visible region before sticking (underscroll), or
  - Introduce janky, inconsistent offsets that only work for some depths.

## 6. Summary: Why We Can’t Drop `n + 1`

- The sticky header is an overlay that **shrinks the visible content area**.
- The raw scroll geometry (`scrollTop`, `topLine`) is ignorant of that overlay.
- To get the correct UX (“overlay consumes scopes just as they arrive”), we need an **early-capture offset** that:
  - Accounts for the current overlay height, and
  - Increases with depth (more nested scopes = taller header = bigger offset).
- That is exactly what the `n + 1` model represents.

So any acceptable solution **must** preserve the `n + 1`-style early capture (or an equivalent per-depth slot offset) and then work on eliminating jitter **around** that model. Reverting to a pure "wait until it’s off-screen" rule will always regress to the underscroll behavior we’ve already rejected.

