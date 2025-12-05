# Final Sticky Scroll Architecture

**Date:** 2025-12-05  
**Contributors:** atlas - t2 contributor

---

## Executive Summary

This document consolidates all research into three implementation paths for sticky scroll in CodeMirror 6. Each path addresses the core issues identified:

1. **Python "piling up" bug** - sibling functions appearing as nested scopes
2. **Frame rate issues** - choppy animations during scroll
3. **"Halfway stuck" animations** - push-up effect freezing mid-transition
4. **Incomplete parse tree** - Lezer's incremental parsing causing transient bugs

The key insight: **pre-parse and cache the scope structure** instead of walking the live syntax tree per frame.

---

## Core Infrastructure: Scope Cache

All three paths benefit from a **cached scope index** that:
- Parses the document once on load/change
- Stores scope boundaries in a flat, searchable array
- Invalidates via `sha256` from `core_read.py`
- Provides O(log n) lookup during scroll

### Integration with `core_read.py`

```javascript
// Frontend receives events from core_read.py subscription
socket.on('file_event', (event) => {
  if (event.type === 'replace_full' || event.type === 'external_change') {
    // Document changed - invalidate scope cache
    this.scopeCacheValid = false;
    this.lastSha256 = event.sha256;
  }
});

// On scroll, rebuild cache if invalid
updateStickyHeader() {
  if (!this.scopeCacheValid) {
    this.rebuildScopeCache();
  }
  // ... use cached scopes ...
}
```

### Scope Cache Structure

```javascript
class ScopeCache {
  constructor() {
    this.scopes = [];      // Flat array of all scope nodes
    this.sha256 = null;    // Document hash for invalidation
    this.treeLength = 0;   // For partial-parse detection
  }

  rebuild(view) {
    const state = view.state;
    const tree = CM.syntaxTree(state);
    
    // Detect incomplete parse (Lezer quirk)
    if (tree.length < state.doc.length * 0.9) {
      // Schedule retry, don't cache partial results
      setTimeout(() => this.rebuild(view), 100);
      return false;
    }
    
    this.scopes = [];
    this._walkTree(tree.topNode, state, 0);
    this.treeLength = tree.length;
    return true;
  }

  _walkTree(node, state, depth) {
    const scopeTypes = this.getScopeTypes();
    
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (this.isScopeNode(child, scopeTypes)) {
        const startLine = state.doc.lineAt(child.from).number;
        const endLine = state.doc.lineAt(child.to).number;
        
        if (endLine > startLine) {
          this.scopes.push({
            from: child.from,
            to: child.to,
            startLine,
            endLine,
            depth,
            text: state.doc.lineAt(child.from).text,
          });
          
          // Recurse into children
          this._walkTree(child, state, depth + 1);
        }
      }
    }
  }

  // Binary search for scopes containing a line
  getScopesAtLine(line) {
    return this.scopes.filter(s => 
      line >= s.startLine && line <= s.endLine
    ).sort((a, b) => a.depth - b.depth);
  }

  // Get sibling scope that starts after given line
  getNextSiblingScope(scope) {
    return this.scopes.find(s => 
      s.depth === scope.depth && 
      s.startLine > scope.endLine
    );
  }
}
```

---

## Path 1: Enhanced n+1 (Recommended Starting Point)

**Philosophy:** Keep the working n+1 activation logic, fix rendering issues, add scope cache for sibling awareness.

### Changes from Current Implementation

#### 1.1 Add Scope Cache (fixes piling bug)

