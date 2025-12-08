# LSP-Powered Sticky Scroll Refactor Notes

**Created:** 2025-12-07  
**Status:** Planning  
**Purpose:** Replace Lezer-based scope detection with LSP `documentSymbol` trees for Monaco-parity sticky scroll behavior

---

## Background

The current sticky scroll implementation in `codemirror.js` uses:
- `tree.resolveInner()` + `isScopeNode()` for code languages (Lezer syntax tree)
- Custom heading collection for Markdown

**Problem:** Lezer's syntax tree doesn't expose as many nested scopes as Monaco's language server integration. Monaco uses its language server to derive scopes, giving deeper nesting and more accurate boundaries.

**Solution:** Replace per-language parsing heuristics with unified LSP `textDocument/documentSymbol` trees.

---

## Design Decisions (from conversation)

### 1. Single Document Model Simplifies LSP

Given our constraints:
- Exactly **one logical document open at a time**
- All devices are mirrors of that single editor state
- Single-user, single-cursor

LSP view simplifies to:
- Exactly **one `textDocument` open per language server** at any moment
- On file switch: `didClose` for old → `didOpen` for new
- Same server process stays alive (keeps project context/caches)

**No multi-document juggling needed.** Our single-document architecture *is* the LSP document model.

### 2. One Server Per Shell

**Do NOT run multiple language servers in one framework shell.**

✅ **Recommended:** One LSP server per shell/process
```
shell "lsp-python" → runs pyright-langserver --stdio
shell "lsp-ts"     → runs typescript-language-server --stdio
shell "lsp-go"     → runs gopls serve
```

Benefits:
- If one crashes, only restart that shell
- Clean logs: `shell:lsp-python` logs Python LS chatter only
- Simple routing: WS → shell bridge is just "pipe bytes"

❌ **Not recommended:** Multiple LS in one shell
- Would require custom router process
- Must implement multi-server lifecycle, routing, error isolation
- Basically re-inventing VS Code's extension host

### 3. Runtime Behavior

With single-doc editor:
- Determine `languageId` for current doc
- `get_or_spawn_shell("lsp-" + languageId)`
- LSP client in CM6 connects via WS to that shell

On file switch to different language:
- Editor sends `didClose` to old LS
- `get_or_spawn_shell("lsp-newlang")`, `didOpen` there
- Optionally: keep old shell running (fast switch-back) or kill after N minutes idle

**Result:** Usually **one LSP shell alive** at a time.

### 4. Per-Project Configuration (Future)

Per-project sidecar extends with:
```jsonc
"languageServers": {
  "python": true,
  "typescript": false,
  "rust": false
}
```

Modal in editor to toggle which LS are enabled for the current project.

Backend decides: "current project + languageId → should we connect LSP?"

---

## Architecture: Framework Shell Integration

### Using Existing Infrastructure

From `docs/core/framework_shells.md`:

```python
# Spawn LSP shell
from app.framework_shells import get_framework_shell_manager

def get_or_spawn_lsp_shell(language_id: str):
    manager = get_framework_shell_manager()
    label = f"lsp-{language_id}"
    
    # Check for existing shell
    shells = manager.list_shells()
    for shell in shells:
        if shell.label == label and shell.alive:
            return shell
    
    # Spawn new shell
    command = LSP_COMMANDS.get(language_id)
    if not command:
        return None
    
    return manager.spawn_shell(
        command=command,
        label=label,
        cwd=project_root,
        autostart=False
    )

LSP_COMMANDS = {
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    "go": ["gopls", "serve"],
    "rust": ["rust-analyzer"],
}
```

### Communication Flow

```
CM6 LSP Client Extension
    ↓ WebSocket (bidirectional)
Framework Shell WebSocket Bridge
    ↓ STDIO (bidirectional)  
Language Server Process (pyright, etc.)
```

LSP uses JSON-RPC over STDIO. Framework shell already supports:
- `POST /api/framework_shells/<id>/write` - Send to stdin
- `WS /api/framework_shells/<id>/ws` - Bidirectional stream

---

## Architecture: CodeMirror 6 Integration

### Vendoring Requirements

Per `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`:

1. **Install package:**
   ```bash
   cd app/static/vendor/nicegui/elements/codemirror
   npm install @codemirror/lsp-client
   # OR
   npm install codemirror-languageserver
   ```

2. **Export in bundle:**
   ```javascript
   // src/index.mjs
   export * from "@codemirror/lsp-client";
   ```

