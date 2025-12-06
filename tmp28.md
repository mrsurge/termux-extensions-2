# Sticky Scroll Markdown "One Line Early" Bug Analysis

**Date:** 2025-12-06  
**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

## The Bug

Markdown headings appear in the sticky scroll overlay **one line before** the heading actually reaches the viewport top. This causes premature duplication—the heading shows in the overlay while still visible in the document.

## Root Cause

Two layers of "early" logic compound for markdown:

### Layer 1: `earlyLines` in Sampling (line ~1825)

```javascript
let earlyLines = direction >= 0 ? 1 : 0;
const effectiveTop = baseTop + earlyLines * lineHeight;
```

When scrolling down, `earlyLines = 1` is added to `effectiveTop`, making `refLine` already **1 line ahead** of what's actually at the visible viewport top.

### Layer 2: `markdownPathAtSimple` Inclusion Logic (lines 1316-1328)

```javascript
const markdownPathAtSimple = (sections, refLine) => {
  for (const sec of sections) {
    if (sec.line > refLine) break;          // ← includes heading when sec.line <= refLine
    if (refLine > sec.endLine) continue;
    // ... push to stack
  }
};
```

The condition `sec.line > refLine` means a heading is **included in the path as soon as `refLine >= sec.line`**.

### Layer 3: Unused `triggerLine` for Path Building

```javascript
const offset = -3;
const triggerLine = sec.line + offset;  // heading at line 10 → triggerLine = 7
```

The `triggerLine` is computed but **not used to filter path inclusion**—it only affects slot activation later. The path is built using raw `sec.line` comparison against the already-offset `refLine`.

## The Compounding Effect

Example: Heading at **line 10**

| Visible Top Line | `earlyLines` | `refLine` | `sec.line <= refLine` | Heading in Path? |
|------------------|--------------|-----------|----------------------|------------------|
| 9                | 1            | 10        | 10 <= 10 ✓           | **YES** (too early!) |
| 10               | 1            | 11        | 10 <= 11 ✓           | YES              |

The heading appears when line **9** is at viewport top, not when line **10** reaches it.

## Why Code Languages Don't Have This Issue

For Python/JS, the path is built by **walking the syntax tree from `refPos`**:

```javascript
let node = tree.resolveInner(refPos);
for (; node; node = node.parent) {
  if (isScopeNode(node, scopeTypes, state, isPython)) {
    ancestorNodes.push(node);
  }
}
```

The syntax tree naturally includes ancestors only when the cursor is **actually inside** the scope body. The `triggerLine` offset then controls when the scope **activates in a slot**, providing proper n+1 behavior.

For markdown, path building uses pure line number comparison without accounting for the sampling offset.

## Fix Options

### Option A: Remove `earlyLines` for Markdown

```javascript
let earlyLines = isMarkdown ? 0 : (direction >= 0 ? 1 : 0);
```

**Pros:** Simple, surgical  
**Cons:** Might affect feel of scrolling for markdown

### Option B: Offset the Comparison in `markdownPathAtSimple`

```javascript
const markdownPathAtSimple = (sections, refLine, earlyOffset = 0) => {
  const adjustedRef = refLine - earlyOffset;
  for (const sec of sections) {
    if (sec.line > adjustedRef) break;
    // ...
  }
};
```

Then call with: `markdownPathAtSimple(sections, refLine, earlyLines)`

**Pros:** Explicit, testable  
**Cons:** Requires threading `earlyLines` through

### Option C: Use `triggerLine` for Path Building (Recommended)

Change `markdownPathAtSimple` to use the n+1 trigger semantics:

```javascript
const markdownPathAtSimple = (sections, refLine) => {
  for (const sec of sections) {
    // Use trigger offset for inclusion, not raw line
    const activationLine = sec.line - 1;  // or use depth-based offset
    if (activationLine > refLine) break;
    if (refLine > sec.endLine) continue;
    // ...
  }
};
```

**Pros:** Aligns markdown with the n+1 philosophy used elsewhere  
**Cons:** Need to tune the offset value

### Option D: Apply Offset When Building Candidates

In the markdown branch (lines 1854-1880), adjust the path call:

```javascript
const path = markdownPathAtSimple(sections, refLine - earlyLines);
```

**Pros:** Minimal change, keeps `markdownPathAtSimple` pure  
**Cons:** Implicit coupling to sampling logic

## Recommended Fix

**Option D** is the cleanest immediate fix:

```diff
           if (isMarkdown) {
             const headings = collectMarkdownHeadingsSimple(state.doc);
             const sections = buildMarkdownSectionsSimple(headings, state.doc.lines);
-            const path = markdownPathAtSimple(sections, refLine);
+            const path = markdownPathAtSimple(sections, refLine - earlyLines);
             candidateScopes = path.map((sec, idx) => {
```

This counteracts the early sampling offset specifically for the markdown path building, aligning it with what the user actually sees.
