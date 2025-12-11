I'll review your sticky scroll implementation plan and do some web searches to validate the approach and check for any recent developments. ## Review of Your Sticky Scroll Implementation Plan

I've reviewed your `cm_6_sticky_scroll_sticky_header_guide_corrected.md` against your existing architecture (from `TECHNICAL. md` and the feature guidelines) and validated it with current web sources. Overall, **your plan is solid and well-researched**. Here's my detailed analysis:

---

## ✅ What You Got Right

### 1. **Panel-Based Approach (Correct)**
Your decision to use CodeMirror's `showPanel` facet rather than CSS `position: sticky` is exactly right. The web searches confirm that CM6's virtualized rendering makes native sticky positioning unreliable—panels are the recommended approach [[CodeMirror Panel Example](https://codemirror.net/examples/panel/)]. 

### 2.  **Syntax Tree via `syntaxTree()` and `resolveInner()` (Correct)**
Your approach to use Lezer's `Tree. resolveInner(pos)` to find the deepest node and walk up the parent chain is the standard pattern. The Lezer docs confirm this is how to locate enclosing scopes [[Lezer Reference Manual](https://lezer.codemirror.net/docs/ref/)].

### 3. **Node Type Names (Mostly Correct)**
Your listed node names are accurate for the most part:
- **JavaScript:** `FunctionDeclaration`, `MethodDeclaration`, `ClassDeclaration` ✅
- **Python:** `FunctionDefinition`, `ClassDefinition` ✅

However, you're **missing some common cases**—see improvements below.

### 4. **Update Strategy (`viewportChanged` + `docChanged`)**
Your check for `update.viewportChanged || update.docChanged` before recomputing is efficient and correct. 

### 5.  **Compartment Integration Pattern**
Your plan to use a `Compartment` for toggling (matching your existing minimap/zebra-stripes pattern) aligns perfectly with your `codemirror. js` architecture.

---

## ⚠️ Areas for Improvement

### 1. **Missing Node Types for JavaScript/TypeScript**

You only list `FunctionDeclaration`, `MethodDeclaration`, and `ClassDeclaration`. The `@lezer/javascript` grammar has more:

```javascript
const SCOPE_NODE_TYPES = new Set([
  // Functions
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
  "MethodDeclaration",
  
  // Classes
  "ClassDeclaration",
  "ClassExpression",
  
  // Object methods (important for React/Vue)
  "Property",  // when it's a method: { foo() {} }
  
  // TypeScript-specific
  "InterfaceDeclaration",
  "TypeAliasDeclaration",
]);
```

**Recommendation:** Build a language-aware lookup table, similar to your `LANGUAGE_INDENT_MAP` in `codemirror.js`. 

### 2.  **`view.viewport. from` May Be Imprecise**

Your guide correctly notes this is an "over-approximation." For wrapped lines, `viewport.from` can be significantly before what's visually at the top. 

**Better approach:** Use `view.lineBlockAtHeight(view.scrollDOM.scrollTop)` to get the actual first visible line block:

```javascript
const scrollTop = view.scrollDOM.scrollTop;
const firstVisibleBlock = view.lineBlockAtHeight(scrollTop);
const pos = firstVisibleBlock.from;
```

### 3. **Incomplete Tree Handling**

Your mention of `ensureSyntaxTree` and `forceParsing` is good, but your code example doesn't actually use them.  For large files or jump-to-definition scenarios, the tree at `viewport.from` may not be parsed yet.

**Add this guard:**

```javascript
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";

// In your update handler:
const pos = view.viewport. from;
if (! syntaxTreeAvailable(state, pos)) {
  // Tree not ready—either skip or force parsing
  return; // or schedule a re-check
}
```

### 4. **Missing: Duplicate Line Suppression Logic**

Your guide mentions checking if the definition line is still visible, which is great. But your code example uses:

```javascript
const defIsFullyAbove = defLine.to <= vp.from;
```

This checks document positions, but with line wrapping, a long line could have `defLine.to > vp.from` while the *visual* start is still off-screen.  Consider using block geometry:

```javascript
const defBlock = view.lineBlockAt(defNode.from);
const scrollTop = view.scrollDOM.scrollTop;
const fullyOffscreen = defBlock.bottom <= scrollTop;
```

### 5.  **Missing: Multi-Line Context Stack (Like VS Code)**

Your guide mentions this as optional, but VS Code's implementation is a key UX feature. When you're inside a method inside a class, VS Code shows:

```
class MyClass {
  method foo(bar) {
```

**Recommendation:** Collect all ancestor scopes and display them stacked.  Your code already builds `scopes[]` array—just render all of them instead of only the innermost.

### 6. **Missing: Click-to-Jump Interaction**

Monaco's sticky scroll lines are **clickable**—clicking jumps you to that scope. Your guide doesn't mention this, but it's a significant UX enhancement.

**Implementation:**

```javascript
dom.addEventListener('click', () => {
  view.dispatch({
    selection: { anchor: defNode. from },
    scrollIntoView: true,
  });
  view.focus();
});
```

### 7. **Performance: Consider Caching the Scope Computation**

Your current plan recomputes on every viewport change. For smooth scrolling, this could be called 60+ times per second. Consider:

```javascript
let lastPos = -1;
let lastScopes = [];

update(update) {
  const pos = view.viewport.from;
  if (pos === lastPos && ! update. docChanged) return; // Use cached
  lastPos = pos;
  // ... compute scopes ...
  lastScopes = scopes;
}
```

---

## 🔍 Validation from Web Sources

| Your Assumption | Web Confirmation |
|-----------------|------------------|
| No built-in CM6 sticky scroll | ✅ Confirmed—custom extension required [[discuss. codemirror.net](https://discuss.codemirror.net/t/sticky-top-line-that-stays-fixed-frozen-vertically-at-the-top-of-the-view/8813)] |
| Use `showPanel` for fixed header | ✅ Correct approach [[CodeMirror Panel Example](https://codemirror.net/examples/panel/)] |
| Monaco uses Document Symbol/Outline model | ✅ Confirmed—falls back to indentation for unsupported languages [[Monaco API](https://microsoft. github.io/monaco-editor/typedoc/interfaces/editor.IEditorStickyScrollOptions. html)] |
| Lezer `resolveInner` for deepest node | ✅ Standard pattern [[Lezer docs](https://lezer.codemirror.net/docs/ref/)] |

---

## 📝 Integration with Your Architecture

Based on your `TECHNICAL.md` and guidelines, here's how this fits:

### Vendoring Path
```
app/static/vendor/nicegui/elements/codemirror/
├── codemirror.py  # Add: set_sticky_scroll(enabled: bool)
├── codemirror.js  # Add: applyStickyScroll() + stickyHeaderCompartment
└── src/index.mjs  # No new packages needed—uses existing Lezer
```

### Preference Integration
Following your `preferences_store.py` pattern:

```python
DEFAULT_EDITOR_PREFS: Dict[str, Any] = {
    # ... existing ... 
    "stickyScroll": False,  # Add this
}
```

### Your Existing Pattern to Follow
Your minimap implementation in `codemirror.js` is the template:
- Self-contained layout logic (watches `window.matchMedia`)
- Compartment-based toggling
- Dependency on other extensions (minimap reads `diffField`)

Sticky scroll should similarly:
- Read from syntax tree (already available via language extensions)
- Use a Compartment for toggling
- Integrate with your preference system

---

## 🎯 Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| Core approach | ✅ Correct | Panel + syntax tree is right |
| Node type coverage | ⚠️ Incomplete | Add arrow functions, expressions, TS types |
| Viewport position | ⚠️ Could improve | Use `lineBlockAtHeight` for precision |
| Tree availability | ⚠️ Not handled | Add `syntaxTreeAvailable` guard |
| Duplicate suppression | ⚠️ Position-based | Use block geometry for wrapped lines |
| Multi-line stack | 📝 Optional but valuable | Implement for VS Code parity |
| Click-to-jump | ❌ Missing | Important UX feature |
| Performance | ⚠️ Not addressed | Add position caching |
| Integration pattern | ✅ Well-planned | Matches your existing Compartment approach |

**Bottom line:** Your plan is architecturally sound and demonstrates good understanding of CM6.  The main gaps are edge cases (wrapped lines, incomplete trees, more node types) and UX polish (click-to-jump, multi-line stack).  These are refinements, not fundamental issues. 

---

# Sticky Scroll Implementation Analysis for Code CM6

**Created:** 2025-12-03  
**Author:** Analysis for mrSurge / TE2 Team  
**Purpose:** Validate sticky scroll implementation plan against architecture and current web knowledge

---

## Executive Summary

**Verdict: ✅ IMPLEMENTATION IS FEASIBLE**

Your sticky scroll implementation plan in `tmp.md` and refinements in `tmp2.md` are architecturally sound and align with CodeMirror 6 best practices. The approach is validated by current web sources and fits seamlessly into your existing NiceGUI + vendored CM6 architecture.

**Key Finding:** No fundamental blockers exist. The feature can be implemented using CM6's native `showPanel` API combined with Lezer syntax tree traversal—exactly as your plan describes.

---

## Table of Contents

1. [Architecture Compatibility Analysis](#1-architecture-compatibility-analysis)
2. [Web Search Validation](#2-web-search-validation)
3. [Implementation Plan Review](#3-implementation-plan-review)
4. [Gaps and Improvements](#4-gaps-and-improvements)
5. [Language Support Matrix](#5-language-support-matrix)
6. [Performance Considerations](#6-performance-considerations)
7. [Integration Checklist](#7-integration-checklist)
8. [Risk Assessment](#8-risk-assessment)
9. [Recommended Implementation Order](#9-recommended-implementation-order)

---

## 1. Architecture Compatibility Analysis

### ✅ Framework Integration Points

Based on your `TECHNICAL.md` and `2025-12-03_code_cm6_feature_adding_guidelines.md`:

| Component | Compatibility | Notes |
|-----------|--------------|-------|
| **Vendored CM6** | ✅ Full | Add to `codemirror.js` like minimap/zebra-stripes |
| **Compartment Pattern** | ✅ Full | Toggle via `Compartment.reconfigure()` |
| **Preference Store** | ✅ Full | Add `"stickyScroll": false` to `DEFAULT_EDITOR_PREFS` |
| **NiceGUI iframe** | ✅ Full | Panel lives inside CM6, no cross-frame issues |
| **showPanel facet** | ✅ Full | Native CM6 API, no external packages needed |
| **Lezer syntax tree** | ✅ Full | Already available via language extensions |

### File Locations for Implementation

```
app/static/vendor/nicegui/elements/codemirror/
├── codemirror.py          # Add: set_sticky_scroll(enabled: bool)
├── codemirror.js          # Add: applyStickyScroll(), stickyHeaderCompartment
└── src/index.mjs          # NO CHANGES NEEDED - Lezer already exported

app/apps/file_editor_cm6/
├── preferences_store.py   # Add: "stickyScroll": False to defaults
├── editor_app.py          # Add: update_preference case + page/file load
└── main.js                # Add: menu toggle binding
```

### Why This Works With Your Architecture

1. **No iframe barrier issues:** The panel is a CM6 panel inside the editor's DOM—it doesn't cross the iframe boundary.

2. **Follows existing patterns:** Your minimap implementation (from `TECHNICAL.md` Section 17) is the exact template:
   - Self-contained layout logic inside `codemirror.js`
   - Compartment-based toggling
   - Dependency on other extensions (minimap reads `diffField`; sticky scroll reads syntax tree)

3. **No bundle rebuild required:** Unlike the search panel feature, sticky scroll uses only:
   - `showPanel` from `@codemirror/view` (already bundled)
   - `syntaxTree` from `@codemirror/language` (already bundled)
   - Lezer tree traversal APIs (already bundled)

---

## 2. Web Search Validation

### Confirmed: Panel-Based Approach is Correct

**Source:** [CodeMirror Panel Example](https://codemirror.net/examples/panel/)

> "CodeMirror 6 doesn't natively offer a 'sticky scroll' for headers... but it provides a powerful panel API via `@codemirror/view`. Panels can be placed above or below the editor, and will remain visible as you scroll."

**Confirmed:** Your decision to use `showPanel` rather than CSS `position: sticky` is the recommended approach.

### Confirmed: Syntax Tree Access Pattern

**Source:** [Lezer Reference Manual](https://lezer.codemirror.net/docs/ref/)

> "Lezer's `Tree.resolveInner(pos)` method gives the deepest node covering a given position. From there, you walk upward (`node.parent`) until you encounter a node type corresponding to a function or class."

**Confirmed:** Your `resolveInner(pos)` + parent chain traversal is the standard pattern.

### Confirmed: Monaco's Implementation Model

**Source:** [Monaco Editor API - IEditorStickyScrollOptions](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IEditorStickyScrollOptions.html)

Monaco uses three models for sticky scroll:
1. **outlineModel** - Uses syntax structure (functions, classes)
2. **foldingProviderModel** - Uses folding ranges
3. **indentationModel** - Uses indentation levels

**Recommendation:** Your syntax-tree-based approach matches Monaco's `outlineModel`, which is the most accurate. Consider adding indentation fallback for unsupported languages.

### Confirmed: Performance Best Practices

**Source:** [CodeMirror Panel Performance Discussion](https://codemirror.net/examples/panel/)

Key findings:
- Only update panel DOM when there's a genuine change
- Use comparison checks to prevent redundant modifications
- Prefer text node updates over innerHTML rebuilds
- Cache computed values that don't change on every scroll

---

## 3. Implementation Plan Review

### What Your Plan Gets Right ✅

| Aspect | Your Plan | Status |
|--------|-----------|--------|
| Core API choice | `showPanel` facet | ✅ Correct |
| Tree access | `syntaxTree(state)` | ✅ Correct |
| Node resolution | `tree.resolveInner(pos)` | ✅ Correct |
| Position reference | `view.viewport.from` | ⚠️ Adequate (see improvements) |
| Update trigger | `viewportChanged \|\| docChanged` | ✅ Correct |
| Compartment toggle | Yes | ✅ Matches existing pattern |
| Duplicate suppression | Check if def line visible | ✅ Good UX |

### Code Quality Assessment

Your `tmp.md` code example:

```javascript
function createStickyPanel(view) {
  const dom = document.createElement("div");
  dom.className = "cm-stickyHeader";
  
  return {
    top: true,
    dom,
    update(update) {
      if (!update.viewportChanged && !update.docChanged) return;
      // ... syntax tree traversal
    },
  };
}
```

**Verdict:** This is clean, follows CM6 conventions, and will work.

---

## 4. Gaps and Improvements

### Gap 1: Incomplete Node Type Coverage

**Your plan lists:**
```javascript
"FunctionDeclaration", "FunctionDefinition", "MethodDeclaration",
"ClassDeclaration", "ClassDefinition"
```

**Missing (confirmed by Lezer grammar search):**

#### JavaScript/TypeScript (@lezer/javascript)
```javascript
const JS_SCOPE_TYPES = new Set([
  // Functions
  "FunctionDeclaration",
  "FunctionExpression",      // ← MISSING
  "ArrowFunction",           // ← MISSING
  "MethodDeclaration",
  "MethodDefinition",        // ← MISSING (ES6 class methods)
  
  // Classes
  "ClassDeclaration",
  "ClassExpression",         // ← MISSING
  
  // TypeScript-specific
  "InterfaceDeclaration",    // ← MISSING
  "TypeAliasDeclaration",    // ← MISSING
  "EnumDeclaration",         // ← MISSING
]);
```

#### Python (@lezer/python)
```javascript
const PYTHON_SCOPE_TYPES = new Set([
  "FunctionDefinition",
  "ClassDefinition",
  // Note: Python async functions use the same node type with async keyword
]);
```

**Recommendation:** Create a language-aware lookup map similar to your `LANGUAGE_INDENT_MAP`:

```javascript
const SCOPE_NODE_TYPES = {
  javascript: ["FunctionDeclaration", "FunctionExpression", "ArrowFunction", 
               "MethodDeclaration", "MethodDefinition", "ClassDeclaration", 
               "ClassExpression"],
  typescript: ["FunctionDeclaration", "FunctionExpression", "ArrowFunction",
               "MethodDeclaration", "MethodDefinition", "ClassDeclaration",
               "ClassExpression", "InterfaceDeclaration", "TypeAliasDeclaration",
               "EnumDeclaration"],
  python: ["FunctionDefinition", "ClassDefinition"],
  // Add more as needed
};
```

### Gap 2: Viewport Position Precision

**Your plan uses:**
```javascript
const pos = view.viewport.from;
```

**Issue:** With line wrapping, `viewport.from` is an over-approximation. A long wrapped line could have its start position before the viewport's visual top.

**Better approach (from web search):**
```javascript
// Use actual visual top
const scrollTop = view.scrollDOM.scrollTop;
const firstVisibleBlock = view.lineBlockAtHeight(scrollTop);
const pos = firstVisibleBlock.from;
```

### Gap 3: Incomplete Tree Handling

**Your plan mentions** `ensureSyntaxTree` but doesn't implement it.

**Add this guard:**
```javascript
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";

update(update) {
  const pos = view.viewport.from;
  
  // Guard: tree may not be parsed yet at this position
  if (!syntaxTreeAvailable(update.state, pos)) {
    dom.textContent = ""; // or keep previous value
    return;
  }
  
  const tree = syntaxTree(update.state);
  // ... rest of logic
}
```

### Gap 4: Missing Click-to-Jump

**Monaco feature:** Clicking a sticky line jumps to that scope.

**Implementation:**
```javascript
function createStickyPanel(view) {
  const dom = document.createElement("div");
  dom.className = "cm-stickyHeader";
  
  let currentDefNode = null; // Track for click handler
  
  dom.addEventListener('click', () => {
    if (currentDefNode) {
      view.dispatch({
        selection: { anchor: currentDefNode.from },
        scrollIntoView: true,
      });
      view.focus();
    }
  });
  
  return {
    top: true,
    dom,
    update(update) {
      // ... existing logic
      currentDefNode = defNode; // Store reference
    },
  };
}
```

### Gap 5: Missing Multi-Line Context Stack

**Monaco feature:** Shows nested scopes (class → method → inner function).

**Your plan mentions this but only implements innermost scope.**

**Enhancement:**
```javascript
// Build full scope stack
const scopes = [];
for (let node = tree.resolveInner(pos); node; node = node.parent) {
  if (SCOPE_NODE_TYPES.has(node.name)) {
    scopes.push(node);
  }
}

// Render all scopes (outermost first)
scopes.reverse();
const lines = scopes.map(n => state.doc.lineAt(n.from).text.trim());
dom.innerHTML = lines.map(l => `<div class="cm-sticky-line">${escapeHtml(l)}</div>`).join('');
```

### Gap 6: Performance Caching

**Issue:** Recomputes on every viewport change (60+ times/sec during scroll).

**Add position caching:**
```javascript
let lastPos = -1;
let lastScopes = [];
let lastDocLength = -1;

update(update) {
  const pos = view.viewport.from;
  const docLength = update.state.doc.length;
  
  // Skip if position unchanged and doc unchanged
  if (pos === lastPos && docLength === lastDocLength && !update.docChanged) {
    return;
  }
  
  lastPos = pos;
  lastDocLength = docLength;
  // ... compute scopes
}
```

---

## 5. Language Support Matrix

Based on web search validation of Lezer grammars:

| Language | Supported Node Types | Notes |
|----------|---------------------|-------|
| **JavaScript** | FunctionDeclaration, FunctionExpression, ArrowFunction, MethodDeclaration, ClassDeclaration, ClassExpression | Full support |
| **TypeScript** | All JS types + InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration | Full support via "ts" dialect |
| **Python** | FunctionDefinition, ClassDefinition | Full support |
| **HTML/CSS** | Limited | No function/class concepts |
| **JSON** | None | No scope concepts |
| **Markdown** | Heading nodes possible | Could show ## headers |
| **Java/C/C++** | Depends on Lezer grammar availability | May need custom handling |
| **Go** | FunctionDeclaration, TypeDeclaration | Needs verification |
| **Rust** | FunctionItem, StructItem, ImplItem | Needs verification |

**Fallback Strategy:** For unsupported languages, consider Monaco's `indentationModel` approach—show lines at lower indentation levels.

---

## 6. Performance Considerations

### Confirmed Best Practices (from web search)

| Practice | Implementation |
|----------|---------------|
| **Minimize DOM changes** | Update textContent, not innerHTML |
| **Conditional updates** | Check `viewportChanged \|\| docChanged` |
| **Position caching** | Store `lastPos`, skip if unchanged |
| **CSS over JS** | Use CSS for show/hide, opacity changes |
| **Compact panel** | Keep panel height minimal |

### Recommended Performance Pattern

```javascript
const stickyScrollExtension = [
  // Theme for styling
  EditorView.baseTheme({
    ".cm-stickyHeader": {
      backgroundColor: "var(--cm-editor-bg, #1e1e1e)",
      borderBottom: "1px solid #333",
      padding: "2px 8px",
      fontFamily: "inherit",
      fontSize: "inherit",
      whiteSpace: "pre",
      overflow: "hidden",
      textOverflow: "ellipsis",
      cursor: "pointer",
      // Use will-change for smooth scroll
      willChange: "contents",
    },
    ".cm-stickyHeader:empty": {
      display: "none", // Hide when no scope
    },
    ".cm-sticky-line": {
      paddingLeft: "1em", // Indent nested scopes
    },
    ".cm-sticky-line:first-child": {
      paddingLeft: "0",
    },
  }),
  
  // Panel extension
  showPanel.of(createStickyPanel),
];
```

---

## 7. Integration Checklist

Based on your `2025-12-03_code_cm6_feature_adding_guidelines.md`:

### Phase 1: Backend Setup
- [ ] Add `"stickyScroll": false` to `DEFAULT_EDITOR_PREFS` in `preferences_store.py`
- [ ] Add case to `update_preference()` in `editor_app.py`
- [ ] Add to `_get_view_state_dict()` in `editor_app.py`
- [ ] Apply at page load (~line 390 in `editor_app.py`)
- [ ] Apply at file load (~line 640 in `editor_app.py`)

### Phase 2: Vendored CM6
- [ ] Add `set_sticky_scroll(enabled: bool)` to `codemirror.py`
- [ ] Add `applyStickyScroll()` to `codemirror.js`
- [ ] Add `stickyHeaderCompartment` to `codemirror.js`
- [ ] Add base theme for `.cm-stickyHeader` styling
- [ ] Implement `createStickyPanel()` with all improvements

### Phase 3: Frontend
- [ ] Add menu item to View menu in `template.html`
- [ ] Add toggle binding in `main.js` using `updatePreference('stickyScroll', ...)`

### Phase 4: Testing
- [ ] Toggle ON works
- [ ] Toggle OFF works
- [ ] Persists across page refresh
- [ ] Works with JavaScript files
- [ ] Works with Python files
- [ ] Works with TypeScript files
- [ ] Click-to-jump works
- [ ] Multi-line nested scopes display correctly
- [ ] No performance issues during rapid scroll
- [ ] Works with line wrapping enabled
- [ ] No console errors
- [ ] Mobile layout unaffected

---

## 8. Risk Assessment

### Low Risk ✅

| Risk | Mitigation | Severity |
|------|------------|----------|
| Bundle rebuild needed | NOT NEEDED - all APIs already bundled | None |
| Iframe communication | NOT NEEDED - panel inside CM6 DOM | None |
| State drift | Follow preference store pattern | Low |

### Medium Risk ⚠️

| Risk | Mitigation | Severity |
|------|------------|----------|
| Line wrapping edge cases | Use `lineBlockAtHeight()` instead of `viewport.from` | Medium |
| Tree not parsed | Add `syntaxTreeAvailable()` guard | Medium |
| Performance on large files | Add position caching | Medium |
| Missing node types | Build language-aware lookup table | Medium |

### Potential Blockers 🔴

| Risk | Status | Notes |
|------|--------|-------|
| CM6 doesn't support sticky panels | **NOT A BLOCKER** | showPanel confirmed working |
| Lezer trees unavailable | **NOT A BLOCKER** | Already bundled via language extensions |
| NiceGUI blocks panel creation | **NOT A BLOCKER** | Panels are standard CM6 feature |

---

## 9. Recommended Implementation Order

### Sprint 1: MVP (1-2 hours)
1. Add preference store entry
2. Implement basic `createStickyPanel()` with single scope
3. Add Compartment toggle
4. Wire up menu item
5. Test with JavaScript file

### Sprint 2: Robustness (1-2 hours)
1. Add language-aware node type lookup
2. Add `syntaxTreeAvailable()` guard
3. Improve viewport position with `lineBlockAtHeight()`
4. Add position caching for performance

### Sprint 3: Monaco Parity (1-2 hours)
1. Implement multi-line scope stack
2. Add click-to-jump
3. Style refinements (match Monaco aesthetic)
4. Test all supported languages

### Sprint 4: Polish (1 hour)
1. Mobile testing
2. Line wrapping edge cases
3. Documentation update
4. AGENTS.log entry

---

## Conclusion

**Your implementation plan is solid.** The panel-based approach with syntax tree traversal is the correct architecture for CM6. All required APIs are already bundled in your vendored NiceGUI, so no `npm install` or bundle rebuild is needed.

The gaps identified (node type coverage, viewport precision, click-to-jump, multi-line stack, performance caching) are refinements, not blockers. You can ship an MVP in Sprint 1 and iterate toward full Monaco parity.

**Bottom line:** This feature is achievable and fits perfectly into your existing architecture. Don't trash CM6 yet—sticky scroll is within reach!

---

## References

### Web Sources Consulted
1. [CodeMirror Panel Example](https://codemirror.net/examples/panel/)
2. [Monaco Editor API - IEditorStickyScrollOptions](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IEditorStickyScrollOptions.html)
3. [Lezer Reference Manual](https://lezer.codemirror.net/docs/ref/)
4. [Lezer JavaScript Grammar](https://github.com/lezer-parser/javascript/blob/main/src/javascript.grammar)
5. [Lezer Python Grammar](https://github.com/lezer-parser/python/blob/main/src/python.grammar)
6. [CodeMirror Forum - Sticky Scroll Discussion](https://discuss.codemirror.net/t/sticky-top-line-that-stays-fixed-frozen-vertically-at-the-top-of-the-view/8813)
7. [CodeMirror Forum - Panel Performance](https://discuss.codemirror.net/t/how-to-create-a-right-side-panel-thats-immune-to-scrolling/9034)
8. [@overleaf/codemirror-tree-view](https://github.com/overleaf/codemirror-tree-view)

### Internal Documentation Referenced
- `/docs/apps/code_cm6/README.md`
- `/docs/apps/code_cm6/TECHNICAL.md`
- `/docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`
- `/tmp.md` (original plan)
- `/tmp2.md` (revision)

---

**Document Status:** Complete  
**Next Action:** Proceed with Sprint 1 implementation


---

# Sticky Scroll Implementation Plan - Code CM6

**Created:** 2025-12-03  
**Updated:** 2025-12-03  
**Author:** vectorArc - TE2 Team  
**Status:** Sprint 1 COMPLETE ✅  
**Estimated Time:** 4-6 hours total (Sprint 1-4)

---

## Overview

Implement Monaco-style "sticky scroll" for CodeMirror 6 that pins function/class signatures to the top of the viewport while scrolling through code blocks.

---

## Sprint 1: MVP (1-2 hours) ✅ COMPLETE

### 1.1 Add Preference Store Entry ✅

**File:** `app/apps/file_editor_cm6/preferences_store.py`

Added `"stickyScroll": False` to `DEFAULT_EDITOR_PREFS`.

### 1.2 Add Vendored Python Wrapper ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

Added `set_sticky_scroll(enabled: bool)` method.

### 1.3 Add Vendored JavaScript Implementation ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

Added:
- `stickyScrollCompartment` in data section
- `applyStickyScroll(enabled)` method with:
  - Language-aware scope node types (JS, TS, Python, fallback)
  - Lezer syntax tree traversal via `tree.resolveInner(pos)`
  - Position caching for performance
  - Click-to-jump functionality
  - Multi-line scope stack display (max 5 lines)
  - CSS theming via `EditorView.baseTheme()`

### 1.4 Add Backend Integration ✅

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Added:
- `stickyScroll` to `_get_view_state_dict()`
- Case in `update_preference()` for `stickyScroll`
- `editor.set_sticky_scroll()` at page load
- `editor.set_sticky_scroll()` at file load

### 1.5 Add Menu Item ✅

**File:** `app/apps/file_editor_cm6/template.html`

Added menu item `mi-toggle-sticky-scroll` in View menu.

**File:** `app/apps/file_editor_cm6/main.js`

Added:
- `miToggleStickyScroll` element reference
- `bindMenuToggle()` handler
- `setMenuChecked()` in `applyMenuState()`

---

## Sprint 2: Robustness (1-2 hours)

### 2.1 Add syntaxTreeAvailable Import

Verify `CM.syntaxTreeAvailable` is exported. If not, add to bundle exports:

**File:** `app/static/vendor/nicegui/elements/codemirror/src/index.mjs`
```javascript
export { syntaxTreeAvailable } from "@codemirror/language";
```

Then rebuild: `npm run build`

### 2.2 Add MaxLines Configuration

Allow limiting the number of sticky lines (like Monaco's `maxLineCount`):

```javascript
// In applyStickyScroll, add maxLines parameter
applyStickyScroll(enabled, maxLines = 5) {
  // ... in the render section:
  const displayScopes = filteredScopes.slice(-maxLines); // Show last N (innermost)
  // or slice(0, maxLines) for outermost N
}
```

### 2.3 Handle Edge Cases

- Empty files
- Files without functions/classes
- Very long function signatures (truncate with ellipsis via CSS)
- Binary files (no syntax tree)

---

## Sprint 3: Monaco Parity (1-2 hours)

### 3.1 Add Line Numbers to Sticky Lines

Show line numbers for context:

```javascript
dom.innerHTML = filteredScopes.map((scope, idx) => {
  const lineNum = state.doc.lineAt(scope.node.from).number;
  return `<div class="cm-sticky-line" data-index="${idx}">
    <span class="cm-sticky-linenum">${lineNum}</span>
    ${escapeHtml(scope.lineText)}
  </div>`;
}).join('');
```

### 3.2 Add Gutter Alignment

Match the sticky header gutter width to the main editor gutter:

```css
".cm-stickyHeader": {
  paddingLeft: "var(--cm-gutter-width, 40px)",
}
```

### 3.3 Keyboard Shortcut

Add Ctrl+Shift+S or similar to toggle sticky scroll.

---

## Sprint 4: Polish (1 hour)

### 4.1 Mobile Testing

- Ensure panel doesn't interfere with touch scrolling
- Consider hiding on very small screens

### 4.2 Theme Integration

- Ensure colors match current theme
- Test with all bundled themes (Monokai, Dracula, etc.)

### 4.3 Documentation

- Update TECHNICAL.md with new section
- Update README.md feature list
- Add to AGENTS.log

---

## File Checklist

| File | Changes | Sprint |
|------|---------|--------|
| `preferences_store.py` | Add `stickyScroll` default | 1 |
| `codemirror.py` | Add `set_sticky_scroll()` method | 1 |
| `codemirror.js` | Add `applyStickyScroll()` + compartment | 1 |
| `editor_app.py` | Add preference handling | 1 |
| `template.html` | Add menu item | 1 |
| `main.js` | Add menu binding | 1 |
| `src/index.mjs` | Export `syntaxTreeAvailable` (if needed) | 2 |

---

## Testing Checklist

- [ ] Toggle ON shows sticky header
- [ ] Toggle OFF hides sticky header  
- [ ] Persists across page refresh
- [ ] Works with JavaScript files
- [ ] Works with Python files
- [ ] Works with TypeScript files
- [ ] Click-to-jump navigates correctly
- [ ] Nested scopes show correctly (class → method)
- [ ] No performance issues during rapid scroll
- [ ] Works with line wrapping enabled
- [ ] No console errors
- [ ] Menu checkmark updates correctly
- [ ] Mobile layout unaffected

---

## Ready to Begin

**Start with:** Sprint 1, Step 1.1 - Add preference store entry


---

# Scroll Position Detection Fix - Code CM6

**Created:** 2025-12-03T15:58:48Z  
**Author:** vectorArc - TE2 Team  
**Status:** In Progress  
**Previous:** tmp4_plan.md (Sprint 1 complete - sticky scroll MVP)

---

## Problem Statement

Both sticky scroll and the "resume on line N" scroll tracking report line positions that are "off" - typically triggering late or selling the line number short, especially at document bottom.

### Root Cause Analysis

**Current implementations use flawed approaches:**

1. **Sticky Scroll** (`applyStickyScroll`):
   ```javascript
   const scrollTop = view.scrollDOM.scrollTop;
   const firstBlock = view.lineBlockAtHeight(scrollTop);
   pos = firstBlock.from;
   ```
   **Problem:** `lineBlockAtHeight(scrollTop)` doesn't account for panels (like the sticky header itself!) which shift the coordinate system.

2. **Scroll Tracking** (`reportScrollPosition`):
   ```javascript
   const ranges = view.visibleRanges;
   const from = ranges[0].from;
   const lineInfo = state.doc.lineAt(from);
   ```
   **Problem:** `visibleRanges[0].from` returns the first *rendered* content position, but CM6 renders a buffer zone above/below the viewport for smooth scrolling. This is several lines BEFORE what's actually visible.

### Why Minimap Works

Minimap uses **scroll ratios** instead of CM6's document-position APIs:
```javascript
const { clientHeight, scrollHeight, scrollTop } = this.view.scrollDOM;
const scrollRatio = scrollTop / (scrollHeight - clientHeight);
```

### The Correct Approach

CM6 provides `posAtCoords()` which asks "what document position is at this screen coordinate?" - this accounts for all panels, decorations, and transformations.

```javascript
// Get editor's visual bounding box
const editorRect = view.dom.getBoundingClientRect();

// Ask: "what position is at the top-left of the visible editor?"
const pos = view.posAtCoords({ 
  x: editorRect.left + 10,  // Small offset to avoid gutter
  y: editorRect.top + 1     // Just inside the top edge
});

if (pos !== null) {
  const line = view.state.doc.lineAt(pos);
  // line.number is the ACTUAL visible line at top
}
```

---

## Implementation Plan

### Task 1: Fix Sticky Scroll Position Detection ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Location:** `applyStickyScroll()` method, inside `update(update)` function

**Change:** Replace `lineBlockAtHeight` approach with `posAtCoords`

**Before:**
```javascript
const scrollTop = view.scrollDOM.scrollTop;

// Use lineBlockAtHeight for precise position with line wrapping
let pos;
try {
  const firstBlock = view.lineBlockAtHeight(scrollTop);
  pos = firstBlock.from;
} catch {
  pos = view.viewport.from;
}
```

**After:**
```javascript
// Use posAtCoords for accurate position accounting for panels
let pos;
try {
  const editorRect = view.dom.getBoundingClientRect();
  const coords = { 
    x: editorRect.left + 50,  // Offset past gutter
    y: editorRect.top + 5     // Just inside top edge
  };
  const result = view.posAtCoords(coords);
  pos = result !== null ? result : view.viewport.from;
} catch {
  pos = view.viewport.from;
}

const scrollTop = view.scrollDOM.scrollTop;
```

### Task 2: Fix Scroll Tracking Position Detection ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Location:** `reportScrollPosition()` method

**Change:** Replace `visibleRanges[0].from` with `posAtCoords`

**Before:**
```javascript
const ranges = view.visibleRanges;
if (!ranges || !ranges.length) return;
const from = ranges[0].from;
const lineInfo = state.doc.lineAt(from);
const line = lineInfo.number;
```

**After:**
```javascript
// Use posAtCoords for accurate top-of-viewport line
const editorRect = view.dom.getBoundingClientRect();
const coords = { 
  x: editorRect.left + 50,  // Offset past gutter
  y: editorRect.top + 5     // Just inside top edge
};
const pos = view.posAtCoords(coords);
if (pos === null) return;

const lineInfo = state.doc.lineAt(pos);
const line = lineInfo.number;
```

### Task 3: Add Bottom-of-Document Detection ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Location:** `reportScrollPosition()` method

**Change:** Add special handling for document bottom

```javascript
// Detect if at bottom of document
const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM;
const atBottom = Math.abs(scrollTop + clientHeight - scrollHeight) < 2;

if (atBottom) {
  // Report last line when at bottom
  const lastLine = state.doc.lines;
  this.notifyParent('cm6-scroll-state', {
    line: lastLine,
    column: 0,
    top: state.doc.length,
    atBottom: true,
    timestamp: Date.now(),
  });
  return;
}
```

---

## Testing Checklist

- [ ] Sticky scroll triggers at correct position (not late)
- [ ] Sticky scroll works with panels enabled
- [ ] Scroll tracking reports correct line at top
- [ ] Scroll tracking detects bottom of document
- [ ] Works with word wrap enabled
- [ ] Works with line numbers on/off
- [ ] No console errors
- [ ] Performance acceptable during rapid scroll

---

## Files Modified

| File | Changes | Status |
|------|---------|--------|
| `codemirror.js` | Fix `applyStickyScroll()` position detection | ✅ |
| `codemirror.js` | Fix `reportScrollPosition()` detection | ✅ |
| `codemirror.js` | Add bottom-of-document handling | ✅ |

---

## Completion Log

- [x] Task 1: Fix sticky scroll - DONE
- [x] Task 2: Fix scroll tracking - DONE  
- [x] Task 3: Add bottom detection - DONE


---

# Sticky Scroll + Scroll Detection Progress Summary

**Created:** 2025-12-03T16:01:43Z  
**Author:** vectorArc - TE2 Team  

---

## Completed Work

### 1. Sticky Scroll Feature (Sprint 1 MVP) ✅

**Files Modified:**
- `app/apps/file_editor_cm6/preferences_store.py` - Added `"stickyScroll": False`
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py` - Added `set_sticky_scroll()` method
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js` - Added `applyStickyScroll()` + compartment
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` - Added preference handling + page/file load
- `app/apps/file_editor_cm6/template.html` - Added "Sticky Scroll" menu item
- `app/apps/file_editor_cm6/main.js` - Added toggle binding + menu state

**Features:**
- Toggle via View → Sticky Scroll menu
- Language-aware node types (JS, TS, Python, fallback)
- Click-to-jump to scope definition
- Multi-line nested scope display (max 5)
- CSS theming

### 2. Scroll Position Detection Fix ✅

**Problem:** Both sticky scroll and scroll tracking reported positions "late" or "short"

**Root Cause:** 
- `lineBlockAtHeight(scrollTop)` doesn't account for panels
- `visibleRanges[0].from` returns buffered render position, not visual top

**Solution:** Use `view.posAtCoords()` which asks "what document position is at this screen coordinate?"

**Files Modified:**
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - `applyStickyScroll()` - Now uses `posAtCoords` instead of `lineBlockAtHeight`
  - `reportScrollPosition()` - Now uses `posAtCoords` instead of `visibleRanges`
  - Added bottom-of-document detection (`atBottom` flag)

---

## Testing Required

- [ ] Sticky scroll triggers at correct position
- [ ] Scroll tracking reports correct line at top  
- [ ] Bottom of document detected correctly
- [ ] Works with word wrap enabled
- [ ] No console errors


---

# Sticky Scroll Implementation - Progress & Status

**Created:** 2025-12-03T17:05:55Z  
**Author:** vectorArc - TE2 Team  

---

## What's Working ✅

### 1. Core Feature
- Sticky scroll header appears at top of editor
- Shows enclosing function/class scope signatures
- Click-to-jump navigates to the scope definition
- Toggle via View → Sticky Scroll menu
- Preference persists across sessions

### 2. Positioning
- Overlay positioned with `position: absolute` inside `view.dom`
- Sits to the right of the gutter (left offset = gutter width)
- Spans from gutter edge to right side of editor

### 3. Scroll Detection
- Uses direct scroll listener on `view.scrollDOM` for immediate response
- Uses `view.posAtCoords()` for accurate viewport position detection
- No longer relies on CM6's batched `viewportChanged` updates

### 4. Syntax Tree Integration
- Language-aware scope node types (JS, TS, Python, fallback)
- Uses Lezer `tree.resolveInner(pos)` to walk up parent chain
- Finds all enclosing scopes, reverses to show outermost first

### 5. Indentation
- Preserves original line indentation (removed `.trim()`)
- Nested scopes display with their natural whitespace

---

## Files Modified

| File | Changes |
|------|---------|
| `preferences_store.py` | Added `"stickyScroll": False` default |
| `codemirror.py` | Added `set_sticky_scroll(enabled)` method |
| `codemirror.js` | Added `applyStickyScroll()` with ViewPlugin |
| `editor_app.py` | Added preference handling, page/file load hooks |
| `template.html` | Added "Sticky Scroll" menu item |
| `main.js` | Added toggle binding + menu state |

---

## Current Architecture

### ViewPlugin Structure (codemirror.js)
```
applyStickyScroll(enabled) {
  - Creates ViewPlugin with:
    - this.dom (div.cm-stickyHeader) appended to view.dom
    - this.currentScopes[] - array of {node, lineText}
    - Direct scroll listener on view.scrollDOM
    
  - updateStickyHeader():
    1. Get gutter width, set this.dom.style.left
    2. Get position via posAtCoords at editor top
    3. Get syntax tree, walk up to find scope nodes
    4. Filter scopes whose defBlock.bottom <= scrollTop + triggerOffset
    5. Render filtered scopes to this.dom.innerHTML
}
```

### CSS (baseTheme)
```css
.cm-stickyHeader {
  position: absolute;
  top: 0;
  left: [gutterWidth]px;
  right: 0;
  z-index: 10;
  background: var(--cm-editor-bg);
}
.cm-sticky-line {
  padding: 1px 8px 1px 4px;
  white-space: pre;
  cursor: pointer;
}
```

---

## Current Issue ❌

### Problem: Subsequent Scope Trigger Timing

**What should happen:**
- Scope 1 (outermost): triggers when its line is 1 line from top
- Scope 2 (nested): triggers when its line is 2 lines from top (accounting for scope 1 in overlay)
- Scope 3 (deeper): triggers when its line is 3 lines from top
- etc.

**What actually happens:**
- Scope 1: triggers correctly at +1 line offset ✅
- Scope 2+: still triggers at +1 line offset (should be +2, +3, etc.) ❌

**Intended behavior:**
The overlay grows as you scroll deeper into nested scopes. Each additional scope in the overlay takes up visual space, so the trigger point for the *next* scope should move down proportionally. Otherwise, the next scope's definition line disappears behind the overlay before it gets added to the header.

### What We've Tried
1. `(filteredScopes.length + 1) * lineHeight` - didn't work for subsequent scopes
2. `this.dom.offsetHeight + lineHeight + (index * lineHeight)` - same issue  
3. `Math.min(i, displayedCount) + 1` based on previous render count - same issue

### The Core Question
How do we make scope N trigger when its definition line is N lines from the viewport top, accounting for the fact that scopes 1 through N-1 are already displayed in the overlay?

---

## Committed State
Branch created and pushed with current working (but imperfect) implementation.


---

I've analyzed your implementation.  You're dealing with a classic "chicken and egg" timing problem with the overlay-based sticky scroll.  Let me break down what I see:

## The Core Problem

Your `n+1` formula is trying to solve two related but distinct issues:

1. **Base trigger offset (+1):** The minimap's scroll detection fires when a line is *completely* outside the viewport, but you want the sticky header to appear *just as* the line scrolls out—hence triggering one line early.

2. **Overlay occlusion offset (+n):** Once you have `n` scopes displayed in the overlay, those scopes physically cover the top `n × lineHeight` pixels of the viewport.  New scopes scrolling under that overlay are technically "in viewport" but visually hidden.

## The Bug in Your Current Implementation

```javascript
// How many scopes are currently displayed from previous render
const displayedCount = this.currentScopes.length;

// ... 

for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  // ...
  const levelOffset = Math.min(i, displayedCount) + 1;
  const triggerOffset = levelOffset * lineHeight;
  
  if (defBlock.bottom <= scrollTop + triggerOffset) {
    // ... 
  }
}
```

**The issue:** You're using `displayedCount` from the *previous* render, but you're iterating through `scopes` (the *current* potential scopes).  The `Math.min(i, displayedCount)` creates inconsistent behavior:

- When `i < displayedCount`: offset = `(i + 1) * lineHeight` ✓
- When `i >= displayedCount`: offset = `(displayedCount + 1) * lineHeight` for ALL remaining scopes

This means if you had 2 scopes displayed and now there are 4 potential scopes, scopes at index 2 and 3 both get the same offset `(2 + 1) * lineHeight = 3 lines`—which is wrong.

## The Correct Formula

Each scope at level `i` should trigger when its definition line scrolls above `(i + 1) * lineHeight` from the top.  The `+1` accounts for the base "trigger early" behavior you need.

```javascript
// Simpler and correct:
for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);
    // Each level needs its own offset:
    // Level 0 (outermost): triggers when defBlock.bottom <= scrollTop + (1 * lineHeight)
    // Level 1: triggers when defBlock.bottom <= scrollTop + (2 * lineHeight)
    // etc. 
    const triggerOffset = (i + 1) * lineHeight;
    
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

## Why Your Previous Approach Was Overcomplicated

You were trying to use `displayedCount` to handle the "overlay is already covering space" case, but that's already handled by the progressive `(i + 1)` offset:

- When you have 0 scopes displayed, scope 0 triggers at `1 * lineHeight` offset
- When you have 1 scope displayed (taking 1 line of space), scope 1 triggers at `2 * lineHeight` offset—which accounts for both the base trigger AND the space already occupied

The `displayedCount` from the previous frame is only needed if you want to prevent *flicker* during rapid scrolling (hysteresis), not for the offset calculation itself.

## Additional Edge Case: Variable Line Heights

If your sticky lines have different heights than editor lines (padding, borders), you should measure the actual overlay height:

```javascript
updateStickyHeader(forceUpdate = false) {
  // ... existing code...
  
  // Get actual overlay height for accurate offset
  const overlayHeight = this.dom.offsetHeight || 0;
  
  for (let i = 0; i < scopes.length; i++) {
    const scopeNode = scopes[i];
    try {
      const defBlock = view.lineBlockAt(scopeNode.from);
      // Base offset (trigger 1 line early) + existing overlay height
      // For scope i, we need: previous scopes' height + 1 line
      // Approximation: (i * avgStickyLineHeight) + lineHeight
      // Or simpler: just use (i + 1) * lineHeight if heights match
      const triggerOffset = (i + 1) * lineHeight;
      
      if (defBlock.bottom <= scrollTop + triggerOffset) {
        // ...
      }
    } catch {}
  }
}
```

## Summary

| Issue | Your Code | Fix |
|-------|-----------|-----|
| Base trigger | `+1` in formula | ✓ Correct |
| Per-level offset | `Math.min(i, displayedCount)` | Change to just `i` |
| Stale state dependency | Uses `this.currentScopes. length` | Remove—not needed for offset |

The corrected loop:

```javascript
const lineHeight = view.defaultLineHeight;
const filteredScopes = [];

for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);
    const triggerOffset = (i + 1) * lineHeight;
    
    if (defBlock.bottom <= scrollTop + triggerOffset) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes. push({
        node: scopeNode,
        lineText: defLine.text
      });
    }
  } catch {}
}

this.currentScopes = filteredScopes;
```

This should give you correct progressive triggering where each nested scope appears exactly when it would otherwise be hidden by the overlay. 

*ATLAS TE - 2 Team*

---

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

---

Looking at your sticky scroll implementation, I can see the issue causing the flicker. The problem is a **feedback loop** between the overlay height and the detection point. 

## The Core Problem

In your `updateStickyHeader` method:

```javascript
const overlayHeight = this. dom.offsetHeight || 0;
// ... 
const coords = { 
  x: editorRect.left + gutterWidth + 10,
  y: editorRect.top + overlayHeight + 5  // Detection below overlay
};
```

Here's what's happening:

1. **State A**: Overlay is empty (0 height), detection point is at top → cursor is outside scope → no sticky header shown
2. **State B**: You scroll down, cursor enters a function → scope detected → sticky header renders (now has height)
3.  **State C**: Next scroll event fires, `overlayHeight` is now ~20-30px → detection point moves DOWN → suddenly the detection point might be PAST the scope's trigger threshold OR inside a different context
4. **State D**: Scope disappears or changes → overlay height changes → back to State A or different state

This creates oscillation, especially when "floating around" near scope boundaries.

## The Fix

You need to **decouple the detection point from the current overlay height**.  Instead, use a **fixed maximum height** or calculate what the overlay height *would be* based on the number of scopes you're *looking for*, not what's currently rendered.

Here's the corrected approach:

```javascript
updateStickyHeader(forceUpdate = false) {
  const view = this.view;
  const state = view.state;
  const scrollTop = view.scrollDOM.scrollTop;
  
  const gutterEl = view.dom.querySelector('.cm-gutters');
  const gutterWidth = gutterEl ?  gutterEl.offsetWidth : 0;
  
  this.dom.style. top = '0';
  this. dom.style.left = gutterWidth + 'px';
  this.dom.style. right = '0';
  
  const lineHeight = view.defaultLineHeight;
  
  // ============================================================================
  // FIX: Use a FIXED detection offset, not the current overlay height
  // This prevents the feedback loop that causes flickering
  // We use max possible sticky lines (5) * lineHeight as a stable offset
  // ============================================================================
  const MAX_STICKY_LINES = 5;
  const stableDetectionOffset = MAX_STICKY_LINES * lineHeight;
  
  let pos;
  try {
    const editorRect = view.dom.getBoundingClientRect();
    const coords = { 
      x: editorRect.left + gutterWidth + 10,
      y: editorRect. top + stableDetectionOffset + 5  // FIXED offset, not dynamic
    };
    const result = view.posAtCoords(coords);
    pos = result !== null ? result : view.viewport.from;
  } catch {
    pos = view.viewport.from;
  }

  // ...  rest of your code stays the same
}
```

## Alternative Fix (Monaco's approach)

Monaco actually uses a different strategy - they detect scopes based on **scroll position in document coordinates**, not screen coordinates:

```javascript
updateStickyHeader(forceUpdate = false) {
  const view = this.view;
  const state = view.state;
  const scrollTop = view.scrollDOM.scrollTop;
  const lineHeight = view.defaultLineHeight;
  
  // ...  positioning code ...
  
  // ============================================================================
  // ALTERNATIVE: Use document position based on scroll, not screen coords
  // This is completely stable - no dependency on overlay rendering
  // ============================================================================
  const topLineBlock = view.lineBlockAtHeight(scrollTop);
  const pos = topLineBlock. from;
  
  // ... rest of scope detection
}
```

This approach uses `lineBlockAtHeight(scrollTop)` which gives you the line at the top of the viewport in document terms, completely independent of any overlay rendering.

*Atlas*


---

Yeah, I follow exactly why you needed the whole `n+1` thing now — you’re compensating for both:

1. The “one line early” behavior from the minimap logic, **and**
2. The fact that the sticky header itself eats up N visual lines, so nested scopes can still be *inside* the viewport but hidden under the overlay.

Right now your code is *almost* there, but the flicker is coming from how you’re mixing the previous render’s `currentScopes` with the new scopes when you decide what to show. The thresholds are moving around *just* enough near the boundary that a nested scope keeps falling in/out as you hover around it.

### What’s causing the flicker

In your current implementation you do something like this inside `updateStickyHeader`: 

```js
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

this.currentScopes = filteredScopes;
```

Key problem:

* You use **`displayedCount` from the previous frame** to decide whether a scope should appear now.
* When you’re right at the boundary where a nested scope is about to be added or removed, a tiny scroll delta changes both:

  * which scopes are in `scopes` (because `posAtCoords` moved slightly), **and**
  * the offsets that depend on `displayedCount`.
* That feedback loop makes the nested scope ping-pong between “in header” and “not in header”, which is what you’re seeing as flicker.

You already position the detection point correctly below the overlay using `overlayHeight` + `posAtCoords`, so nested scopes *are* being detected at the right place. 
The instability is purely in the **filtering math**.

---

### Fix: use a “virtual viewport top” and pure `N+1` thresholds

The clean way to keep your `n+1` behavior without flicker is:

1. Treat the **virtual top of the viewport** (the “top of visible code under the header”) as:

   ```js
   const overlayLines = Math.min(this.currentScopes.length, 5); // you only render up to 5 anyway
   const virtualTop = scrollTop + overlayLines * lineHeight;
   ```

2. For scope at level `i` (0 = outermost, 1 = nested, …), trigger it when its definition line is **`(i + 1)` lines above this virtual top**:

   ```js
   const level = i + 1;
   const triggerPx = virtualTop + level * lineHeight;
   if (defBlock.bottom <= triggerPx) { /* show it */ }
   ```

This does exactly what you want conceptually:

* Header currently shows `overlayLines` scopes → it visually covers `overlayLines` lines of code.
* For the **next** nested scope at index `i`, you want it to be captured when it’s `overlayLines` (already hidden) + 1 extra line above the scroll origin — that’s the `n+1` early-capture.
* Once a scope starts satisfying that inequality, increasing `overlayLines` on the next frame only **raises** its threshold, so it **cannot drop out again** just because the header grew. Flicker goes away.

---

### Concrete patch

In your current `updateStickyHeader`, leave the top part (gutter positioning, `posAtCoords`, syntax tree + `scopes` collection) as-is. Only replace the “Trigger offset” block that currently uses `displayedCount` with this:

```js
// ============================================================================
// Trigger offsets: N+1 early capture relative to the *virtual* top of viewport
// - overlayLines = number of sticky lines currently rendered (max 5)
// - virtualTop   = scrollTop + overlayLines * lineHeight
//   (i.e. top of the visible code area under the header)
// - Scope at level i (0-based) is captured when its definition line is
//   (i + 1) lines above this virtual top.
// ============================================================================

const lineHeight = view.defaultLineHeight;

// How many lines the overlay effectively occupies (you slice to 5 when rendering)
const overlayLines = Math.min(this.currentScopes.length, 5);
const virtualTop = scrollTop + overlayLines * lineHeight;

// Filter: only show scopes whose definition line is above the virtual viewport
// with N+1 offset per nesting level.
const filteredScopes = [];
for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);

    // Level index: 0 = outermost, 1 = next nested, etc.
    const level = i + 1;

    // N+1 trigger: def line must be (level) lines above virtualTop
    const triggerPx = virtualTop + level * lineHeight;

    if (defBlock.bottom <= triggerPx) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes.push({
        node: scopeNode,
        lineText: defLine.text, // keep original indentation
      });
    }
  } catch {}
}

this.currentScopes = filteredScopes;

// Render (max 5 lines)
const displayScopes = filteredScopes.slice(0, 5);
if (displayScopes.length === 0) {
  this.dom.innerHTML = '';
} else {
  this.dom.innerHTML = displayScopes
    .map((scope, idx) =>
      `<div class="cm-sticky-line" data-index="${idx}">${escapeHtml(scope.lineText)}</div>`
    )
    .join('');
}
```

This replaces the block that starts at your current comment:

````js
// Trigger offset: compensate for overlay height + 1 base line
// Added: 2025-12-03 by vectorArc - TE2 Team
// Fixed: Use previous render's scope count for offset calculation
``` :contentReference[oaicite:2]{index=2}  

…and keeps everything else in `applyStickyScroll` intact — compartments, theme, and scroll listener setup are unchanged. :contentReference[oaicite:3]{index=3}  

---

### What you should see after this

Behavior you should get:

- Top-level (`scope[0]`) still triggers one line early compared to the “true” viewport, exactly like your minimap logic.
- Each deeper nested scope triggers earlier by one additional line (so level 2 is 2 lines early, level 3 is 3 lines early, etc.), matching the mental “N+1” model from your status doc. :contentReference[oaicite:4]{index=4}  
- Once a nested scope pops into the header while scrolling **down**, it will stay there until you actually scroll back up past its true exit point; it won’t glitch in and out just because you hover near the boundary.

If you still see any micro-jitter right at the exact crossing point, the next refinement would be a tiny hysteresis band (e.g. add/subtract `0.3 * lineHeight` to `triggerPx` depending on scroll direction), but I’d only bolt that on if this geometric fix doesn’t already make it feel stable.
::contentReference[oaicite:5]{index=5}
````
_Dex_

---

# Sticky Scroll Implementation - Full Progress Report

**Created:** 2025-12-03T19:54:43Z  
**Author:** vectorArc - TE2 Team  
**Status:** Feature branch - functional but needs polish

---

## Executive Summary

Successfully implemented a Monaco-style "Sticky Scroll" feature for CodeMirror 6. The feature displays the enclosing function/class/scope signatures at the top of the editor as you scroll through nested code. Click-to-jump navigation is functional. The implementation is working but has minor flicker issues at scope boundaries that need further refinement.

---

## What Was Built

### Core Feature
- **Sticky scroll header** overlays the top of the editor content area
- **Shows enclosing scopes** (functions, classes, methods, arrow functions, etc.)
- **Language-aware** scope detection (JavaScript, TypeScript, Python, with fallback)
- **Click-to-jump** - clicking a sticky line navigates to that scope's definition
- **Toggle via menu** - View → Sticky Scroll
- **Preference persistence** - setting saved across sessions
- **Max 5 lines** displayed to prevent excessive screen usage

### Technical Implementation

#### Files Modified

| File | Purpose |
|------|---------|
| `app/apps/file_editor_cm6/preferences_store.py` | Added `"stickyScroll": False` default preference |
| `app/apps/file_editor_cm6/codemirror.py` | Added `set_sticky_scroll(enabled)` Python method |
| `app/static/vendor/nicegui/elements/codemirror/codemirror.js` | Main implementation - `applyStickyScroll()` method with ViewPlugin |
| `app/apps/file_editor_cm6/editor_app.py` | Preference handling, hooks for page/file load |
| `app/apps/file_editor_cm6/templates/template.html` | Added "Sticky Scroll" menu item in View menu |
| `app/apps/file_editor_cm6/static/main.js` | Toggle binding and menu checkbox state management |

#### Architecture

```
applyStickyScroll(enabled) method in codemirror.js:
├── getScopeTypes() - Returns language-specific AST node types
├── escapeHtml() - XSS protection for displayed text  
├── stickyScrollTheme - CM6 baseTheme with CSS styles
├── stickyScrollPlugin - ViewPlugin class
│   ├── constructor() - Creates DOM, attaches scroll listener
│   ├── updateStickyHeader() - Main logic
│   │   ├── Position overlay (absolute, beside gutter)
│   │   ├── Detect position via lineBlockAtHeight(scrollTop)
│   │   ├── Walk syntax tree to find enclosing scopes
│   │   ├── Filter scopes using (i+1)*lineHeight offset
│   │   └── Render to DOM
│   ├── update() - Re-render on doc changes
│   └── destroy() - Cleanup
└── Compartment management for toggle on/off
```

#### Key Technical Decisions

1. **ViewPlugin instead of showPanel** - Allows overlay positioning without affecting editor layout

2. **Absolute positioning inside `view.dom`** - Works reliably in iframe context

3. **Gutter-aware positioning** - `left: gutterWidth + 'px'` aligns with code content

4. **Direct scroll listener** - `view.scrollDOM.addEventListener('scroll', ...)` for immediate response instead of relying on CM6's batched updates

5. **`lineBlockAtHeight(scrollTop)`** - Stable position detection that works during CM6 update cycles (replaced `posAtCoords` which threw errors)

6. **`(i + 1) * lineHeight` trigger offset** - Each nested scope level triggers one line earlier to account for overlay growth

---

## What Works ✅

1. **Single scope detection** - Top-level function/class appears correctly when scrolled out of view
2. **Nested scope detection** - Multiple levels of nesting are detected and displayed
3. **Indentation preserved** - Original whitespace/indentation shown in sticky header
4. **Click-to-jump** - Clicking navigates to the scope definition
5. **Toggle on/off** - Menu item works, preference persists
6. **No CM6 update errors** - `lineBlockAtHeight` fix eliminated "layout read during update" errors
7. **Trigger timing** - Scopes appear at approximately the right scroll position

---

## Known Issues ❌

### 1. Flicker at Scope Boundaries
When scrolling near the point where a nested scope should appear/disappear, there's visible flicker. The scope rapidly toggles in/out of the header.

**Root cause:** Feedback loop between:
- Detection point calculation
- Overlay height changes
- Trigger threshold calculations

**Attempted fixes:**
- Hysteresis (different add/remove thresholds) - added lag
- `virtualTop` calculation (Dex's approach) - didn't resolve
- DOM `offsetHeight` vs calculated height - caused feedback loop

### 2. Subsequent Scope Trigger Timing
While the first scope triggers at the correct +1 line offset, subsequent nested scopes don't consistently trigger at +2, +3, etc. They sometimes all trigger at the same +1 offset.

**Status:** The math is correct (verified via console logging), but visual behavior doesn't always match.

---

## Implementation Journey

### Phase 1: Basic Structure
- Added preference, Python binding, menu item
- Created `applyStickyScroll()` with basic ViewPlugin
- Used `showPanel` initially (later changed to ViewPlugin for overlay)

### Phase 2: Positioning
- Started with panel (takes layout space) - caused scroll thrash
- Changed to absolute overlay inside `view.dom`
- Added gutter width calculation for alignment

### Phase 3: Scroll Detection
- Initial: CM6's `viewportChanged` - too slow/batched
- Added direct scroll listener on `scrollDOM` - immediate response
- Used `posAtCoords` for position detection - worked but had issues

### Phase 4: Trigger Offset (n+1 Problem)
- Problem: Scopes triggered too late (after already hidden by overlay)
- Solution: `(i + 1) * lineHeight` offset per nesting level
- Verified via extensive console logging that math is correct

### Phase 5: Flicker Fixes (Ongoing)
- Tried: `overlayHeight` from DOM - feedback loop
- Tried: `expectedOverlayHeight` from scope count - still flickered
- Tried: Hysteresis buffer - added lag without fixing flicker
- Tried: Dex's `virtualTop` approach - didn't resolve

### Phase 6: CM6 Error Fixes
- `posAtCoords` threw "layout read during update" errors
- Switched `reportScrollPosition` to use `lineBlockAtHeight(scrollTop)`
- Stable, no more errors

---

## Code Locations

### Main Implementation
`app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- Lines ~1240-1510: `applyStickyScroll()` method
- Lines ~980-1050: `reportScrollPosition()` (updated to use `lineBlockAtHeight`)

### CSS Theme
Inside `applyStickyScroll()`:
```javascript
const stickyScrollTheme = CM.EditorView.baseTheme({
  ".cm-stickyHeader": { position: "absolute", ... },
  ".cm-sticky-line": { padding, cursor: "pointer", ... },
  ...
});
```

### Scope Types
```javascript
const getScopeTypes = () => {
  // JavaScript/TypeScript
  // Python  
  // Fallback
  return new Set([...]);
};
```

---

## Next Steps for Production Ready

1. **Fix flicker** - Need to find stable threshold calculation that doesn't oscillate

2. **Test edge cases:**
   - Very short files
   - Files with no functions
   - Deeply nested code (>5 levels)
   - Word wrap enabled
   - Various font sizes

3. **Performance audit** - Ensure no jank on large files

4. **Accessibility** - Keyboard navigation for sticky lines?

5. **Visual polish:**
   - Better styling/colors
   - Smooth transitions?
   - Collapse indicator?

---

## Reference Documents

- `tmp.md` - Initial implementation plan
- `tmp2.md` - Revised plan
- `tmp3.md` - Web search analysis
- `tmp4_plan.md` - Corrected implementation plan
- `tmp5.md` - Scroll fix plan
- `tmp6_progress.md` - Progress tracking
- `tmp7_status.md` - Status summary with current issue
- `tmp8_fix-proposal_1.md` - Atlas's fix proposal
- `tmp9_fix-proposal_2.md` - Dex's fix proposal (virtualTop)
- `tmp10.md` - Atlas's flicker fix (fixed offset / lineBlockAtHeight)
- `tmp11.md` - Dex's flicker fix (virtualTop monotonic)

---

## Commits

Branch contains multiple iterations. Key states:
- "at least it's calculating the right height" - working but flickering
- Current HEAD - `lineBlockAtHeight` fix applied, flicker remains

---

*This document represents the state of the sticky scroll feature as of 2025-12-03T19:54:43Z*

*vectorArc - TE2 Team*


---

## Sticky Scroll – Monaco Parity Plan (CM6)

**Context (2025-12-03):**
- Current CM6 sticky scroll works for the first scope but nested scopes either trigger too late/early or flicker.
- Implementation is tightly coupled: detection uses `posAtCoords` against the live overlay height, and trigger math guesses overlay height from `lineHeight`.
- VS Code’s implementation splits responsibilities: a controller computes a pure state (`startLineNumbers`, etc.) from model + scroll, and a widget renders that state, reporting its actual pixel height back to the controller.

Goal: align our CodeMirror 6 implementation with the VS Code pattern enough to make nested scopes stable and predictable, while keeping changes minimal and compatible with NiceGUI.

---

## 1. Map VS Code Concepts to Our CM6 World

### 1.1 VS Code Pieces (What They Do)

- **StickyScrollController** (`vscode/src/vs/editor/contrib/stickyScroll/browser/stickyScrollController.ts`)
  - Keeps `_widgetState: StickyScrollWidgetState` = pure data (startLineNumbers, endLineNumbers, lastLineRelativePosition).
  - Computes state in `findScrollWidgetState()` using:
    - `scrollTop` (editor scroll position)
    - `getVisibleRanges()` (viewport lines)
    - `StickyLineCandidateProvider.getCandidateStickyLinesIntersecting()` (function/class ranges + geometry).
  - Applies clamping: `_maxStickyLines` is derived from editor height and `stickyScroll.maxLineCount`.
  - Calls `_stickyScrollWidget.setState(widgetState, foldingModel)` – controller does **not** look at the widget DOM.
  - Listens to `StickyScrollWidget.onDidChangeStickyScrollHeight` so the controller always knows the overlay height in pixels.

- **StickyScrollWidget** (`vscode/src/vs/editor/contrib/stickyScroll/browser/stickyScrollWidget.ts`)
  - A real overlay widget (`IOverlayWidget`) with its own root node.
  - Renders each sticky line using the same rendering path as editor content.
  - Tracks its own `_height` and exposes `get height()`; `_setHeight()` updates CSS heights and fires `onDidChangeStickyScrollHeight({ height })`.
  - Does **no** scope detection; it just renders `StickyScrollWidgetState`.

### 1.2 Our Pieces (Where We Are)

- **Detection + rendering combined** in `applyStickyScroll()` ViewPlugin (`app/static/vendor/nicegui/elements/codemirror/codemirror.js`):
  - `updateStickyHeader()` both:
    - Samples a document position via `posAtCoords` near the top of the editor.
    - Walks the Lezer tree upward to build a `scopes[]` list.
    - Decides which scopes should be sticky, and renders them directly into `this.dom`.
  - Overlay height is read from `this.dom` while we’re still deciding what to render → feedback loop.
  - Trigger math approximates overlay height via `lineHeight` and local counters; sticky line height and editor line height can drift.

**Mismatch:** VS Code has a clean separation (controller ↔ widget) and uses the widget’s measured height as input, while we try to interpolate everything inside one pass.

---

## 2. Target Architecture for CM6 Sticky Scroll

We won’t copy VS Code 1:1 (no full candidate provider / folding integration yet), but we want the same structure:

1. **State computation step** – from `scrollTop` + syntax tree → ordered list of scopes to display.
2. **Widget step** – from state → DOM overlay, reporting its exact pixel height.
3. **Trigger logic** – n+1 capture using:
   - current `scrollTop`
   - measured overlay height from the *previous* frame
   - a local accumulator for “planned” height as more scopes are added.

Concretely, we’ll keep one CM6 ViewPlugin but internally split it into these phases.

---

## 3. Concrete Changes – Step by Step

### 3.1 Stabilize Detection (Viewport → Document Position)

**Today:**
- Detection uses `posAtCoords(editorRect.left + gutterWidth + 10, editorRect.top + 5)`.
- Previously, it used `overlayHeight + 5`, causing the sampling point to move every time the header height changed.

**Plan:**
- Keep detection **independent** of overlay height.
- Use one of:
  1. `posAtCoords` with a fixed top offset (what we currently reverted to).
  2. `lineBlockAtHeight(scrollTop)` for a pure CM6-viewport-top position.

**Action:**
- In `updateStickyHeader`, ensure `pos` is computed from a constant reference (e.g., `lineBlockAtHeight(scrollTop)` or stable `posAtCoords`), and **never** from `this.dom.offsetHeight`.
- Treat that `pos` as “viewport entry point” for scope resolution, same for all nesting levels.

### 3.2 Introduce an Explicit Widget-Height Model

**Goal:** mirror VS Code’s `StickyScrollWidget.height` and `onDidChangeStickyScrollHeight` semantics.

**Plan:**
- Treat `this.dom` as the CM6 sticky widget and maintain:
  - `this.widgetHeightPx` – the overlay height we used on the previous render.
  - `this.stickyLineHeightPx` – measured from the first child (`getBoundingClientRect().height`) when present, else fall back to `view.defaultLineHeight`.
- Update `this.widgetHeightPx` **after** we render the new header.

**Action:**
- At the top of `updateStickyHeader`:
  - Read `const prevWidgetHeight = this.widgetHeightPx || 0;` (persisted across calls).
  - Do **not** use `this.dom.offsetHeight` anywhere else in the pipeline.
- At the end of `updateStickyHeader`:
  - After updating `this.dom.innerHTML`, compute the new overlay height (`this.dom.offsetHeight`) and store it into `this.widgetHeightPx`.

This gives us the “current overlay height” value VS Code has, but we keep it as a simple number on the plugin.

### 3.3 Implement Proper n+1 Capture Using Widget Height

We want:
- When no sticky lines → first scope is captured ~1 line early.
- When there are N sticky lines → next scope is captured “just before” it would disappear under an overlay of height N × (sticky line height).

**Model:**

- Let:
  - `scrollTop` = CM6 scroll DOM top.
  - `prevWidgetHeightPx` = overlay height **before** this render (from 3.2).
  - `stickyLineHeightPx` = height of one sticky row.
  - `plannedHeightPx` = `prevWidgetHeightPx` + (number of scopes we decide to show in this frame) × `stickyLineHeightPx`.

- For each scope (outer → inner):
  - Compute its bottom in viewport coordinates: `defBottomPx = view.lineBlockAt(scopeNode.from).bottom`.
  - Compute a trigger threshold:
    - `thresholdPx = scrollTop + plannedHeightPx + stickyLineHeightPx`.
  - If `defBottomPx <= thresholdPx`, capture it (push into `filteredScopes`) and increment `plannedHeightPx += stickyLineHeightPx`.
  - Else `break` – no deeper scopes without parents.

**Action:**
- Replace the current `(visibleCount + 1) * lineHeight` logic with this widget-height–based threshold, seeded from `this.widgetHeightPx`.
- Cap at `MAX_STICKY_LINES` (5 for now) to avoid runaway headers.

### 3.4 Keep Detection and Capture in One Place, Rendering at the End

**Today:** detection, capture, and rendering all interleave, which makes debugging hard.

**Plan:** re-structure `updateStickyHeader`’s happy path into clear phases:

1. **Detect position:** compute `scrollTop`, `pos`.
2. **Resolve scopes:** build `scopes[]` from syntax tree.
3. **Decide state:** run the widget-height–aware n+1 loop → `filteredScopes[]`.
4. **Render:** diff old `currentScopes` vs `filteredScopes` (optional optimization) and update `this.dom.innerHTML`.
5. **Measure new height:** set `this.widgetHeightPx` from `this.dom.offsetHeight`.

This makes it trivial to log each phase and verify that the problem is in the trigger math, not in detection.

### 3.5 Sanity Checks / Diagnostics

Before more tweaks, we should confirm the numbers line up:

- For a simple 2-level example (class → method):
  - Log for every scroll step:
    - `scrollTop`, `prevWidgetHeightPx`, `plannedHeightPx`, `stickyLineHeightPx`.
    - For each scope: `defBlock.top`, `defBlock.bottom`, `thresholdPx`, and whether it was captured.
- Verify:
  - First scope joins the header ~1 line before it scrolls off.
  - Second scope joins when the previous overlay height (1 line) + 1 more sticky line matches its approach to the top.

If logs show thresholds correct but UI still jitters, we can:
- Add a small hysteresis band (e.g. subtract 0.3 * `stickyLineHeightPx` on capture, add on release).
- Or smooth with CSS transitions once correctness is established.

---

## 4. Longer-Term Enhancements (After Core Fix)

Once the n+1 behavior is solid:

1. **Better scope candidates:**
   - Introduce a lightweight “candidate provider” similar to VS Code’s, but using Lezer + indentation for now.
   - Later, add language-specific heuristics (interfaces, type aliases, etc.).

2. **Max-height clamping:**
   - Mirror VS Code’s “no more than 25% of editor height” rule.
   - Compute in JS from `view.dom.clientHeight` and sticky line height.

3. **Visual polish / VS Code parity:**
   - Behaviors: hover styles, focus ring, keyboard navigation between sticky lines.
   - Optional animation when lines enter/leave the overlay.

4. **Refactor into a small internal “controller” object:**
   - Keep plugin but move the state computation into a separate helper to make further tweaks safer.

---

## 5. Implementation Order

1. **Phase 1 – Stabilize baseline**
   - Ensure detection (`pos` / `scrollTop`) is independent of overlay height.
   - Introduce `this.widgetHeightPx` and seed it at the start of `updateStickyHeader`.
   - Replace trigger math with the widget-height–based n+1 logic.

2. **Phase 2 – Verify and instrument**
   - Add targeted logging for `scrollTop`, `widgetHeightPx`, `plannedHeightPx`, and thresholds.
   - Test on a few nested examples (JS/TS/Python).

3. **Phase 3 – Clean up and polish**
   - Remove or gate debug logs behind a flag.
   - Add basic max-height clamping.
   - Consider hysteresis if minor jitter remains.

This plan keeps us close to VS Code’s conceptual model (controller + widget + explicit widget height) while staying within the constraints of a single CM6 ViewPlugin.



---

# Sticky Scroll – Current Behavior & Observations (No Fixes Yet)

**Date:** 2025‑12‑03  
**Context:** Code CM6 sticky scroll feature (CodeMirror 6 + NiceGUI)  
**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js` – `applyStickyScroll()` / `stickyScrollPlugin`

> This document is purely descriptive: what the implementation looks like *right now*, what we observe in the UI, and what likely explains that behavior. **No new solutions or changes are being proposed here.**

---

## 1. Implementation State (High‑Level)

Sticky scroll is implemented as a CodeMirror 6 `ViewPlugin` inside `codemirror.js`. The plugin:

- Renders an absolutely‑positioned overlay `div.cm-stickyHeader` appended directly under `view.dom` (inside the editor iframe DOM).
- Tracks a list of currently active scopes in `this.currentScopes` for click‑to‑jump behavior.
- Samples scroll position using `view.scrollDOM.scrollTop` plus a computed offset to determine a reference position in the document (`refPos`), then walks the Lezer syntax tree upward from there to find nested scopes (functions, classes, etc.).
- Uses a line‑based “depth + offset” model to decide which scopes should be sticky and in what order.
- Renders one `<div class="cm-sticky-line">` per active scope, with the outermost at top and deeper scopes below it.

The plugin is wired into a compartment (`stickyScrollCompartment`) so it can be toggled via the UI and preferences.

---

## 2. Current Detection & Sampling Logic

### 2.1 Scroll Handling

- The plugin attaches a direct scroll listener:
  - `view.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true })`.
  - `this.scrollHandler = () => this.updateStickyHeader();`

- To reduce visual jitter, `updateStickyHeader` uses a **time‑based backoff**:

  ```js
  const now = performance.now() or Date.now();
  if (now - this.lastRenderTime < 100) return;
  this.lastRenderTime = now;
  ```

  This ensures sticky header computations happen at most once every ~100 ms, even if many scroll events fire.

### 2.2 Reference Position (`refPos` / `refLine`)

- We compute:

  ```js
  const scrollTop = view.scrollDOM.scrollTop;
  const lineHeight = view.defaultLineHeight;
  const currentOverlayHeight = this.dom.offsetHeight || 0;
  const samplingOverlayHeight = this.lastOverlayHeight || currentOverlayHeight;
  const effectiveTop = scrollTop + samplingOverlayHeight + lineHeight;
  ```

- `samplingOverlayHeight` uses **the previous frame’s** overlay height when available (`this.lastOverlayHeight`). The goal is to keep the sampling line stable across the exact frame where the header grows or shrinks.

- We then ask CodeMirror’s layout for the line block at that pixel:

  ```js
  const block = view.lineBlockAtHeight(effectiveTop);
  refPos = block.from;
  // Fallback: refPos = view.viewport.from;
  const refLine = state.doc.lineAt(refPos).number;
  ```

- Intuitively: `refLine` is “the first code line *just below* the sticky header,” but it is derived from pixel height plus CM6’s internal block positioning, not from our own notion of “line 1 under the header.”

### 2.3 Scope Hierarchy Extraction

- We obtain the syntax tree once via `CM.syntaxTree(state)` (Lezer).
- From `refPos`, we walk the ancestor chain upward:

  ```js
  const scopeTypes = getScopeTypes();  // language‑aware set of node names
  const ancestorNodes = [];
  let node = tree.resolveInner(refPos);
  for (; node; node = node.parent) {
    if (scopeTypes.has(node.name)) {
      ancestorNodes.push(node);
    }
  }
  ancestorNodes.reverse(); // depth 0 = outermost, then deeper
  ```

- Each `node` in `ancestorNodes` is then mapped to a structured scope record:

  ```js
  const scopes = ancestorNodes.map((n, depth) => {
    const startLine = state.doc.lineAt(n.from).number;
    const endLine   = state.doc.lineAt(n.to).number;
    const text      = state.doc.lineAt(n.from).text;
    const offset    = -(depth + 2);        // depth 0 => -2, depth 1 => -3, etc.
    const triggerLine    = startLine + offset;
    const endTriggerLine = Math.max(startLine, endLine + offset);
    return { node: n, depth, startLine, endLine, text, triggerLine, endTriggerLine };
  });
  ```

- This “depth + offset” model encodes:
  - **Global early capture:** we pull everything one extra line earlier (the `+2` rather than `+1`).
  - **Per‑depth n+1:** deeper scopes are expected to be captured earlier in line space (top level `start−2`, next `start−3`, etc.).
  - **Early release:** `endTriggerLine` is also shifted by the same offset, shortening the sticky window at the end so that scopes “hand off” to the next deeper scope more gracefully.

---

## 3. Current Activation Logic (When a Scope “Sticks”)

Given `refLine` and the `scopes` array:

```js
const MAX_STICKY_LINES = 5;
const activeScopes = [];
for (const scope of scopes) {
  if (activeScopes.length >= MAX_STICKY_LINES) break;

  // Don’t consider deeper scopes until we’ve passed this scope’s trigger
  if (refLine <= scope.triggerLine) {
    break;
  }

  const active = refLine > scope.triggerLine && refLine <= scope.endTriggerLine;
  if (active) {
    activeScopes.push(scope);
  }
}
this.currentScopes = activeScopes;
```

---

## 4. Runtime Behavior We Actually See

This section captures what the feature is doing in practice in the editor, based on manual use and the console logs added around the sticky logic.

### 4.1 Overall “Shape” of the Feature

- The sticky header appears at the top of the editor when scrolling down into a file with nested scopes.
- The **outermost scope** (e.g. a top‑level class or function) shows up in the first sticky line at roughly the expected moment: slightly before its definition scrolls out of view.
- **Nested scopes** appear in the second and third sticky lines in the expected depth order (class → method → inner function, etc.).
- The early‑capture effect is clearly visible:
  - Deeper scopes tend to get pulled in before their header lines would be fully covered by the sticky region, matching the intended “n+1” behavior.
- Click‑to‑jump from the sticky header into the source works as intended (using `scope.node.from`).

### 4.2 End‑of‑Scope “Double Drop” (Previous State)

Before switching to the current `samplingOverlayHeight` approach, logs showed a recurrent pattern at the **end** of a scope:

- As `refLine` approached a scope’s `endTriggerLine`, the depth‑N scope would:
  1. Drop out (its `active` flag became false when `refLine > endTriggerLine`).
  2. Immediately reappear for one more frame.
  3. Then drop out for good on a subsequent frame.

Typical log sequence (simplified):

```text
refLine = 660, triggerLine = 651, endTriggerLine = 660 → active = true
refLine = 661, triggerLine = 651, endTriggerLine = 660 → active = false
... overlay shrinks ...
refLine = 659, triggerLine = 651, endTriggerLine = 660 → active = true
refLine = 661, triggerLine = 651, endTriggerLine = 660 → active = false
```

Key observations from those logs:

- The **overlay height** changed between samples (e.g. from three sticky lines to two), and the sampling position `effectiveTop` was based on the *current* overlay height.
- When the header shrank, the sampling line jumped upward, causing `refLine` to move back into the scope’s `[triggerLine + 1, endTriggerLine]` window once, and then out again on the next tick.

This is what produced the visually detectable “double flash” when a scope stopped being sticky.

### 4.3 Current Behavior (After Using `samplingOverlayHeight`)

With `samplingOverlayHeight = this.lastOverlayHeight || currentOverlayHeight`, the most obvious double‑flash at scope ends is gone. The behavior now is:

- Sticky scopes generally **enter** and **leave** the header only once as you scroll past their start/end ranges.
- The header feels stable while scrolling steadily down; the earlier “drop → reappear → drop” pattern is much less common.
- There is still a subtle perception that the **outermost scope** is captured slightly early and released slightly early, while deeper scopes may feel slightly better aligned.

### 4.4 Depth‑Wise Misalignment Pattern

Manual observation (and your notes) show a consistent qualitative pattern:

- Depth 0 (top‑level scope):
  - Appears **about one logical line early** relative to where the eye expects it.
  - Feels a bit “ahead” of the ideal capture point.
- Depth 1:
  - Appears **roughly half a line early** (less obviously early than depth 0).
- Depth 2 (and deeper):
  - Often feels **roughly “on time”** or at least not noticeably earlier than expected.

In other words, the same sampling and offset logic produces different perceived alignment at different depths: the deeper the scope, the closer it feels to the intuitive “right” capture line.

### 4.5 Interaction with the 100ms Backoff

The 100ms backoff has clear effects:

- It **removes high‑frequency jitter** that was previously visible when hovering near the trigger boundary.
- It also means sticky state updates occur in discrete steps, which:
  - Can make a single off‑by‑one crossing at a boundary more noticeable.
  - Prevents some borderline re‑entries from being visible (they happen between throttled updates).

The backoff is therefore acting like a coarse “debounce” on visual state, masking some noise while exposing other slow‑moving shifts more clearly.

---

## 5. Likely Contributing Factors (Descriptive, Not Prescriptive)

This section summarizes factors that appear to contribute to the current behavior and misalignments. These are **not** solution proposals, just causal hypotheses based on the implementation and logs.

### 5.1 Sampling Position vs. Visual Expectation

- `refLine` is derived from:

  ```js
  effectiveTop = scrollTop + samplingOverlayHeight + lineHeight;
  const block = view.lineBlockAtHeight(effectiveTop);
  refPos = block.from;
  refLine = doc.lineAt(refPos).number;
  ```

- The **human expectation** of “the line just under the sticky header” may not match the line at this pixel, because:
  - The top visible code line may be partially covered or partially off‑screen.
  - `lineBlockAtHeight` chooses the block whose vertical span covers `effectiveTop`, which may be a half‑line into the next block or the preceding one depending on scroll alignment and CM6’s internal padding.

This mismatch can systematically bias `refLine` by roughly half a line or one line compared to what “looks” like the top of the visible code region.

### 5.2 Depth‑Dependent Offsets

- The model uses:

  ```js
  offset = -(depth + 2);      // depth 0 => -2, depth 1 => -3, ...
  triggerLine    = startLine + offset;
  endTriggerLine = max(startLine, endLine + offset);
  ```

- A **single** sampling bias in `refLine` applies to every depth, but the offsets differ per depth. As a result:
  - The same `refLine` shift can present as “one line early” for depth 0,
  - “half a line early” for depth 1,
  - and “roughly aligned” for depth 2, depending on how the offsets and start/end ranges line up.

In effect, a small systematic error in `refLine` can manifest differently at each depth because the capture window for each scope is shifted by a different amount.

### 5.3 Line Height vs. Actual Sticky Row Height

- `lineHeight` comes from `view.defaultLineHeight`.
- The sticky header rows (`.cm-sticky-line`) may not match `lineHeight` exactly due to:
  - CSS padding,
  - border widths,
  - font metrics differences vs. main content.

If a sticky row is even a few pixels taller/shorter than the editor line height:

- The physical height of the overlay (in pixels) may not correspond exactly to an integer number of `lineHeight`s.
- This can subtly shift what “one line below the overlay” means in visual terms.

### 5.4 Quantization from Backoff + Block Sampling

- The 100ms backoff means we only evaluate sticky state on a coarse time grid; the scroll position may move across several pixels (or fractions of lines) between evaluations.
- `lineBlockAtHeight` returns the block covering a **range** of vertical pixels; small changes in `effectiveTop` can jump `refLine` from one block to the next in a single update.
- Together, these effects can make trigger crossings appear as abrupt, single‑frame events rather than smooth transitions, especially at boundaries where:
  - `refLine` is near `triggerLine` or `endTriggerLine`, and
  - the overlay has just grown or shrunk.

### 5.5 Overlay Height Memory (`lastOverlayHeight`)

- Using `samplingOverlayHeight = lastOverlayHeight` instead of the current height has reduced the obvious “drop → re‑enter → drop” pattern, because:
  - The sampling line doesn’t react immediately to header size changes.
  - It instead uses the previous frame’s height, then updates `lastOverlayHeight` *after* rendering.

However, this also means:

- There is always a **one‑frame lag** between the true header height and the sampling geometry used for the next decision.
- At certain scroll speeds and positions, this lag can push `refLine` into or out of a scope’s `[triggerLine, endTriggerLine]` window slightly before or after the visual threshold the user expects, contributing to the “one line early” / “half line early” perception by depth.

---

**Summary:**  
The current sticky scroll implementation reliably identifies scopes and renders them in the correct depth order. The capture and release points are intentionally shifted earlier in line space (global early capture plus per‑depth n+1 offsets), but the combination of pixel‑based sampling (`lineBlockAtHeight`), per‑depth offsets, sticky row vs. editor line height differences, and the 100ms backoff leads to small, depth‑dependent misalignments between when a scope *feels* like it should stick/unstick and when the code decides it should. These observations are consistent with the logs and on‑screen behavior; this document does not propose specific fixes, only describes the current state and plausible contributing factors. 


---

# Fix Proposal: Geometric "Consumed-By-Overlay" Sticky Scroll

**Date:** 2025-12-03
**Author:** jimmy - te2 team
**Status:** Corrected Proposal (Matching Monaco/VS Code behavior)

## Problem Analysis
The previous "Stateless" proposal failed because it only checked `startLine < topLine`. This causes **underscroll**: scopes disappear behind the overlay *before* becoming sticky, because the overlay itself consumes vertical space.
As identified in `tmp22.md`, we must account for the "virtual slot" each scope occupies. Depth 0 needs to stick at 0px offset, Depth 1 at 20px (assuming 20px line height), etc.

## The Monaco Solution (Verified)
Monaco's `stickyScrollController.ts` uses a pixel-geometric check:
```typescript
const topOfElement = range.top; // Virtual slot (e.g., 0, 20, 40...)
const topOfBeginningLine = this._editor.getTopForLineNumber(start) - scrollTop; // Physical position relative to viewport

if (topOfElement > topOfBeginningLine && topOfElement <= bottomOfEndLine) {
    // Make sticky
}
```
This condition `topOfElement > topOfBeginningLine` is the key. It means: "Is the slot where this header *should* be (e.g., 20px) currently *below* where the header actually is?"
- If the header is at 30px (physically), and belongs at 20px (virtually), `20 > 30` is False.
- If the header scrolls up to 19px, `20 > 19` is True. **It sticks.**
- This automatically handles the "N+1" (or "consumed by overlay") effect geometrically.

## Implementation Plan for CodeMirror 6

We will replace the `updateStickyHeader` method in `codemirror.js` with this logic.

### 1. Helper: Calculate Scope Depth
We need a helper to calculate the "Scope Depth" (number of scope-like ancestors) for any node, to assign its `virtualTop`.

```javascript
function getScopeDepth(node, scopeTypes) {
  let depth = 0;
  let curr = node.parent;
  while (curr) {
    if (scopeTypes.has(curr.name)) {
      depth++;
    }
    curr = curr.parent;
  }
  return depth;
}
```

### 2. The Algorithm

```javascript
updateStickyHeader() {
  const view = this.view;
  const state = view.state;
  const scrollTop = view.scrollDOM.scrollTop;
  const lineHeight = view.defaultLineHeight;
  
  // 1. Define Search Window
  // We must look ahead by the max potential overlay height to catch scopes 
  // that are "consumed" (hidden behind the overlay) even if they start below 0.
  const MAX_STICKY_LINES = 5;
  const maxOverlayHeight = MAX_STICKY_LINES * lineHeight;
  
  // Find the document position corresponding to the bottom of the potential overlay
  // We use lineBlockAtHeight to convert pixel Y -> document pos
  let searchEndPos;
  try {
     // scrollTop + maxOverlayHeight gives the absolute Y of the search limit
     const block = view.lineBlockAtHeight(scrollTop + maxOverlayHeight);
     searchEndPos = block.to;
  } catch {
     searchEndPos = view.viewport.to;
  }

  const tree = CM.syntaxTree(state);
  if (!tree) return;

  const scopeTypes = getScopeTypes();
  const candidates = [];

  // 2. Iterate Tree in Search Window
  // We look for ANY scope node that overlaps [scrollTop, scrollTop + maxOverlayHeight]
  // actually, we iterate from viewport.from to searchEndPos to be safe/efficient
  tree.iterate({
    from: view.viewport.from,
    to: searchEndPos,
    enter: (node) => {
      if (scopeTypes.has(node.name)) {
        candidates.push(node);
      }
    }
  });

  // 3. Filter & Activate
  const activeScopes = [];
  
  for (const node of candidates) {
    // Calculate Depth -> Virtual Top
    const depth = getScopeDepth(node, scopeTypes);
    const virtualTop = depth * lineHeight;
    
    // Calculate Physical Position
    // lineBlockAt(node.from).top is the absolute Y of the line top
    const block = view.lineBlockAt(node.from);
    const physicalTop = block.top - scrollTop;
    
    // Bottom check (for exit)
    // We can approximate bottom using line count or just use the node end
    // Use the block at the END of the node to find physical bottom
    const endBlock = view.lineBlockAt(node.to);
    const physicalBottom = endBlock.bottom - scrollTop;

    // CORE MONACO LOGIC:
    // 1. Is the header physically "above" (or colliding with) its virtual slot? (Capture)
    // 2. Is the bottom of the scope still below the virtual slot? (Exit/Push-up)
    if (virtualTop > physicalTop && virtualTop < physicalBottom) {
       activeScopes.push({
         node,
         depth,
         text: state.doc.lineAt(node.from).text,
         virtualTop,
         physicalBottom
       });
    }
  }

  // 4. Sort & Prune
  // Sort by depth (0 -> N)
  activeScopes.sort((a, b) => a.depth - b.depth);
  
  // Keep only up to MAX
  if (activeScopes.length > MAX_STICKY_LINES) {
    activeScopes.length = MAX_STICKY_LINES;
  }
  
  this.currentScopes = activeScopes;

  // 5. Render
  if (activeScopes.length === 0) {
    if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
    this.dom.style.top = '0px';
    this.lastOverlayHeight = 0;
    return;
  }

  // ... (HTML generation same as before) ...

  // 6. Push-Up Logic
  // Check the innermost scope (last in list)
  const innermost = activeScopes[activeScopes.length - 1];
  const stackBottom = (activeScopes.length) * lineHeight; // Virtual bottom of stack
  
  let topOffset = 0;
  // If the physical bottom of the innermost scope is pushing up the stack
  if (innermost.physicalBottom < stackBottom) {
     topOffset = innermost.physicalBottom - stackBottom;
  }
  
  this.dom.style.top = `${topOffset}px`;
  
  // Align
  const gutterEl = view.dom.querySelector('.cm-gutters');
  const gutterWidth = gutterEl ? gutterEl.offsetWidth : 0;
  this.dom.style.left = gutterWidth + 'px';
  this.dom.style.right = '0';
  
  this.lastOverlayHeight = activeScopes.length * lineHeight;
}
```

## Why This Works
- **Correct Capture:** Depth 1 (20px slot) captures when the line reaches 19px (physically). This happens *before* it hits 0px, exactly effectively "consuming" the line into the overlay stack.
- **Correct Exit:** The `virtualTop < physicalBottom` check ensures we don't stick to scopes that have completely scrolled off (top).
- **Correct Push-Up:** `physicalBottom - stackBottom` exactly replicates the smooth exit animation.

jimmy - te2 team

---

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



---

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

---

# Sticky Scroll State – Post Word-Wrap Fixes & Synthetic Gutter

**Date:** 2025-12-04  
**Context:** CodeMirror 6 sticky scroll (NiceGUI) after wrap-aware drift correction, per-depth compensation, single-line overlays, and synthetic gutter alignment.

## What’s working now
- **n+1 depth logic intact:** `offset = -(depth+2)` with early capture/release windows per scope.
- **Jitter greatly reduced:** Sampling uses previous overlay height; push-up effect on innermost scope; per-depth active window only (no persistence hacks).
- **Word-wrap compensation:** Scroll-fraction drift correction is applied **only when wrapping is on**, and only fully to depth 0. Deeper scopes subtract that correction to avoid over-trigger.
- **Direction-aware sampling:** Scroll-down uses overlay+early lines; scroll-up uses a shallower bias to avoid lag.
- **Styled sticky rows:** Each sticky line clones the actual `.cm-line` HTML when available, so theme/highlight/indentation match the buffer.
- **Single-line rows:** Overlay is built as one absolutely-positioned row per scope.
- **Synthetic gutter:** Overlay now spans full width. Gutter is reconstructed with per-segment widths matching real gutters (line numbers, folds, etc.), and gutter font size is synced to the real line-number gutter. Line numbers show in the first segment.
- **Shadow:** Soft box-shadow under the sticky stack.

## Remaining quirks to watch
- Deep nesting under heavy wrap: verify second/third levels near scope ends; push-up + depth compensation should handle most jitter, but edge cases may remain.
- Performance: cloning `.cm-line` HTML is contingent on the line being in the viewport; when not available, we fall back to plain text (could add a small highlight-only helper later).

## Key parameters (current)
- Early capture: base 1 line; +1 line drift correction at bottom when wrap is ON (top-level only).
- Max sticky lines: 5.
- Push-up: slides overlay up when innermost scope end crosses stack bottom.
- Box shadow: `0 6px 8px rgba(0,0,0,0.35)`.

## Files touched
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js` – sticky scroll plugin/theme.



---

# Sticky Scroll Architecture – Current State (Dec 4, 2025)

File: `app/static/vendor/nicegui/elements/codemirror/codemirror.js`  
Primary block: **sticky scroll plugin & theme** starting around line ~1265 through the end of `applyStickyScroll`.

## Theme (CSS)
- `.cm-stickyHeader`: absolute, full-width overlay, inherits editor font/size/lineHeight, box-shadow `0 6px 8px rgba(0,0,0,0.35)`.
- `.cm-sticky-layer`: each scope gets its own absolutely positioned layer (per-scope stacking).
- `.cm-sticky-line`: flex row for gutter + content; no extra indent padding.
- `.cm-sticky-gutter`: flex container matching real gutter widths; numeric, tabular; right-aligned; border-right.
- `.cm-sticky-gutter-segment`: one per real gutter (line numbers, folds, etc.), fixed segment width.
- `.cm-sticky-content`: flex 1, preserves whitespace; ellipsis overflow.

## Data fields on the ViewPlugin
- `currentScopes`, `prevActiveScopes`
- `lastOverlayHeight`, `lastOverlaySampleHeight` (smoothed height for sampling)
- `lastTopOffset` (hysteresis for push-up)
- `lastActiveSignature`, `lastRenderKey`
- `lastScrollTop`
- `rafPending`

## Detection (updateStickyHeader)
- Anchoring:
  - `samplingOverlayHeight = lastOverlaySampleHeight || currentOverlayHeight`
  - Direction-aware sampling:
    - Compute `scrollFrac` (0–1 over doc height).
    - Wrap **on**: drift correction for depth 0: `earlyLines = base 1 + scrollFrac` (down), `= scrollFrac` (up); drift subtracted for deeper scopes in activation.
    - Wrap **off**: `earlyLines = 1` (down), `0` (up); drift = 0.
  - `effectiveTop = scrollTop + samplingOverlayHeight + earlyLines * lineHeight`
  - `refPos = lineBlockAtHeight(effectiveTop)` (fallback `view.viewport.from`), `refLine = doc.lineAt(refPos).number`.

- Scope chain:
  - `ancestorNodes` from `tree.resolveInner(refPos)` → reversed.
  - Scope filter uses `isScopeNode(node, scopeTypes)`.
  - `offset = -(depth + 2)` → `triggerLine`, `endTriggerLine = max(startLine, endLine + offset)`.
  - Sibling handoff: if next scope at same depth starts after current, clamp `endTriggerLine` to `siblingStart - 1`.

- Activation:
  - MAX 5 scopes.
  - `scopedRef = refLine` (depth 0); if wrap on and depth>0: `scopedRef -= driftCorrectionLines`.
  - Hysteresis: +/-0.5 lines depending on prior active state.
  - Innermost gets extra upper margin to stay while push-up runs.
  - Near-end linger check via `endLineBlock.bottom` vs prospective header height.

- State tracking:
  - `currentScopes`, `prevActiveScopes`
  - `lastOverlayHeight = activeScopes.length * lineHeight` (if any)
  - `lastOverlaySampleHeight` grows instantly; decays at most one line per update.
  - `lastScrollTop` updated each pass.
  - Debug signature logging (DEBUG_STICKY = true currently).

## Rendering
- Early exit clears DOM when no scopes; maintains/decays sample height.
- Per-scope layer:
  - One `.cm-sticky-layer` per scope; z-index stacked (outer above inner).
  - Innermost translated by `topOffset`; its height is `lineHeight + topOffset` (can shrink). Others keep full lineHeight.
  - Synthetic gutter:
    - Width = real `.cm-gutters` width.
    - Segments = each real gutter child’s width; first segment shows line number.
    - Font size copied from real line-number gutter (slightly bumped +0.2px).
  - Content: uses `getStyledLineHTML(scope.startLine)` to clone `.cm-line` HTML when available; fallback to `scope.text`.
  - Render deduped via `renderKey = signature|topOffset|effectiveHeight`.

## Push-up / End handling
- `topOffset` computed from innermost scope’s end line bottom vs stack bottom; early margin = 3 * lineHeight; only moves up (negative translate).
- If a scope just dropped, reuse its geometry once to slide stack instead of snapping.
- Hysteresis on `topOffset` (epsilon = 0.25 * lineHeight).
- Effective overlay height = sum of lineHeights with innermost possibly shrunk; stored in `lastOverlaySampleHeight` for stable sampling.

## Known behaviors (current)
- Wrap OFF: classic n+1 behavior with stable sampling and per-scope layers.
- Wrap ON: drift correction aligns top-level across the doc; deeper scopes compensated to avoid overcorrection; push-up reduces end jitter; lingering near end minimizes flicker.
- Synthetic gutter mirrors real gutter widths; shadow under stack; styling matches editor content.



---

# Sticky Scroll Logic Analysis (Dec 5, 2025)

File: `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

## Potential Issues Identified

### 1. Redundant `effectiveTop` Calculation (Lines 1556-1558)
```javascript
const effectiveTop = direction >= 0
  ? baseTop + earlyLines * lineHeight   // scroll down or unchanged
  : baseTop + earlyLines * lineHeight;  // scroll up: correction only
```
Both branches are **identical**. This ternary serves no purpose. Either simplify to `const effectiveTop = baseTop + earlyLines * lineHeight;`, or the scroll-up branch was intended to have different logic.

---

### 2. Sibling Handoff Logic May Never Execute (Lines 1601-1610)
```javascript
for (let i = 0; i < scopes.length - 1; i++) {
  const curr = scopes[i];
  const next = scopes[i + 1];
  if (next.depth === curr.depth) { ... }
}
```
`scopes` is built from `ancestorNodes`, which is a **parent chain** (each entry has increasing depth). Two entries at the same depth in an ancestor chain shouldn't occur. This block appears to be vestigial code that never executes, or it's intended for a different data structure (actual siblings, not ancestors).

---

### 3. `nearEnd` Only Applies to `depth > 0` (Lines 1661-1671)
```javascript
if (scope.depth > 0) {
  // nearEnd calculation
}
```
Top-level scopes (depth 0) never receive the `nearEnd` linger benefit. If a file has a single top-level function ending, it won't get the same smooth push-up grace period as nested scopes. This may be intentional, but worth noting.

---

### 4. Missing `direction === 0` Consideration in Wrap OFF Mode
```javascript
earlyLines = direction >= 0 ? 1 : 0;
```
When `direction === 0` (no scroll change—e.g., doc edit or window resize), this uses `earlyLines = 1`, same as scrolling down. This could cause unexpected activation shifts on non-scroll updates.

---

### 5. `lastScrollTop` Not Updated on Early Returns
`this.lastScrollTop = scrollTop;` occurs at line 1871, after all rendering. If the function returns early (no syntax tree at lines 1573-1577, or no active scopes at lines 1715-1724), `lastScrollTop` is **never updated**. This causes stale direction detection on subsequent calls, potentially causing incorrect `earlyLines` values.

**Affected early-exit points:**
- Line 1575: `if (!tree || !tree.topNode) { ... return; }`
- Line 1723: `if (activeScopes.length === 0) { ... return; }`

---

### 6. Variable Naming Confusion: `prevActiveScopes` vs `prevActiveKeys`
- `prevActiveKeys` is derived from `this.currentScopes` (correct previous state)
- `prevActiveScopes` comes from `this.prevActiveScopes`
- Both track "previous" state but from different sources

The logic works, but the naming is confusing and could lead to maintenance errors. Consider consolidating or renaming for clarity.

---

## Summary

| Issue | Severity | Type |
|-------|----------|------|
| #1 - Redundant ternary | Low | Dead code |
| #2 - Sibling handoff never executes | Medium | Vestigial logic |
| #3 - `nearEnd` excludes depth 0 | Low | Possible oversight |
| #4 - `direction === 0` uses down behavior | Low | Edge case |
| #5 - `lastScrollTop` stale on early return | Medium | Bug |
| #6 - Naming confusion | Low | Maintainability |

Issues #1 and #5 are the most actionable. Issue #2 may indicate incomplete or abandoned logic.

---

## Root Cause Analysis: Python "Piling Up" Bug

**The sibling handoff logic (lines 1601-1610) is in the wrong place and operates on the wrong data.**

### The Problem:

1. `ancestorNodes` is built by walking **up the parent chain** from `refPos` (line 1581-1586). This means it only contains **ancestors of the current position** - nodes that *contain* `refPos`.

2. Two sibling functions like `_status_meta_from_code` (268) and `_search_by_changes` (281) are **never both in the ancestor chain at the same time**. When your cursor is inside `_status_meta_from_code`, only that function is in `ancestorNodes`. When inside `_search_by_changes`, only that one is.

3. **The sibling handoff logic can never execute** because `scopes` (derived from `ancestorNodes`) will never have two entries at the same depth - by definition, ancestors have strictly increasing nesting depth.

### Why "Piling Up" Happens:

When the syntax tree is **incomplete or not yet parsed** (common on initial load), `tree.resolveInner(refPos)` may return a node whose parent chain is malformed or missing. The Lezer parser incrementally parses, so:

- On first load, the tree may be partial
- After scrolling around, the parser catches up and the tree becomes complete
- Once complete, the ancestor chain is correct and only one top-level function appears

### Why It "Fixes Itself":

Scrolling forces viewport updates, which triggers the parser to complete more of the document. Switching files and coming back may also trigger a full re-parse.

### The Missing Logic:

To properly handle sibling handoff, you'd need to:
1. Find the **actual next sibling** at the same depth in the syntax tree (not in the ancestor chain)
2. Use that sibling's start position to clamp the current scope's `endTriggerLine`

This would require something like:
```javascript
// For each scope, find its next sibling in the tree (not in ancestors)
const nextSibling = scope.node.nextSibling;
if (nextSibling && isScopeNode(nextSibling, scopeTypes)) {
  // Clamp endTriggerLine to hand off before sibling starts
}
```

### The `lastOverlaySampleHeight` Factor:

The "piling up" could also be exacerbated by stale `lastOverlaySampleHeight`. If two scopes incorrectly appear as nested, the overlay height grows. On the next pass, `samplingOverlayHeight` uses the inflated height, potentially causing `refLine` to sample deeper into the document, which could perpetuate the incorrect state.

---

### Summary of Python Bug:

| Observation | Explanation |
|-------------|-------------|
| Sibling functions "pile up" as nested | Incomplete syntax tree returns malformed parent chain |
| Fixes itself after scrolling | Parser completes incrementally; tree becomes correct |
| JavaScript works better | JS parser may be faster/more complete on initial load |
| Sibling handoff code is dead | It operates on ancestors (nested), not actual siblings |

---

*atlas - t2 contributor*
*2025-12-05*

---

## "Frame Rate" Issue Analysis

The rendering is driven by **scroll events + a single rAF follow-up** (lines 1419-1430):

```javascript
this.scrollHandler = () => {
  this.updateStickyHeader();
  if (!this.rafPending) {
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.updateStickyHeader();
    });
  }
};
```

**Problems:**

1. **Only one rAF queued at a time** - If scroll events fire faster than frames render, you get at most 2 updates per scroll burst (immediate + one rAF). Smooth 60fps scrolling would need continuous rAF chaining.

2. **No CSS transitions on the overlay** - The `topOffset` (push-up) is applied via `transform: translateY()` but there's no `transition` property. Every pixel change is a hard snap, not a smooth animation.

3. **Full DOM rebuild on every render** - The `renderKey` check (line 1808) tries to skip redundant rebuilds, but it includes `topOffset.toFixed(3)` - so even tiny push-up changes trigger full `innerHTML = ''` + rebuild. This is expensive.

---

## "Halfway Stuck" Issue Analysis

The push-up animation getting "stuck" between states is likely caused by:

1. **Hysteresis conflict with animation** - The `epsilon` hysteresis (line 1776-1778) keeps `topOffset` at its previous value if the change is small:
   ```javascript
   if (Math.abs(topOffset - this.lastTopOffset) < epsilon) {
     topOffset = this.lastTopOffset;
   }
   ```
   This is meant to prevent flicker, but during smooth scrolling it can cause the overlay to "stick" at an intermediate position until the delta exceeds `0.25 * lineHeight`.

2. **`lastOverlaySampleHeight` decay lag** - When scopes change, the sample height decays by at most one `lineHeight` per update (line 1867-1870). If the rAF rate is low, this decay is slow, keeping the overlay at a stale height.

3. **No interpolation** - There's no lerp/easing between states. The overlay jumps to discrete positions based on thresholds, and the hysteresis prevents small corrections, creating a "stuck in between" appearance.

---

## Potential Fix Direction

To address both issues:

1. **Add CSS transition** to `.cm-sticky-layer`:
   ```css
   transition: transform 0.1s ease-out, height 0.1s ease-out;
   ```

2. **Remove `topOffset` from `renderKey`** - Let CSS handle the animation; only rebuild DOM when scopes actually change (signature changes).

3. **Continuous rAF loop while scrolling** - Instead of one-shot rAF, maintain a loop that runs while scroll velocity is non-zero, with debounced stop.

4. **Separate DOM structure from transform updates** - Update `transform` and `height` styles directly without rebuilding DOM when only push-up changes.

---

*atlas - t2 contributor*
*2025-12-05*

---

**dex:**  
- #1 redundant ternary: agreed—simplify to `effectiveTop = baseTop + earlyLines * lineHeight`.  
- #2 sibling handoff: agreed—ancestor chain never has same-depth siblings; either remove or replace with real `node.nextSibling` clamp.  
- #3 nearEnd depth>0 only: probably OK, but we can optionally give depth 0 the linger if we see EOF snap.  
- #4 direction==0: minor; could use last direction or neutral bias, but not blocking.  
- #5 lastScrollTop not updated on early returns: real bug; update `lastScrollTop` (and maybe sample height) before early exits.  
- #6 naming confusion: low severity; a rename would help.  
Priority fixes: #5 (stale direction) and either remove or rework sibling handoff (#2).


---

# Sticky Scroll Markdown Issue Summary

**Date:** 2025-12-06
**Context:** Current main branch after commit `Mark Downs partially sticky scrolled`.

## What Works
- Sticky scroll logic stable for code languages (Python/JS) with n+1 activation and slot-per-depth.
- Markdown headings are detected (ATX only), nested correctly, and markers now render in the overlay (raw text fallback retains `#` markers).
- Push-up animation disabled for Markdown to avoid clipping deep stacks.

## The Remaining Markdown Bug
- Headings still trigger one line early when scrolling. Example: in `docs/apps/code_cm6/README.md`, the H1/H2/H3 appear a line before their heading line reaches the viewport top.

## Current Markdown Implementation (as of this file)
1. **Heading detection:** ATX only (`#` up to 3 leading spaces). Builds sections to next heading of same/higher level or doc end.
2. **Path:** `markdownPathAtSimple` stacks headings up to `refLine` and requiring `refLine <= endLine`.
3. **Activation offsets (n+1):** `offset = -3` → `triggerLine = line - 3`, `endTriggerLine = endLine - 3`.
4. **Sampling:** Uses global sampling overlay height and `earlyLines = (direction >= 0 ? 1 : 0)`.
5. **Rendering:** Raw text fallback for headings so markers stay visible; push-up disabled for Markdown.

## Current Issue (Markdown)
- Headings trigger one line before the heading reaches the visible viewport top. This causes the next header to appear in the next slot prematurely, briefly duplicating it until the user scrolls further.

## Note on Noise
- Prior console logging produced repeated entries because the scope list is rebuilt every scroll. Debug logging has been removed; future debugging should be gated by a flag.


---

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


---

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


---

# Simultaneous Scope Transition with Push-Up Animation

**Date:** 2025-12-06  
**Problem:** Push-up animation doesn't trigger because the old scope is cleared in the same frame the new scope activates.

## The Core Issue

Current flow when Section B reaches the header while Section A is displayed:

```
Frame N:   Section A active, Section B approaching
Frame N+1: Section A CLEARED, Section B REGISTERED  ← instant swap, no animation
```

The push-up animation needs **overlap**—a window where both scopes exist so the outgoing scope can animate out while the incoming scope waits.

## Solution: Transitioning Scope State

Instead of a binary active/inactive state, introduce a **transitioning** state for the outgoing scope:

```
Frame N:   Section A active (normal)
Frame N+1: Section A transitioning (pushing up), Section B pending
Frame N+2: Section A transitioning (more pushed up), Section B pending  
Frame N+3: Section A removed, Section B active
```

### Implementation Approach

#### Option A: Dual-Scope Rendering for Siblings

When a sibling scope is about to replace the current one at the same depth:

1. **Detect sibling transition**: New scope at same depth with different `startLine`
2. **Keep both temporarily**: Don't clear the old scope immediately
3. **Render outgoing with push-up**: The old scope gets negative `translateY`
4. **Render incoming below**: The new scope slides in from below the old one
5. **Complete transition**: When old scope is fully pushed out, remove it

```javascript
// In slot registration logic
if (shouldActivate) {
  const existing = this.slots.get(scope.depth);
  if (existing && existing.startLine !== scope.startLine) {
    // Sibling replacement detected!
    // Don't clear immediately - mark for transition
    existing.transitioning = true;
    existing.replacement = scope;
    // DON'T register the new scope yet
  } else {
    this.slots.register(scope);
  }
}
```

#### Option B: Render Queue with Animation Delay

Maintain a separate "outgoing" scope that renders with push-up animation:

```javascript
// State
this.outgoingScope = null;  // Scope being pushed out
this.outgoingProgress = 0;  // 0 to 1, animation progress

// When clearing a slot due to sibling replacement
if (shouldClear && reason === 'sibling_replacement') {
  this.outgoingScope = existing;
  this.outgoingProgress = 0;
  // Clear from slots but keep rendering
}

// In render loop
if (this.outgoingScope) {
  // Render outgoing scope with push-up based on progress
  const pushOffset = -lineHeight * this.outgoingProgress;
  renderScopeLayer(this.outgoingScope, pushOffset);
  
  // Advance animation
  this.outgoingProgress += 0.15; // ~6 frames to complete
  if (this.outgoingProgress >= 1) {
    this.outgoingScope = null;
  }
}
```

#### Option C: CSS Transition-Driven (Recommended)

Let CSS handle the animation timing. The JS just needs to:
1. Add the new scope
2. Mark the old scope for exit
3. CSS transitions handle the rest

```javascript
// When sibling detected, render BOTH scopes in the same slot position
// Old scope gets class 'exiting', new scope gets class 'entering'

// CSS
".cm-sticky-layer.exiting": {
  transform: "translateY(-100%)",
  opacity: "0",
  transition: "transform 150ms ease-out, opacity 150ms ease-out",
  pointerEvents: "none",
}

".cm-sticky-layer.entering": {
  animation: "slideIn 150ms ease-out",
}

@keyframes slideIn {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

## Detailed Implementation for Option C

### Step 1: Track Pending Transitions

```javascript
constructor(view) {
  // ... existing code ...
  this.pendingTransitions = new Map(); // depth -> { outgoing, incoming, startTime }
}
```

### Step 2: Detect Sibling Replacement

```javascript
// In the activation loop
if (shouldActivate) {
  const existing = this.slots.get(scope.depth);
  if (existing && existing.startLine !== scope.startLine) {
    // Sibling at same depth - start transition
    this.pendingTransitions.set(scope.depth, {
      outgoing: existing,
      incoming: scope,
      startTime: performance.now(),
    });
    // Keep existing in slot for now; will swap after animation
  } else if (!existing) {
    this.slots.register(scope);
  }
}
```

### Step 3: Render Both During Transition

```javascript
// In render section
activeScopes.forEach((scope, idx) => {
  const transition = this.pendingTransitions.get(scope.depth);
  
  if (transition && transition.outgoing.startLine === scope.startLine) {
    // This is the outgoing scope - render with exit animation
    const layer = this.createLayer(scope, idx, { exiting: true });
    this.dom.appendChild(layer);
    
    // Also render the incoming scope
    const incomingLayer = this.createLayer(transition.incoming, idx, { entering: true });
    this.dom.appendChild(incomingLayer);
  } else {
    // Normal render
    const layer = this.createLayer(scope, idx, {});
    this.dom.appendChild(layer);
  }
});
```

### Step 4: Complete Transition After Animation

```javascript
// After render, check for completed transitions
const TRANSITION_DURATION = 150; // ms

for (const [depth, transition] of this.pendingTransitions) {
  const elapsed = performance.now() - transition.startTime;
  if (elapsed >= TRANSITION_DURATION) {
    // Animation complete - swap scopes
    this.slots.clear(depth);
    this.slots.register(transition.incoming);
    this.pendingTransitions.delete(depth);
  }
}
```

## The Key Insight

The problem isn't the offset timing—it's that the **slot system enforces mutual exclusion**. At any moment, only ONE scope can occupy a depth slot.

For smooth sibling transitions, we need to **temporarily break this rule** and allow both the outgoing and incoming scope to render simultaneously during the ~150ms animation window.

## Alternative: Push-Up Without Slot Overlap

If we want to keep strict slot exclusivity, we can trigger the push-up animation **before** the new scope activates:

```javascript
// Detect "incoming sibling" by looking ahead in candidateScopes
const incomingSibling = candidateScopes.find(s => 
  s.depth === existing.depth && 
  s.startLine !== existing.startLine &&
  s.startLine > existing.startLine
);

if (incomingSibling) {
  // Calculate how close the sibling's heading is to the header bottom
  const siblingLineObj = state.doc.line(incomingSibling.startLine);
  const siblingBlock = view.lineBlockAt(siblingLineObj.from);
  const siblingTopViewport = siblingBlock.top - scrollTop;
  const headerBottom = activeScopes.length * lineHeight;
  
  const distanceToHeader = siblingTopViewport - headerBottom;
  
  if (distanceToHeader < lineHeight * 3) {
    // Sibling is close - start push-up on current scope
    // Push amount proportional to proximity
    const pushProgress = 1 - (distanceToHeader / (lineHeight * 3));
    topOffset = -lineHeight * pushProgress;
  }
}
```

This approach:
- Detects incoming sibling before it activates
- Starts pushing the current scope up as sibling approaches
- When sibling finally activates and replaces, current scope is already mostly pushed out
- No slot overlap needed

## Recommendation

**Use the "look-ahead" approach** (last section). It:
- Keeps the slot system simple (one scope per depth)
- Triggers push-up based on incoming sibling proximity
- Provides smooth visual transition without architectural changes
- Is easier to tune (adjust the `lineHeight * 3` threshold)

The key is detecting the incoming sibling and computing push-up offset based on its distance from the header, rather than based on the current scope's end position.


---

# Explorer → Socket.IO message flow (file_editor_cm6)

Goal: explain how the explorer sends a message to the backend over Socket.IO.

## 1) Socket.IO client availability
- The explorer page includes the vendored client via `app/apps/file_editor_cm6/template.html`:
  - `<script src="/static/vendor/socket.io.min.js"></script>` runs before `main.js`.
- This defines `window.io` globally for all explorer scripts.

## 2) Explorer bootstrap
- `main.js` (editor bootstrap) loads `explorer.js` as an ES module.
- Inside `explorer.js`, a thin bus is wired onto `window.__explorerBusSend` (see below).

## 3) WebSocket setup (engine.io/socket.io)
- `main.py` for the editor configures the NiceGUI Socket.IO path to `/socket.io` on the worker.
- The browser connects to `/ui/_nicegui_ws/socket.io` through the proxy in `app/main.py`, so all explorer traffic shares that Socket.IO channel the editor already uses.

## 4) Explorer message helper
- In `explorer.js`, messages to the backend use:
  ```js
  window.__explorerBusSend(type, payload)
  ```
- Implementation outline (in `explorer.js`):
  - `window.__explorerBusSend` forwards to the shared Socket.IO connection created elsewhere in the editor shell (same connection `__editorSocket` uses).
  - It emits an event with the shape `{ type, payload }` to the backend.

## 5) Sending a message (example: change diff base)
- User clicks a diff-base option ⇒ `changeDiffBase(ref)` in `explorer.js`:
  ```js
  window.__explorerBusSend('git:setDiffBase', { ref });
  ```
- This call packages the message and hands it to the shared Socket.IO client.
- The client has already been instantiated with `io(...)` using the vendored script, so emit succeeds immediately.

## 6) Transport details
- Socket.IO uses WebSocket transport (forced by the editor config) via `/ui/_nicegui_ws/socket.io`.
- The message format is Socket.IO “event” with a name understood by the server (e.g., `git:setDiffBase`).

## 7) Server side
- The worker app (file_editor_cm6) listens on the same Socket.IO namespace/path and routes explorer events to its backend handlers (HistoryStore, git helpers, etc.).

## 8) Why no per-file import needed
- Because `io` is provided by the top-level HTML script tag, `explorer.js` doesn’t import or require Socket.IO directly; it just calls the already-established `window.__explorerBusSend`, which uses that global connection.

## Quick execution path summary
1) HTML loads `/static/vendor/socket.io.min.js` ⇒ `window.io` defined.
2) Editor bootstraps shared Socket.IO connection to `/ui/_nicegui_ws/socket.io`.
3) `explorer.js` defines `__explorerBusSend` that emits over that connection.
4) User action (e.g., git diff-base change) calls `__explorerBusSend('git:setDiffBase', {ref})`.
5) Socket.IO emits event to backend; backend handles and updates state; explorer receives snapshots via other events and re-renders.
- _DEX_
---

## DISAGREEMENT (Added by ATLAS on 2025-12-07)

After examining the actual current code in `main.js` (lines 64-112), I observe that:

**Current Implementation (as of the code I can see):**
- `explorerSocket` is created using `new ReconnectingWebSocket(wsUrl)` (line 73)
- `ReconnectingWebSocket` wraps a **plain WebSocket**, not Socket.IO (verified in reconnecting_websocket.js line 75)
- `window.__explorerBusSend` uses `explorerSocket.send(JSON.stringify(msg))` (line 104)
- This is plain WebSocket with JSON messages, not Socket.IO's `.emit()` API
- The WebSocket connects to `/ws/app/file_editor_cm6/explorer` which is proxied via `app/main.py` line 1035

**What this means:**
- Socket.IO IS loaded globally via the script tag (template.html line 1629)
- Socket.IO IS available as `window.io`
- Socket.IO IS used by the agent drawer (agent_drawer.js)
- **BUT the explorer currently uses plain WebSocket, NOT Socket.IO**

**Possible explanations:**
1. The code was refactored from Socket.IO to plain WebSocket
2. The document describes the intended/future architecture
3. There's a hybrid where both protocols coexist

The comment in main.js line 145 says "Connect Socket.IO-based explorer UI bus (v2)" but the actual implementation uses plain WebSocket. This suggests either:
- The comment is outdated
- The migration from Socket.IO to WebSocket is incomplete
- I'm still missing something about how the connection is actually established



---

# Implementing a Monaco‑Style Sticky Scroll in CodeMirror 6 (Corrected Guide)

## Overview: Sticky Headers in Code Editors

“Sticky scroll” (as introduced in VS Code’s Monaco editor) pins the current function or class signature to the top of the viewport, providing context while scrolling through a long block of code [1]. CodeMirror 6 does **not** have a built‑in sticky header feature, so we must implement it via a custom extension.

The key idea is to display a fixed header panel showing the nearest enclosing function or class name as the editor scrolls. CodeMirror’s creator notes that you **cannot** simply freeze a line in place – instead, you can overlay a separate element (e.g. a panel) at the top of the editor [2]. We’ll leverage CodeMirror 6’s extension APIs (particularly `ViewPlugin` and `showPanel`) to create this behavior.

---

## Using a Fixed Panel for the Sticky Header

CodeMirror 6 supports *panels* – UI elements rendered above or below the editor content that remain visible during scrolling [3]. We will use a top panel to display the current function/class name, ensuring it stays persistently at the top. The panel will update its content as the viewport changes.

By using CodeMirror’s panel system (via the `showPanel` facet), we integrate cleanly into the editor’s DOM without hacking external CSS. Panels occupy space in the editor’s layout and automatically stay in view when the editor scrolls [3], making them ideal for a sticky header.

**How the panel works:**

- We provide a panel constructor function that creates a DOM element (e.g. a `<div>` with a custom class like `.cm-stickyHeader`).
- This panel is added at the top of the editor (`top: true` in the panel spec).
- The panel’s DOM can be styled via a base theme extension (for example, giving it a subtle background or bold text to distinguish the context line).
- The panel object can implement an `update(update)` method that CodeMirror calls on every view update [4]. We use this to refresh the header text whenever needed.

---

## Tracking the Current Function/Class via the Syntax Tree

To determine what function or class is “currently visible,” we rely on the editor’s parsed syntax tree. CodeMirror 6’s language packs (via Lezer parsers) produce a syntax tree for the document, accessible with `syntaxTree(state)` [5]. This tree lets us find the code construct encompassing a given position.

### Strategy

1. **Identify the top of the viewport in document terms**

   - Use `view.viewport.from` (the first drawn position) as a representative position near the top of the visible area [6].
   - Alternatively, for more precision, we could:
     - Find the position at the top pixel of the editor using `view.posAtCoords`, or
     - Examine the first line block in `view.viewportLineBlocks`.
   - In practice, `view.viewport.from` is a convenient starting point (it’s an over‑approximation of the first visible position, which is fine for context purposes).

2. **Find the enclosing function or class node**

   - Using the syntax tree, we resolve the innermost syntax node at that position and then traverse up its parent chain to find a node that represents a function or class definition.
   - Lezer’s `Tree.resolveInner(pos)` method gives the deepest node covering a given position [7].
   - From there, we walk upward (`node.parent`) until we encounter a node type corresponding to a function or class.
   - We’ll need to check node type names – for example:
     - JavaScript: `"FunctionDeclaration"`, `"MethodDeclaration"`, `"ClassDeclaration"`, etc.
     - Python: `"FunctionDefinition"`, `"ClassDefinition"`, etc.
   - Each language’s Lezer grammar defines these node names. We may have to handle multiple possible node types (e.g. constructor functions or arrow functions in JS have different node labels) – but focusing on classes and named functions is a good start.

3. **Nearest vs. outermost context**

   - Typically we want the **innermost relevant scope** that’s currently active.
   - Example: Inside a method of a class, the sticky header should show the method name (and possibly the class name above it if we choose to display nested context).
   - To mimic Monaco/VS Code, you can show a **stack of context lines** (one for each level of nesting). A simple implementation might only show the deepest function or class. A more advanced approach is to collect all containing function/class nodes up to the top‑level and display each on its own line in the panel (outermost at top, innermost last), similar to VS Code’s multi‑line sticky scroll.

4. **Extracting the header text**

   - Once we have the syntax node for the function or class, we need a human‑readable label (usually the signature or name).
   - If the parse tree provides a child node for the identifier name, we could extract that token’s text.
   - A simpler approach is to grab the entire line(s) of the definition from the document text. For example:
     - Let `defNode.from` be the start position of the function definition.
     - Retrieve the line at that position via `state.doc.lineAt(defNode.from)` and use its `.text` [5].
   - Trimming indentation and perhaps truncating after the parameter list or opening brace can make it cleaner. Often, just showing the first line of the definition (e.g. `function foo(bar) {` or `class MyClass:`) is sufficient to identify the scope.
   - We update the panel’s DOM text to this line (or multi‑line stack).

5. **Handling absence of scope**

   - If the top of the viewport is not inside any function or class (e.g. in global/top‑level code), the extension can simply render nothing or hide the panel.
   - This might be done by setting the panel text to an empty string or a placeholder like `[No function]`.
   - You could also only enable the panel when a scope is present (by toggling the panel facet on and off), but it’s often acceptable to show an empty panel or hide via CSS when not in use.

---

## Building the Panel and View Logic

We’ll implement the logic as a `showPanel` panel whose `update()` responds to view updates.

### Panel constructor

```js
import {showPanel, EditorView} from "@codemirror/view";
import {syntaxTree} from "@codemirror/language";

function createStickyPanel(view) {
  const dom = document.createElement("div");
  dom.className = "cm-stickyHeader";
  dom.textContent = ""; // initial blank

  return {
    top: true,
    dom,
    update(update) {
      // Only recompute if the visible content changed or document changed
      if (!update.viewportChanged && !update.docChanged) return;

      const state = update.state;
      const pos = view.viewport.from; // representative top-of-viewport position

      const tree = syntaxTree(state); // current parse tree
      let scopeName = "";

      if (tree) {
        // Find enclosing function/class nodes for `pos`
        let node = tree.resolveInner(pos);
        const scopes = [];

        for (; node; node = node.parent) {
          const name = node.name;
          if (
            name === "FunctionDeclaration" ||
            name === "FunctionDefinition" ||
            name === "MethodDeclaration"   ||
            name === "ClassDeclaration"    ||
            name === "ClassDefinition"
          ) {
            scopes.push(node);
          }
        }

        if (scopes.length) {
          // Use innermost scope for a single-line header
          const defNode = scopes[scopes.length - 1];
          const defLine = state.doc.lineAt(defNode.from);

          // Avoid duplicating the definition if it's still visible in the viewport
          const vp = view.viewport;
          const defIsFullyAbove = defLine.to <= vp.from;

          if (defIsFullyAbove) {
            scopeName = defLine.text.trim();
          } else {
            // definition line is still visible; don't show a sticky header
            scopeName = "";
          }

          // Alternatively, build a multi-line context:
          // const contextLines = scopes
          //   .map(n => state.doc.lineAt(n.from).text.trim());
          // scopeName = defIsFullyAbove ? contextLines.join(" / ") : "";
        }
      }

      dom.textContent = scopeName;
    },
  };
}

export const stickyHeaderPanel = showPanel.of(createStickyPanel);
```

This uses `view.viewport.from` as the scroll reference and the syntax tree to derive the current scope. We also explicitly avoid showing a header if the definition line is still visible in the viewport to reduce duplication.

---

## Handling Parsing and Large Files

Because we query the syntax tree when the viewport changes, performance is a concern with very large files. CodeMirror’s incremental parsing makes tree queries quite fast, and by using `viewportChanged` we limit updates to when needed.

However, the syntax tree may not be immediately available for code far outside the viewport – the parser runs incrementally and may stop after parsing the visible region plus some margin.

### Ensuring the tree exists where we need it

The language package gives you helpers to deal with this:

```js
import {syntaxTree, ensureSyntaxTree, syntaxTreeAvailable, forceParsing} from "@codemirror/language";

// In your update handler, for example:
if (!syntaxTreeAvailable(state, pos)) {
  // Try to make sure parsing reaches at least the end of the viewport
  ensureSyntaxTree(state, view.viewport.to);
  // Or, if you have access to the view here:
  forceParsing(view, view.viewport.to);
}
```

Notes:

- `syntaxTree(state)` returns the current (possibly partial) tree.
- `syntaxTreeAvailable(state, pos)` lets you check whether a given position is fully parsed.
- `ensureSyntaxTree(state, upto, timeout?)` parses up to a given position on demand.
- `forceParsing(view, upto?, timeout?)` is a helper that drives parsing based on the current view.

In most cases, slowly scrolling through a file keeps the tree ahead of you and you won’t need explicit forcing. It’s mainly useful when the user jumps deep into a file via “Go to Definition” or similar.

---

## Line Wrapping Considerations

With word‑wrap enabled, a single logical line can occupy multiple visual lines. It’s possible that the start of a long function signature is scrolled off while the tail end of that same line is still visible. In such a scenario, you might momentarily see the sticky header duplicating the line’s content.

To refine this, you can detect partial visibility of the definition line using line blocks:

```js
const block = view.lineBlockAt(defNode.from);
const scrollTop = view.scrollDOM.scrollTop;
const blockTop = block.top;
const blockBottom = block.bottom;

// Example heuristic: only treat it as fully off-screen when its bottom is above scrollTop
const fullyOffscreen = blockBottom <= scrollTop;
```

You can combine this with the earlier check so that the sticky header appears only when the function line is truly off the top of the scroll area.

Even if you don’t handle this edge perfectly, the feature will still be usable; a brief overlap is usually not critical.

---

## Styling and Z‑Index

Define a base theme to style the panel:

```js
const stickyHeaderTheme = EditorView.baseTheme({
  ".cm-stickyHeader": {
    backgroundColor: "#f0f0f0",
    fontWeight: "bold",
    padding: "2px 4px",
    borderBottom: "1px solid #ccc",
  },
});
```

Then include `stickyHeaderTheme` alongside the panel extension:

```js
const stickyHeaderExtension = [stickyHeaderTheme, stickyHeaderPanel];
```

Panels live within the editor’s own DOM and are stacked vertically with other panels (like search bars) in the order they are added. If your editor has multiple top panels, you may need to control their ordering by where you place `stickyHeaderPanel` in the extension list.

Gutters (line numbers, diff markers, etc.) are independent of panels; they remain visually aligned with the code while the sticky header sits above the content area.

---

## Integration with NiceGUI’s CM6 Setup

Since the editor is embedded via NiceGUI’s `ui.codemirror` (with CodeMirror 6 vendored), we need to integrate our extension into that system.

NiceGUI’s vendored CodeMirror typically instantiates the editor with a base extension list (language, theme, line numbers, diff and minimap extensions, etc.). It also uses `Compartment`s for togglable features.

### 1. Compartment‑based toggling

Inside your vendored `codemirror.js` (or equivalent), create a compartment for the sticky header:

```js
import * as CM from "@codemirror/state";
import {stickyHeaderExtension} from "./sticky_header_extension"; // where you defined it

const stickyHeaderCompartment = new CM.Compartment();

const baseExtensions = [
  // ... existing extensions
  stickyHeaderCompartment.of([]), // initially disabled
];

export function setStickyHeader(view, enabled) {
  view.dispatch({
    effects: stickyHeaderCompartment.reconfigure(
      enabled ? stickyHeaderExtension : [],
    ),
  });
}
```

From the NiceGUI Python side (`codemirror.py`), you can expose a method that calls `setStickyHeader(view, bool)` via `run_method`. That aligns with how other dynamic options (minimap, line wrapping, diff gutters, etc.) are already wired in your framework.

### 2. Always‑on inclusion

If you prefer sticky headers always enabled, simply include `stickyHeaderExtension` in the base extension list instead of a compartment. You can still later refactor it behind a compartment if you want user‑configurable behavior.

### 3. Iframe/container concerns

Because the sticky header is a CodeMirror panel inside the editor’s own DOM, it is not affected by outer scroll containers or iframes beyond the editor’s bounding box. As long as the editor widget itself has an internal scroll area (standard CM6 behavior), the sticky panel will remain at the top of that internal scroll area.

---

## Scroll, Virtualization, and Wrapping Recap

This implementation uses CM6‑native techniques – a panel plus syntax tree analysis – rather than general webpage scroll tricks. We’re not altering the browser’s scroll behavior or using `position: sticky` on actual code lines (which doesn’t interact correctly with the editor’s virtualization).

Instead, we rely on CodeMirror’s own update cycle and parsing:

- **Scroll position awareness**
  - By listening to view updates (especially the `viewportChanged` flag), we know when the user scrolls [10].
  - No direct DOM `scroll` listener is required, though you *can* attach to `view.scrollDOM` if absolutely needed.

- **Virtual rendering**
  - CodeMirror only renders the visible lines plus a margin.
  - Our logic uses the parse tree, which represents the document structure independent of what is currently rendered.
  - We can ensure the tree is available near the viewport using `syntaxTreeAvailable` and `ensureSyntaxTree` / `forceParsing` as needed.

- **Line wrapping**
  - Wrapping can cause partial visibility of long lines, so a bit of duplication is possible.
  - Optional block‑geometry checks (via `view.lineBlockAt`) can further reduce duplicates.

By composing this sticky header extension with your existing CM6 configuration (minimap, diff gutters, draft diff overlays, etc.), you get a Monaco‑style “sticky scroll” feature without leaving CodeMirror. From a user’s perspective, the behavior closely matches VS Code’s sticky scroll, while remaining compatible with your NiceGUI + iframe + backend‑driven architecture.

---

## Sources

1. **Sticky Scroll · Issue #5341 · ajaxorg/ace · GitHub**  
   https://github.com/ajaxorg/ace/issues/5341
2. **Sticky top line that stays fixed/frozen vertically at the top of the view? – v6 – discuss.CodeMirror**  
   https://discuss.codemirror.net/t/sticky-top-line-that-stays-fixed-frozen-vertically-at-the-top-of-the-view/8813
3. **CodeMirror Panel Example**  
   https://codemirror.net/examples/panel/
4. **CodeMirror Reference Manual**  
   https://codemirror.net/docs/ref/
5. **Given lezer parse tree and cursor location, retrieve node? – discuss.CodeMirror**  
   https://discuss.codemirror.net/t/given-lezer-parse-tree-and-cursor-location-retrieve-node/5294
6. **extend/overlay mode – v6 – discuss.CodeMirror**  
   https://discuss.codemirror.net/t/extend-overlay-mode/2818
7. **Lezer Tree API – CodeMirror / Lezer docs**  
   https://lezer.codemirror.net/docs/ref/#tree.Tree.resolveInner
8. **ViewPlugin / ViewUpdate – CodeMirror docs**  
   https://codemirror.net/docs/ref/#view.ViewPlugin
9. **Viewport updates and virtualization – CodeMirror docs**  
   https://codemirror.net/docs/ref/#view.ViewUpdate.viewportChanged
10. **scrollDOM / lineBlockAt – CodeMirror view API**  
    https://codemirror.net/docs/ref/#view.EditorView.lineBlockAt
11. **syntaxTreeAvailable / ensureSyntaxTree / forceParsing – @codemirror/language**  
    https://codemirror.net/docs/ref/#language
12. **termux-extensions-2 CodeMirror vendor (codemirror.js)**  
    https://github.com/mrsurge/termux-extensions-2/blob/main/app/static/vendor/nicegui/elements/codemirror/codemirror.js