```javascript
// In ViewPlugin constructor
this.scopeCache = new ScopeCache();

// Replace ancestor-chain walking with cache lookup
getActiveScopes(refLine) {
  if (!this.scopeCache.isValid()) {
    this.scopeCache.rebuild(this.view);
  }
  
  const ancestors = this.scopeCache.getScopesAtLine(refLine);
  const activeScopes = [];
  
  for (const scope of ancestors) {
    // n+1 trigger calculation
    const offset = -(scope.depth + 2);
    const triggerLine = scope.startLine + offset;
    const endTriggerLine = scope.endLine + offset;
    
    // Sibling handoff (NOW WORKS - we have siblings in cache)
    const nextSibling = this.scopeCache.getNextSiblingScope(scope);
    let effectiveEnd = endTriggerLine;
    if (nextSibling) {
      const siblingTrigger = nextSibling.startLine + offset;
      effectiveEnd = Math.min(endTriggerLine, siblingTrigger - 1);
    }
    
    if (refLine > triggerLine && refLine <= effectiveEnd) {
      activeScopes.push(scope);
    }
  }
  
  return activeScopes;
}
```

#### 1.2 Fix `lastScrollTop` Early Return Bug

```javascript
updateStickyHeader() {
  const scrollTop = view.scrollDOM.scrollTop;
  
  // MOVED TO TOP - always update before any early returns
  const direction = scrollTop > this.lastScrollTop ? 1 : 
                    scrollTop < this.lastScrollTop ? -1 : 0;
  this.lastScrollTop = scrollTop;
  
  // ... rest of logic (early returns now safe) ...
}
```

#### 1.3 Separate State from Rendering

```javascript
// Pure state calculation
calculateState() {
  const activeScopes = this.getActiveScopes(refLine);
  const lastLineRelativePosition = this.calculatePushUp(activeScopes);
  
  return {
    scopes: activeScopes,
    pushUp: lastLineRelativePosition,
    signature: activeScopes.map(s => `${s.depth}:${s.startLine}`).join('|')
  };
}

// Rendering with partial updates
render(state) {
  // Only rebuild DOM when scopes change
  if (state.signature !== this.lastSignature) {
    this.rebuildDOM(state.scopes);
    this.lastSignature = state.signature;
  }
  
  // Always update transform (cheap, CSS animates it)
  this.updateTransform(state.pushUp);
}
```

#### 1.4 Add CSS Transitions

```javascript
const stickyScrollTheme = CM.EditorView.baseTheme({
  ".cm-sticky-layer": {
    // ... existing styles ...
    transition: "transform 0.08s ease-out, height 0.08s ease-out",
  },
  ".cm-sticky-layer.innermost": {
    boxShadow: "0 6px 8px rgba(0,0,0,0.35)",
    transition: "transform 0.08s ease-out, height 0.08s ease-out",
  },
});
```

#### 1.5 Partial DOM Rebuilds

```javascript
rebuildDOM(scopes) {
  const prevLines = this._prevScopeLines || [];
  const newLines = scopes.map(s => s.startLine);
  
  // Find first divergence
  let rebuildFrom = 0;
  const minLen = Math.min(prevLines.length, newLines.length);
  for (let i = 0; i < minLen; i++) {
    if (prevLines[i] !== newLines[i]) {
      rebuildFrom = i;
      break;
    }
    rebuildFrom = i + 1;
  }
  
  // Remove nodes from divergence point
  while (this.dom.children.length > rebuildFrom) {
    this.dom.lastChild.remove();
  }
  
  // Append new nodes
  for (let i = rebuildFrom; i < scopes.length; i++) {
    this.dom.appendChild(this.createLayer(scopes[i], i));
  }
  
  this._prevScopeLines = newLines;
}
```

#### 1.6 Simplify Redundant Ternary

```javascript
// OLD (both branches identical)
const effectiveTop = direction >= 0
  ? baseTop + earlyLines * lineHeight
  : baseTop + earlyLines * lineHeight;

// NEW
const effectiveTop = baseTop + earlyLines * lineHeight;
```

### Path 1 Summary

| Fix | Impact |
|-----|--------|
| Scope cache | Fixes piling bug, enables sibling handoff |
| lastScrollTop fix | Correct scroll direction detection |
| Separate state/render | Cleaner code, easier debugging |
| CSS transitions | Smooth push-up animations |
| Partial DOM rebuilds | Better frame rate |
| Remove redundant ternary | Code cleanup |

