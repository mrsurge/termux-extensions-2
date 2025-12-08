# Vendor @codemirror/lsp-client

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** Nothing (independent)  
**Blocks:** CM6 LSP Integration (tmp5)

---

## Purpose

Add `@codemirror/lsp-client` package to the vendored CodeMirror 6 bundle.

---

## Scope

- npm install the package
- Export in bundle
- Rebuild
- Verify exports available

---

## Steps

### 1. Navigate to vendor directory
```bash
cd app/static/vendor/nicegui/elements/codemirror
```

### 2. Install package
```bash
npm install @codemirror/lsp-client
```

### 3. Update exports
```javascript
// src/index.mjs - add:
export * from "@codemirror/lsp-client";
```

### 4. Rebuild bundle
```bash
npm run build
```

If build fails (OOM/terser):
```javascript
// rollup.config.mjs - comment out:
// terser(),
```

### 5. Verify exports
```bash
grep -r "lsp" dist/
# Should show LSP-related exports
```

---

## Expected Exports

From `@codemirror/lsp-client`, we need:
- `LanguageServerClient` (or equivalent)
- Symbol/document symbol handling
- WebSocket transport support

---

## Files Modified

- `app/static/vendor/nicegui/elements/codemirror/package.json`
- `app/static/vendor/nicegui/elements/codemirror/package-lock.json`
- `app/static/vendor/nicegui/elements/codemirror/src/index.mjs`
- `app/static/vendor/nicegui/elements/codemirror/dist/*` (rebuilt)

---

## Rollback

If issues:
```bash
git checkout -- app/static/vendor/nicegui/elements/codemirror/
npm install  # restore node_modules
```

---

## Notes

- Follow pattern from search extension vendoring (Example 4 in guidelines)
- Check package README for actual export names
- May need to research actual API surface of @codemirror/lsp-client

---

*Last Updated: 2025-12-07*
