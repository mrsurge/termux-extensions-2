# How Monaco Implements Sticky Scroll Stacking (Comparison to n+1)

## Introduction

The `n_plus_1.md` document describes a "Line-Based Prediction" architecture used (likely in CodeMirror) to determine when sticky headers should activate. Its primary goal is to prevent the sticky header from obscuring the content it describes by triggering the header *early* (before the content reaches the top).

Monaco achieves the same goal—ensuring headers stack correctly and don't obscure content—but uses a fundamentally different mechanism: **Geometric Intersection**.

## Monaco's Approach: Geometric Intersection

Instead of calculating a "trigger line" based on arbitrary offsets (`n+1`), Monaco calculates the exact pixel position where a header *should* reside in the sticky stack and activates it precisely when the line scrolls into that position.

### The Logic

The core logic resides in `StickyScrollController.findScrollWidgetState`.

For every candidate scope, Monaco compares two values:
1.  **`topOfElement`**: The calculated Y-position where this scope's header would sit in the sticky widget. This is effectively `depth * lineHeight`.
2.  **`topOfBeginningLine`**: The current physical Y-position of the scope's starting line in the editor viewport (relative to the top of the viewport).

**The Activation Condition:**
```typescript
if (topOfElement > topOfBeginningLine) {
    // activate sticky scroll
}
```

### How it Works (The "Docking" Effect)

Let's imagine a scenario with 20px line height:

**1. Depth 0 (Top-level function)**
- `topOfElement`: 0px (It wants to sit at the very top).
- **Behavior**: As you scroll down, the function header moves up. When it hits Y=0 (`topOfBeginningLine` becomes 0), the condition `0 > 0` (or slightly `<`) becomes true. The header "sticks" at 0.

**2. Depth 1 (Nested function)**
- `topOfElement`: 20px (It wants to sit below the Depth 0 header).
- **Behavior**: As the nested function approaches the top, it passes Y=100, Y=50...
- When it reaches **Y=20** (20px from the top), it physically touches the bottom of the Depth 0 header.
- At this exact moment, `20px > 20px` triggers.
- The line "docks" into the sticky widget at position 20.

## Comparison to "n+1"

The `n_plus_1.md` model uses a **Predictive Offset**:
> "Activates 2 lines before function starts"
> Formula: `Trigger = StartLine - (Depth + 2)`

Monaco uses a **Reactive Contact** model:
> "Activates exactly when the header touches the stack"
> Formula: `Trigger = StartLine - Depth` (approximately)

### Key Differences

| Feature | "n+1" Architecture | Monaco Architecture |
| :--- | :--- | :--- |
| **Trigger Timing** | **Pre-emptive**: Activates *before* contact (2 lines gap). | **Just-in-Time**: Activates *at* contact. |
| **Basis** | **Line Numbers**: Integer math on line indices. | **Pixel Coordinates**: Floating point math on rendering geometry. |
| **Visual Effect** | Header appears early, floating above the content with a gap. | Header slides naturally into place as if colliding with the stack. |
| **Resolution** | Coarse (Line-by-line). | Fine (Pixel-perfect, handles smooth scrolling). |

## How Monaco Solves the "Obstruction" Problem

The "n+1" doc states: *"The sticky header appears, but now obscures the first few lines of the function."*

Monaco solves this **naturally** through its coordinate system:
1.  A nested header (Depth 1) is **never** drawn at Y=0. It is always drawn at `Y = ParentHeight`.
2.  Because it activates exactly when the source line reaches `Y = ParentHeight`, the source line is **already visible** below the parent header.
3.  Therefore, the sticky header **replaces** the source line at the exact position the source line occupies. It never pops up *over* the content; it *becomes* the content's fixed representation.

## Conclusion

Monaco does not implement the specific `-(n+1)` offset logic described in `n_plus_1.md`. Instead, it achieves the same functional requirement (preventing obstruction and ensuring correct stacking) through **Geometric Docking**.

By treating the sticky widget as a physical stack of slots and activating lines only when they scroll into their assigned slot, Monaco ensures a seamless visual transition without needing arbitrary lead-time offsets.
