# Sticky Scroll Refactor

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** CM6 LSP Integration (tmp5)  
**Blocks:** Nothing (final step)

---

## Purpose

Replace Lezer-based scope detection with LSP document symbols in sticky scroll.

---

## Scope

- Consume LSP symbol tree instead of Lezer syntax tree
- Convert symbols to sticky sections
- Keep Markdown fallback (foldable path)
- Keep non-LSP fallback for languages without servers

---

## Current Implementation

```javascript
// In updateStickyHeader() - codemirror.js ~line 1910
if (isMarkdown) {
  // Custom heading collection
} else {
  // Lezer syntax tree traversal
  const tree = CM.ensureSyntaxTree(state, state.doc.length, 200);
  let node = tree.resolveInner(refPos);
  for (; node; node = node.parent) {
    if (isScopeNode(node, scopeTypes, state, isPython)) {
      ancestorNodes.push(node);
    }
  }
}
```

---

## New Implementation

### Symbol Storage
```javascript
// Add to plugin class
this.lspSymbols = null;  // Cached LSP symbol tree
this.lspSymbolsStale = true;

// Called from CM6 LSP integration
updateSymbols(symbols) {
  this.lspSymbols = symbols;
  this.lspSymbolsStale = false;
  this.updateStickyHeader();
}
```

### Symbol → Section Conversion
```javascript
function flattenSymbolsToSections(state, symbols) {
  const sections = [];
  
  function walk(symbol, depth) {
    // Convert LSP range to line numbers
    const startPos = symbol.range.start;
    const endPos = symbol.range.end;
    const startLine = state.doc.lineAt(startPos).number;
    const endLine = state.doc.lineAt(endPos).number;
    
    // Get the text of the first line (for display)
    const lineText = state.doc.line(startLine).text;
    
    sections.push({
      depth,
      startLine,
      endLine,
      text: lineText,
      name: symbol.name,
      kind: symbol.kind,  // Class=5, Function=12, etc.
      node: { from: startPos, to: endPos },
    });
    
    if (symbol.children) {
      for (const child of symbol.children) {
        walk(child, depth + 1);
      }
    }
  }
  
  for (const sym of symbols) {
    walk(sym, 0);
  }
  
  return sections;
}
```

### Modified updateStickyHeader
```javascript
updateStickyHeader(isRetry = false) {
  // ... existing geometry code ...
  
  let candidateScopes = [];
  
  if (isMarkdown) {
    // Keep existing Markdown path
    candidateScopes = this.buildMarkdownScopes(state, refLine);
  } else if (this.lspSymbols && !this.lspSymbolsStale) {
    // NEW: Use LSP symbols
    const allSections = flattenSymbolsToSections(state, this.lspSymbols);
    candidateScopes = this.filterSectionsForRefLine(allSections, refLine);
  } else {
    // FALLBACK: Original Lezer path (for languages without LSP)
    candidateScopes = this.buildLezerScopes(state, refLine, tree);
  }
  
  // ... rest of existing code (slots, rendering) unchanged ...
}
```

### Filter Sections for Reference Line
```javascript
filterSectionsForRefLine(sections, refLine) {
  // Find all sections that contain refLine
  const containing = sections.filter(s => 
    refLine >= s.startLine && refLine <= s.endLine
  );
  
  // Sort by depth (outermost first)
  containing.sort((a, b) => a.depth - b.depth);
  
  // Build ancestor chain (one per depth level)
  const ancestors = [];
  let lastDepth = -1;
  for (const s of containing) {
    if (s.depth > lastDepth) {
      ancestors.push(s);
      lastDepth = s.depth;
    }
  }
  
  return ancestors;
}
```

---

## Code to Remove

Once LSP path is working:
- `isScopeNode()` function
- `getScopeTypes()` function
- Python-specific offset tuning
- Language-specific `scopeTypes` arrays

**Keep for fallback:**
- Markdown heading collection
- Basic Lezer traversal (simplified)

---

## Files to Modify

- **MODIFY:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - `stickyScrollPlugin` class
  - `updateStickyHeader()` method
  - Add `flattenSymbolsToSections()`
  - Add `filterSectionsForRefLine()`

---

## Testing

1. Open Python file with nested classes/functions
2. Verify sticky scroll shows more nesting than before
3. Open Markdown file, verify fallback still works
4. Switch between Python/Markdown, verify correct path used

---

## LSP Symbol Kinds Reference

```
1  = File
2  = Module
3  = Namespace
4  = Package
5  = Class
6  = Method
7  = Property
8  = Field
9  = Constructor
10 = Enum
11 = Interface
12 = Function
13 = Variable
...
```

Filter to show: Class (5), Method (6), Function (12), Constructor (9)

---

*Last Updated: 2025-12-07*
