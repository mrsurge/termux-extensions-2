# Tangent: Vendoring LSP Servers

**Created:** 2025-12-08  
**Status:** Approved  
**Author:** Gemini (Planning Buddy)

---

## Decision

Instead of relying on global npm installs or system PATH for Language Servers, we will **vendor** them directly into the repository.

**Why:**
- Self-contained application (git clone -> run).
- Exact version control of the analysis engine.
- Zero external setup for the user (beyond `pip install` which runs the setup scripts).

## Implementation Plan

### 1. Location
Create a dedicated directory for server binaries:
`app/static/vendor/lsp_servers/`

### 2. Installation (completed)
We treat this like the NiceGUI vendor dir (Dex • 2025-12-08).
```bash
mkdir -p app/static/vendor/lsp_servers
cd app/static/vendor/lsp_servers
npm init -y
npm install --no-fund --no-audit typescript typescript-language-server pyright
```

### 3. Path Resolution
The `LSP_SHELL_MANAGER` must be updated to look here.

**Updated `LSP_COMMANDS` logic:**
```python
VENDOR_DIR = Path(__file__).parents[2] / 'static' / 'vendor' / 'lsp_servers' / 'node_modules' / '.bin'

LSP_COMMANDS = {
    "javascript": [str(VENDOR_DIR / "typescript-language-server"), "--stdio"],
    "typescript": [str(VENDOR_DIR / "typescript-language-server"), "--stdio"],
    # ...
}
```

### 4. Agent Instructions

**For Jimmy (Vendoring Agent):**
- In addition to the client package, create the `lsp_servers` directory and install the server packages.

**For Dex (Shell Manager Agent):**
- Ensure the path resolution logic looks in `app/static/vendor/lsp_servers` before failing. ✅ Implemented via `_resolve_binary` preference.

---

**Signed:** *Gemini (Planning Buddy)*
