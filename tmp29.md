# Push-Up Animation for Markdown Sticky Scroll

**Date:** 2025-12-06  
**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

## Current State

Push-up animation is **disabled** for markdown (lines ~2137-2140):

```javascript
if (isMarkdown) {
  // Keep header pinned; no push-up for markdown to prevent clipping deeper slots
  effectiveHeight = activeScopes.length * lineHeight;
  lastHeight = lineHeight;
} else {
  // ... push-up logic for code languages
}
```

The stated reason was "to prevent clipping deeper slots," but with the current slot-based architecture, we can implement push-up properly.

## The Problem: Sibling Scope Replacement

In markdown, when you have sibling headings at the same level:

```markdown
# Title                    ← depth 0

## Section A               ← depth 1, lines 3-10
Content A...

## Section B               ← depth 1, lines 12-20  (sibling of A)
Content B...

## Section C               ← depth 1, lines 22-30  (sibling of B)
Content C...
```

When scrolling from Section A into Section B:
1. Section A should **push up and out** of the sticky header
2. Section B should **slide in** to replace it
3. The transition should be smooth, not abrupt

Currently, without push-up, Section A just **snaps** to Section B instantly—jarring UX.

## Why Code Languages Work

For code, push-up uses `innermost.node.to` to find the scope end:

```javascript
const endLine = state.doc.lineAt(innermost.node.to);
const endLineBlock = view.lineBlockAt(endLine.to);
const endBottomViewport = endLineBlock.bottom - scrollTop;
```

This works because code scopes have real syntax nodes with accurate `from`/`to` positions.

## Why Markdown Currently Fails

Markdown scopes have a **synthetic node** that only spans the heading line:

```javascript
node: { from: lineObj.from, to: lineObj.to },  // Just the heading line!
```

But we DO have the actual section end in `scope.endLine`. The fix is to use that instead.

## Implementation Plan

### Step 1: Use `scope.endLine` for Markdown Push-Up Geometry

Replace the code-only push-up block with a unified approach:

```javascript
// ---------------------------------------------------------------------------
// 5) Push-up effect for innermost scope
// ---------------------------------------------------------------------------
const innermost = activeScopes[activeScopes.length - 1];

let topOffset = 0;
let effectiveHeight;
let lastHeight = lineHeight;

// Scale push-up margin based on scope characteristics
const scopeLength = Math.max(1, innermost.endLine - innermost.startLine + 1);
let pushMarginLines;
if (scopeLength <= 6) {
  pushMarginLines = 1;
} else if (innermost.depth === 0) {
  pushMarginLines = 1.5;
} else {
  pushMarginLines = 3;
}
const earlyMargin = pushMarginLines * lineHeight;

try {
  let endBottomViewport;
  
  if (isMarkdown) {
    // For markdown: use scope.endLine (the actual section end)
    const endLineObj = state.doc.line(innermost.endLine);
    const endLineBlock = view.lineBlockAt(endLineObj.to);
    endBottomViewport = endLineBlock.bottom - scrollTop;
  } else {
    // For code: use node.to (syntax tree position)
    const endLine = state.doc.lineAt(innermost.node.to);
    const endLineBlock = view.lineBlockAt(endLine.to);
    endBottomViewport = endLineBlock.bottom - scrollTop;
  }
  
  const stackBottomViewport = headerHeight;
  const delta = endBottomViewport - stackBottomViewport;
  
  if (delta < earlyMargin) {
    topOffset = Math.max(-earlyMargin, delta - earlyMargin);
  }
} catch (e) {
  // Geometry lookup failed; keep header pinned
}

// Hysteresis to prevent flicker
const epsilon = lineHeight * 0.25;
if (Math.abs(topOffset - this.lastTopOffset) < epsilon) {
  topOffset = this.lastTopOffset;
}

// Upward scroll assist
if (direction < 0 && topOffset < 0) {
  topOffset = Math.min(0, topOffset + lineHeight * 0.2);
}

lastHeight = Math.max(0, lineHeight + topOffset);
effectiveHeight = (activeScopes.length - 1) * lineHeight + lastHeight;
```

### Step 2: Handle the "Deep Stack Clipping" Concern

The original concern was clipping when multiple nested headings are stacked. This happens if:
- H1 → H2 → H3 are all visible in sticky header
- H3's section ends, and the push-up clips H2/H1

**Solution:** Only apply push-up to the **innermost layer**, which is already what the code does. The outer layers remain pinned at their static positions. The CSS already handles this:

```javascript
layer.style.transform = idx === lastIndex ? `translateY(${topOffset}px)` : 'translateY(0)';
```

### Step 3: Tune Push-Up Margins for Markdown

Markdown sections tend to be longer than code functions. Adjust margins:

```javascript
if (isMarkdown) {
  // Markdown sections are typically longer; start push-up earlier
  if (scopeLength <= 10) {
    pushMarginLines = 2;
  } else {
    pushMarginLines = 4;
  }
}
```

## Visual Behavior After Implementation

### Scrolling Down Through Siblings

```
State 1: Section A in header, content visible
┌─────────────────────────┐
│ ## Section A            │  ← sticky header (depth 1)
├─────────────────────────┤
│ Content A line 1        │
│ Content A line 2        │
│ ## Section B            │  ← approaching
└─────────────────────────┘

State 2: Section A pushing up as Section B approaches
┌─────────────────────────┐
│ ## Section A  ↑↑↑       │  ← translateY(-8px), partially clipped
├─────────────────────────┤
│ ## Section B            │  ← at viewport top
│ Content B line 1        │
└─────────────────────────┘

State 3: Section B replaces Section A
┌─────────────────────────┐
│ ## Section B            │  ← sticky header (depth 1)
├─────────────────────────┤
│ Content B line 1        │
│ Content B line 2        │
└─────────────────────────┘
```

### Nested Headings (H1 → H2 → H3)

```
State: Deep in H3 section, approaching H3's end
┌─────────────────────────┐
│ # Title                 │  ← depth 0, pinned
│ ## Chapter 1            │  ← depth 1, pinned  
│ ### Section 1.1  ↑↑     │  ← depth 2, pushing up (innermost)
├─────────────────────────┤
│ ### Section 1.2         │  ← next sibling approaching
└─────────────────────────┘
```

Only the innermost (### Section 1.1) pushes up. The outer headings (# Title, ## Chapter 1) remain stable.

## Edge Cases to Handle

### 1. Very Short Sections

If a markdown section is only 2-3 lines, push-up should be minimal or disabled:

```javascript
if (scopeLength <= 3) {
  // Too short for meaningful push-up; snap transition
  pushMarginLines = 0;
}
```

### 2. Last Section in Document

When the innermost scope is the last heading in the document, `endLine` equals the document's last line. Push-up should still work—the header pushes up as the document end approaches.

### 3. Single-Heading Documents

If there's only one heading (depth 0, no children), push-up applies when scrolling to document end. Behavior should match code languages.

## Summary

| Change | Location | Description |
|--------|----------|-------------|
| Use `scope.endLine` | Push-up geometry block | Get section end from scope metadata, not synthetic node |
| Remove `isMarkdown` skip | Push-up conditional | Delete the early-return branch for markdown |
| Tune margins | `pushMarginLines` calc | Adjust for typical markdown section lengths |
| Test edge cases | Manual QA | Short sections, deep nesting, document end |

The key insight: **markdown scopes already have accurate `endLine` values**—we just weren't using them for push-up geometry.
