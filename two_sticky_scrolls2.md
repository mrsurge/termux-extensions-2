# Two Approaches: Monaco-Style Sticky Scroll for CodeMirror

## Overview

This document outlines two implementation strategies for improving our sticky scroll:

1. **Approach A**: Keep n+1 architecture, adopt Monaco's rendering/animation patterns
2. **Approach B**: Full Monaco geometric docking (replace n+1 entirely)

Both approaches steal liberally from Monaco's source code.

---

## Approach A: Hybrid (n+1 Detection + Monaco Rendering)

**Philosophy**: Our n+1 activation logic works well. The problems are in rendering (frame rate, stuck animations). Keep detection, replace rendering.

### What We Keep

- `triggerLine = startLine - (depth + 2)` offset calculation
- `earlyLines` scroll-direction adjustment
- Hysteresis for activation/deactivation
- `lastOverlaySampleHeight` for stable sampling

### What We Steal From Monaco

#### 1. Separate State Calculation from DOM Updates

Monaco's `findScrollWidgetState` returns a pure data object, then `_renderRootNode` handles DOM separately. We currently mix them.

```javascript
// NEW: Pure state calculation (no DOM touching)
calculateStickyState() {
  const startLineNumbers = [];
  const endLineNumbers = [];
  let lastLineRelativePosition = 0;
  
  // ... existing n+1 activation logic ...
  
  for (const scope of activeScopes) {
    startLineNumbers.push(scope.startLine);
    endLineNumbers.push(scope.endLine);
  }
  
  // Push-up calculation (stolen from Monaco controller line 614-615)
  const innermost = activeScopes[activeScopes.length - 1];
  if (innermost) {
    const bottomOfElement = activeScopes.length * lineHeight;
    const bottomOfEndLine = view.lineBlockAt(innermost.node.to).bottom - scrollTop;
    if (bottomOfElement > bottomOfEndLine) {
      lastLineRelativePosition = bottomOfEndLine - bottomOfElement;
    }
  }
  
  return new StickyScrollState(startLineNumbers, endLineNumbers, lastLineRelativePosition);
}
```

#### 2. Partial DOM Rebuilds (stolen from Widget line 178)

```javascript
// NEW: Only rebuild from first divergence point
_findIndexToRebuildFrom(previousLineNumbers, newLineNumbers) {
  const minLength = Math.min(previousLineNumbers.length, newLineNumbers.length);
  for (let i = 0; i < minLength; i++) {
    if (previousLineNumbers[i] !== newLineNumbers[i]) {
      return i;
    }
  }
  return minLength;
}

renderStickyScroll(newState) {
  const rebuildFrom = this._findIndexToRebuildFrom(this._prevLineNumbers, newState.startLineNumbers);
  
  // Remove only nodes from rebuildFrom onwards
  while (this.dom.children.length > rebuildFrom) {
    this.dom.lastChild.remove();
  }
  
  // Append only new nodes
  for (let i = rebuildFrom; i < newState.startLineNumbers.length; i++) {
    this.dom.appendChild(this._createLayerForScope(i, newState));
  }
  
  // Update transform on innermost (no rebuild needed)
  const innermost = this.dom.lastElementChild;
  if (innermost) {
    innermost.style.transform = `translateY(${newState.lastLineRelativePosition}px)`;
  }
  
  this._prevLineNumbers = [...newState.startLineNumbers];
}
```

#### 3. CSS Transitions for Push-Up

```css
.cm-sticky-layer {
  /* Existing styles... */
  transition: transform 0.08s ease-out, height 0.08s ease-out;
}

.cm-sticky-layer.innermost {
  /* Only innermost animates transform */
  transition: transform 0.08s ease-out, height 0.08s ease-out;
}
```

#### 4. Remove `topOffset` from renderKey

```javascript
// OLD (causes full rebuild on every push-up pixel change)
const renderKey = `${signature}|${topOffset.toFixed(3)}|${effectiveHeight.toFixed(3)}`;

// NEW (only rebuild when scopes change)
const renderKey = signature;

// Apply transform separately without triggering rebuild
if (renderKey !== this.lastRenderKey) {
  this._rebuildDOM(activeScopes);
  this.lastRenderKey = renderKey;
}
// Always update transform (cheap, CSS handles animation)
this._updateTransform(topOffset);
```

#### 5. Fix `lastScrollTop` Early Return Bug

```javascript
updateStickyHeader() {
  const scrollTop = view.scrollDOM.scrollTop;
  
  // MOVE TO TOP: Always update scroll tracking
  const direction = scrollTop > this.lastScrollTop ? 1 : (scrollTop < this.lastScrollTop ? -1 : 0);
  this.lastScrollTop = scrollTop;  // <-- MOVED UP
  
  // ... rest of logic, early returns are now safe ...
}
```

### Approach A Summary

| Change | Purpose |
|--------|---------|
| Separate state/render | Cleaner logic, easier debugging |
| Partial DOM rebuilds | Major perf improvement |
| CSS transitions | Smooth push-up animation |
| renderKey = signature only | Prevent rebuild on transform changes |
| Fix lastScrollTop | Correct direction detection |

---

## Approach B: Full Monaco Geometric Docking (Replace n+1)

**Philosophy**: Abandon line-based prediction entirely. Use Monaco's pixel-perfect geometric intersection.

### Core Concept

Instead of "activate 2 lines early", we ask: "has this scope's header line scrolled past its designated slot position?"

```
Slot 0: Y = 0px        (depth 0 lives here)
Slot 1: Y = 20px       (depth 1 lives here)  
Slot 2: Y = 40px       (depth 2 lives here)
```