---

## Path 2: Full Monaco Geometric Docking

**Philosophy:** Replace n+1 entirely with Monaco's pixel-based contact detection. Requires scope cache.

### Core Activation Logic

```javascript
// Stolen from Monaco stickyScrollController.ts lines 594-625
findScrollWidgetState() {
  const scrollTop = this.view.scrollDOM.scrollTop;
  const lineHeight = this.view.defaultLineHeight;
  const maxStickyLines = 5;
  
  let lastLineRelativePosition = 0;
  const activeScopes = [];
  
  // Use cached scopes instead of live tree
  const candidates = this.scopeCache.getScopesInViewport(this.view.viewport);
  
  for (const scope of candidates) {
    // Slot position: where this scope WANTS to sit in the header
    const topOfElement = scope.depth * lineHeight;
    const bottomOfElement = topOfElement + lineHeight;
    
    // Physical position: where the scope's start line IS on screen
    const startBlock = this.view.lineBlockAt(
      this.view.state.doc.line(scope.startLine).from
    );
    const endBlock = this.view.lineBlockAt(
      this.view.state.doc.line(scope.endLine).to
    );
    
    const topOfBeginningLine = startBlock.top - scrollTop;
    const bottomOfEndLine = endBlock.bottom - scrollTop;
    
    // THE MONACO CONDITION: has it scrolled past its slot?
    if (topOfElement > topOfBeginningLine && topOfElement <= bottomOfEndLine) {
      activeScopes.push(scope);
      
      // Push-up calculation
      if (bottomOfElement > bottomOfEndLine) {
        lastLineRelativePosition = bottomOfEndLine - bottomOfElement;
      }
    }
    
    if (activeScopes.length >= maxStickyLines) break;
  }
  
  return { scopes: activeScopes, pushUp: lastLineRelativePosition };
}
```

### Key Differences from n+1

| Aspect | n+1 | Monaco |
|--------|-----|--------|
| Activation basis | Line numbers | Pixel coordinates |
| Trigger | `refLine > startLine - (depth+2)` | `slotY > lineY` |
| Resolution | Line-level (coarse) | Pixel-level (fine) |
| Early capture | 2+ lines before | Exact contact |
| Scroll sensitivity | Needs hysteresis | Naturally stable |

### When to Choose Path 2

- You want pixel-perfect "docking" behavior
- High-DPI displays with smooth scrolling
- Willing to retest all languages
- n+1 hysteresis tuning becomes unmaintainable

---

## Path 3: Hybrid (n+1 Activation + Monaco Rendering)

**Philosophy:** Use n+1 for activation decisions, but adopt Monaco's rendering pipeline.

### What We Keep from n+1

- `triggerLine = startLine - (depth + 2)` offset
- `earlyLines` scroll-direction adjustment  
- Hysteresis for edge stability
- Early capture behavior users are accustomed to

### What We Take from Monaco

- Scope cache (sibling awareness)
- Partial DOM rebuilds (`_findIndexToRebuildFrom`)
- CSS transitions for push-up
- Separate state/render phases
- `lastLineRelativePosition` naming convention

### Activation Logic (Hybrid)

