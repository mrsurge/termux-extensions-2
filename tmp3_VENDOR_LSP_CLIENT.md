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

**System Note:** The user's Termux environment handles `esbuild` and `node` minification correctly (Android SDK for gyp is handled via system path). No special configuration for terser is required.

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

## References

- **Feature Adding Guidelines (Vendoring):** `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`
  - See section: "Vendoring Guidelines" and "Bundle Management"
- **Vendoring LSP Servers:** `tmp9_VENDOR_TANGENT.md`

---

*Last Updated: 2025-12-07*