A scope activates when its start line scrolls **above** its slot position.

### Implementation (Stolen/Adapted from Monaco)

#### 1. New `StickyLineCandidate` Class

```javascript
// Stolen from stickyScrollProvider.ts line 20-27
class StickyLineCandidate {
  constructor(startLineNumber, endLineNumber, top, height) {
    this.startLineNumber = startLineNumber;
    this.endLineNumber = endLineNumber;
    this.top = top;      // Slot position (depth * lineHeight)
    this.height = height; // lineHeight
  }
}
```

#### 2. Recursive Candidate Collection (Stolen from Provider line 176-219)

```javascript
getCandidateStickyLinesIntersecting(visibleRange) {
  const candidates = [];
  const tree = CM.syntaxTree(this.view.state);
  if (!tree?.topNode) return candidates;
  
  this._collectCandidatesFromNode(
    tree.topNode,
    visibleRange,
    candidates,
    0,    // depth
    0,    // top (slot position)
    -1    // lastStartLine (dedup)
  );
  return candidates;
}

_collectCandidatesFromNode(node, range, result, depth, top, lastStartLine) {
  const state = this.view.state;
  const lineHeight = this.view.defaultLineHeight;
  const scopeTypes = this.getScopeTypes();
  
  // Iterate children that might intersect visible range
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!isScopeNode(child, scopeTypes)) continue;
    
    const startLine = state.doc.lineAt(child.from).number;
    const endLine = state.doc.lineAt(child.to).number;
    
    // Skip single-line scopes and duplicates
    if (endLine <= startLine + 1) continue;
    if (startLine === lastStartLine) continue;
    
    // Check intersection with visible range
    if (startLine <= range.endLine && endLine >= range.startLine) {
      result.push(new StickyLineCandidate(startLine, endLine, top, lineHeight));
      
      // Recurse into children at next depth
      this._collectCandidatesFromNode(
        child,
        range,
        result,
        depth + 1,
        top + lineHeight,  // Next slot position
        startLine
      );
    }
  }
}
```

#### 3. Geometric Activation (Stolen from Controller line 594-625)

```javascript
findScrollWidgetState() {
  const scrollTop = this.view.scrollDOM.scrollTop;
  const lineHeight = this.view.defaultLineHeight;
  const maxStickyLines = 5;
  
  let lastLineRelativePosition = 0;
  const startLineNumbers = [];
  const endLineNumbers = [];
  
  // Get visible range
  const viewport = this.view.viewport;
  const visibleRange = {
    startLine: this.view.state.doc.lineAt(viewport.from).number,
    endLine: this.view.state.doc.lineAt(viewport.to).number
  };
  
  const candidates = this.getCandidateStickyLinesIntersecting(visibleRange);
  
  for (const candidate of candidates) {
    const { startLineNumber, endLineNumber, top: topOfElement, height } = candidate;
    
    // Get physical positions (stolen from controller line 609-610)
    const startLineBlock = this.view.lineBlockAt(
      this.view.state.doc.line(startLineNumber).from
    );
    const endLineBlock = this.view.lineBlockAt(
      this.view.state.doc.line(endLineNumber).to
    );
    
    const topOfBeginningLine = startLineBlock.top - scrollTop;
    const bottomOfEndLine = endLineBlock.bottom - scrollTop;
    const bottomOfElement = topOfElement + height;
    
    // THE MONACO CONDITION (stolen from controller line 611)
    if (topOfElement > topOfBeginningLine && topOfElement <= bottomOfEndLine) {
      startLineNumbers.push(startLineNumber);
      endLineNumbers.push(endLineNumber);
      
      // Push-up calculation (stolen from controller line 614-615)
      if (bottomOfElement > bottomOfEndLine) {
        lastLineRelativePosition = bottomOfEndLine - bottomOfElement;
      }
    }
    
    if (startLineNumbers.length >= maxStickyLines) break;
  }
  
  return new StickyScrollState(startLineNumbers, endLineNumbers, lastLineRelativePosition);
}
```

#### 4. Key Difference from n+1

```javascript
// n+1 approach (line-based prediction)
const triggerLine = startLine - (depth + 2);
if (refLine > triggerLine && refLine <= endLine) {
  activate();
}

// Monaco approach (geometric docking)
const topOfElement = depth * lineHeight;  // Where it WANTS to be
const topOfBeginningLine = actualPixelPosition - scrollTop;  // Where it IS
if (topOfElement > topOfBeginningLine) {  // Has it scrolled past its slot?
  activate();
}
```

### Approach B Summary

| Change | Purpose |
|--------|---------|
| `StickyLineCandidate` with `top` | Encapsulates slot position |
| Recursive child traversal | Proper sibling handling (fixes piling bug) |
| Geometric activation condition | Pixel-perfect docking |
| `topOfElement > topOfBeginningLine` | Monaco's core insight |

---

## Recommendation

**Start with Approach A** (Hybrid):
- Lower risk: keeps working n+1 detection
- Fixes immediate pain points (frame rate, stuck animations)
- Can be done incrementally

**Consider Approach B** (Full Monaco) if:
- Python piling bug persists after fixing sibling detection
- We want true pixel-perfect behavior
- We're willing to retest all languages

---

## Quick Wins (Either Approach)

1. **Fix `lastScrollTop` bug** - Move update before early returns
2. **Add CSS transitions** - `.cm-sticky-layer { transition: transform 0.08s ease-out }`
3. **Remove `topOffset` from renderKey** - Prevent unnecessary rebuilds
4. **Simplify redundant ternary** - `effectiveTop = baseTop + earlyLines * lineHeight`

---

*atlas - t2 contributor*
*2025-12-05*