```javascript
getActiveScopes(refLine) {
  const activeScopes = [];
  const candidates = this.scopeCache.getScopesAtLine(refLine);
  
  for (const scope of candidates) {
    // n+1 trigger (KEPT)
    const triggerLine = scope.startLine - (scope.depth + 2);
    
    // Sibling handoff (FROM CACHE)
    const nextSibling = this.scopeCache.getNextSiblingScope(scope);
    let endTrigger = scope.endLine - (scope.depth + 2);
    if (nextSibling) {
      const siblingTrigger = nextSibling.startLine - (nextSibling.depth + 2);
      endTrigger = Math.min(endTrigger, siblingTrigger - 1);
    }
    
    // Hysteresis (KEPT)
    const wasActive = this.prevActiveKeys.has(`${scope.depth}:${scope.startLine}`);
    const lower = wasActive ? triggerLine - 0.5 : triggerLine + 0.5;
    const upper = wasActive ? endTrigger + 0.5 : endTrigger - 0.5;
    
    if (refLine > lower && refLine <= upper) {
      activeScopes.push(scope);
    }
  }
  
  return activeScopes;
}

// Push-up calculation (MONACO STYLE)
calculatePushUp(activeScopes) {
  if (activeScopes.length === 0) return 0;
  
  const innermost = activeScopes[activeScopes.length - 1];
  const lineHeight = this.view.defaultLineHeight;
  const bottomOfElement = activeScopes.length * lineHeight;
  
  const endBlock = this.view.lineBlockAt(
    this.view.state.doc.line(innermost.endLine).to
  );
  const bottomOfEndLine = endBlock.bottom - this.view.scrollDOM.scrollTop;
  
  if (bottomOfElement > bottomOfEndLine) {
    return bottomOfEndLine - bottomOfElement;
  }
  return 0;
}
```

---

## Document Change Detection via `core_read.py`

The backend already provides `sha256` on every file event. Use it for cache invalidation:

### Backend Events (Already Implemented)

```python
# core_read.py line 369-375
snapshot_event = {
    "type": "replace_full",
    "path": norm,
    "content": content,
    "language": lang,
    "sha256": file_meta["sha256"],  # <-- Use this
}
```

### Frontend Integration

```javascript
// In CodeMirror component
this.lastSha256 = null;
this.scopeCache = new ScopeCache();

// Handle events from core_read.py subscription
handleFileEvent(event) {
  if (event.sha256 !== this.lastSha256) {
    this.lastSha256 = event.sha256;
    this.scopeCache.invalidate();
  }
}

// In sticky scroll plugin
updateStickyHeader() {
  // Check cache validity against component's sha256
  if (this.scopeCache.sha256 !== cmComponent.lastSha256) {
    this.scopeCache.rebuild(this.view);
    this.scopeCache.sha256 = cmComponent.lastSha256;
  }
  // ... use cached scopes ...
}
```

---

## Implementation Order

### Phase 1: Quick Wins (All Paths)
1. Fix `lastScrollTop` early return bug
2. Add CSS transitions to `.cm-sticky-layer`
3. Remove redundant ternary
4. Remove `topOffset` from `renderKey`

### Phase 2: Scope Cache (Required for Paths 1 & 3)
1. Implement `ScopeCache` class
2. Wire up `sha256` invalidation from `core_read.py`
3. Add partial-parse detection and retry
4. Replace ancestor-chain walk with cache lookup

### Phase 3: Rendering Improvements (All Paths)
1. Separate state calculation from DOM updates
2. Implement partial DOM rebuilds
3. Update transform without DOM rebuild

### Phase 4: Choose Activation Model
- **Path 1:** Keep n+1 trigger logic, add sibling handoff from cache
- **Path 2:** Replace with Monaco geometric condition
- **Path 3:** n+1 activation + Monaco push-up calculation

---

## Testing Checklist

- [ ] Python: `file_editor_cm6/main.py` lines 268/281 no longer pile up
- [ ] JavaScript: Nested functions/classes activate correctly
- [ ] Word wrap ON: No drift at document bottom
- [ ] Word wrap OFF: Classic n+1 behavior preserved
- [ ] Push-up animation: Smooth, doesn't get stuck
- [ ] Frame rate: No visible jank during fast scroll
- [ ] File switch: Cache invalidates, new scopes detected
- [ ] External edit: `sha256` change triggers cache rebuild
- [ ] Partial parse: Incomplete tree doesn't cause piling

---

## Files to Modify

| File | Changes |
|------|---------|
| `app/static/vendor/nicegui/elements/codemirror/codemirror.js` | Main sticky scroll implementation |
| `app/apps/file_editor_cm6/core_read.py` | Already provides `sha256` (no changes needed) |

---

*atlas - t2 contributor*
*2025-12-05*