3. **Rebuild bundle:**
   ```bash
   npm run build
   # May need to comment out terser if OOM
   ```

4. **Add Vue methods to `codemirror.js`:**
   ```javascript
   connectLSP(wsUrl) {
     // Initialize LSP client with WebSocket transport
   }
   
   disconnectLSP() {
     // Clean up LSP connection
   }
   
   onDocumentSymbols(callback) {
     // Subscribe to symbol updates for sticky scroll
   }
   ```

5. **Add Python wrappers to `codemirror.py`:**
   ```python
   def connect_lsp(self, ws_url: str) -> None:
       self.run_method('connectLSP', ws_url)
   
   def disconnect_lsp(self) -> None:
       self.run_method('disconnectLSP')
   ```

### Package Options

| Package | Maturity | Notes |
|---------|----------|-------|
| `@codemirror/lsp-client` | Early/Experimental | Official CM project |
| `codemirror-languageserver` (Shopify) | More mature | Requires WebSocket bridge |

Need to evaluate both for our use case.

---

## Symbol → Sticky Scroll Pipeline

### Current Implementation

```javascript
// In updateStickyHeader() - codemirror.js
const tree = CM.ensureSyntaxTree(state, state.doc.length, 200);
let node = tree.resolveInner(refPos);
for (; node; node = node.parent) {
  if (isScopeNode(node, scopeTypes, state, isPython)) {
    ancestorNodes.push(node);
  }
}
```

### New Implementation

```javascript
// LSP provides symbol tree like:
[
  { "name": "MyClass", "kind": 5, "range": {...},
    "children": [
      { "name": "myMethod", "kind": 6, "range": {...} }
    ]
  }
]

// Convert to sticky sections:
function flattenSymbols(state, symbols) {
  const sections = [];
  
  function walk(symbol, depth) {
    const startLine = state.doc.lineAt(symbol.range.start).number;
    const endLine = state.doc.lineAt(symbol.range.end).number;
    
    sections.push({
      depth,
      startLine,
      endLine,
      text: symbol.name,
      kind: symbol.kind,
      // ... other fields for sticky scroll
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

### Fallback Path

Keep existing implementation for:
- Markdown (no LSP servers for that)
- Plain text
- Languages without available servers
- When user disables LSP for project

---

## Implementation Phases

### Phase 1: Proof of Concept (Python only)

1. Create LSP shell manager module
2. Add `pyright-langserver` shell spawning
3. Create WebSocket bridge (framework shell → CM6)
4. Vendor `@codemirror/lsp-client`
5. Wire `documentSymbol` to sticky scroll
6. Test with Python files

### Phase 2: Multi-Language Support

1. Add TypeScript/JavaScript (typescript-language-server)
2. Add Go (gopls)
3. Abstract language-specific configuration

### Phase 3: Per-Project Configuration

1. Add `languageServers` to ProjectSidecar
2. Create settings modal
3. Enable/disable per project

### Phase 4: Full LSP Features (Future)

- Code completion
- Diagnostics
- Hover information
- Go to definition

---

## Open Questions

1. **LSP Server Binaries:** Which servers to support initially?
   - Recommendation: Start with Python + pyright only

2. **WebSocket Route:** Use existing framework shell WS or new endpoint?
   - Option A: `/api/framework_shells/<id>/ws` (existing)
   - Option B: `/ws/lsp/<language>` (new dedicated)

3. **Package Choice:** `@codemirror/lsp-client` vs `codemirror-languageserver`?
   - Need to evaluate both

---

## Files to Modify

### New Files
- `app/apps/file_editor_cm6/lsp_shell_manager.py` - LSP shell lifecycle
- `app/apps/file_editor_cm6/lsp_bridge.py` - WebSocket → STDIO bridge

### Modified Files
- `app/static/vendor/nicegui/elements/codemirror/package.json` - Add LSP package
- `app/static/vendor/nicegui/elements/codemirror/src/index.mjs` - Export LSP
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js` - LSP client + sticky scroll refactor
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py` - Python LSP methods
- `app/apps/file_editor_cm6/editor_app.py` - LSP endpoints

---

## References

- Current sticky scroll docs: `notes/2025-12-7_CURRENT_STICKY_SCROLL_TECHNICAL.md`
- Feature adding guidelines: `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`
- Framework shells: `docs/core/framework_shells.md`
- Code CM6 technical: `docs/apps/code_cm6/TECHNICAL.md`

---

*Last Updated: 2025-12-07 17:30 CST*
