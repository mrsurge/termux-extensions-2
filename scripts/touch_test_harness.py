#!/usr/bin/env python3
"""
Standalone Monaco touch-tap test harness.

Serves the vendored Monaco ESM build with TS/JS workers on port 9876.
No m_editor_app.js, no socket.io, no touch extension, no adapter.
Purpose: isolate whether touch-tap cursor placement is broken in the
Monaco build itself or in our code layer.

Usage:  python scripts/touch_test_harness.py
        Open http://<device-ip>:9876 on your phone
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, Response
from starlette.responses import FileResponse
from starlette.staticfiles import StaticFiles

PORT = 9876
REPO = Path(__file__).resolve().parents[1]
MONACO_VENDOR = REPO / "app" / "static" / "vendor" / "monaco-editor-core"
ESM_DIR = MONACO_VENDOR / "esm"
LANG_DIR = MONACO_VENDOR / "te2-lang"
CODICONS_DIR = REPO / "app" / "static" / "vendor" / "codicons"
FONTS_DIR = REPO / "app" / "static" / "fonts"
TOUCH_DIR = REPO / "app" / "apps" / "code_te2" / "static" / "vendor" / "monaco-touch-selection"

SAMPLE_JS_ORIGINAL = textwrap.dedent("""\
    // Sample file for touch-tap testing
    // Tap anywhere in this file — does the cursor move?

    /**
     * @param {string} name
     * @returns {string}
     */
    function greet(name) {
        const greeting = `Hello, ${name}!`;
        console.log(greeting);
        return greeting;
    }

    class Calculator {
        /** @type {number} */
        result = 0;

        add(a, b) {
            this.result = a + b;
            return this.result;
        }

        subtract(a, b) {
            this.result = a - b;
            return this.result;
        }
    }

    const calc = new Calculator();
    calc.add(10, 20);
    greet("World");
""")

SAMPLE_JS_MODIFIED = textwrap.dedent("""\
    // Sample file for touch-tap testing
    // Tap anywhere in this file — does the cursor move?
    // (modified version with changes)

    /**
     * @param {string} name
     * @param {string} [greeting="Hello"]
     * @returns {string}
     */
    function greet(name, greeting = "Hello") {
        const message = `${greeting}, ${name}!`;
        console.log(message);
        return message;
    }

    class Calculator {
        /** @type {number} */
        result = 0;

        add(a, b) {
            this.result = a + b;
            return this.result;
        }

        subtract(a, b) {
            this.result = a - b;
            return this.result;
        }

        multiply(a, b) {
            this.result = a * b;
            return this.result;
        }
    }

    const calc = new Calculator();
    calc.add(10, 20);
    calc.multiply(5, 6);
    greet("World");
    greet("Monaco", "Hey");
""")

HTML_PAGE = textwrap.dedent("""\
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Monaco Touch Test</title>
      <link rel="stylesheet" href="/codicons/codicon.css">
      <link rel="stylesheet" href="/lang/bootstrap/monaco.bootstrap.bundle.css?raw=1">
      <link rel="stylesheet" href="/touch/monaco-touch-selection.css">
      <style>
        html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: #1e1e1e; }
        #container { width: 100%; height: calc(100% - 36px); -webkit-touch-callout: none; user-select: none; }
        #toolbar {
          display: flex; align-items: center; gap: 8px;
          background: #252526; color: #ccc;
          font: 13px sans-serif; padding: 4px 12px;
          height: 36px; box-sizing: border-box;
          border-bottom: 1px solid #333;
        }
        #toolbar button {
          background: #0e639c; color: #fff; border: none;
          padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 12px;
        }
        #toolbar button.active { background: #1177bb; outline: 2px solid #58a6ff; }
        #toolbar button:not(.active) { background: #3c3c3c; }
        #status { flex: 1; text-align: right; font-size: 11px; color: #888; }
      </style>
    </head>
    <body>
      <div id="toolbar">
        <button id="btn-plain" class="active">Plain Editor</button>
        <button id="btn-diff">Diff View</button>
        <button id="btn-inline">Inline Diff</button>
        <span id="status">loading…</span>
      </div>
      <div id="container"></div>

      <script type="importmap">
      { "imports": { "monaco-editor-core": "/esm/vs/editor/editor.api.js" } }
      </script>

      <!-- Load touch extension BEFORE Monaco (same as real editor_iframe.html) -->
      <script src="/touch/monaco-touch-selection.patched.umd.js"></script>

      <script type="module">
        window.MonacoEnvironment = {
          getWorker(_moduleId, label) {
            let url;
            if (label === 'typescript' || label === 'javascript') {
              url = '/lang/workers/ts.worker.js';
            } else {
              url = '/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js';
            }
            console.log('[TouchTest] worker', label, url);
            return new Worker(url, { type: 'module' });
          }
        };

        const { loadMonaco } = await import('/lang/bootstrap/monaco.bootstrap.bundle.js');
        const monaco = await loadMonaco();
        window.monaco = monaco;
        console.log('[TouchTest] Monaco loaded:', Object.keys(monaco));

        const container = document.getElementById('container');
        const statusEl = document.getElementById('status');

        const originalContent = ORIGINAL_CONTENT;
        const modifiedContent = MODIFIED_CONTENT;

        // Create models once
        const originalModel = monaco.editor.createModel(originalContent, 'javascript', monaco.Uri.parse('file:///original.js'));
        const modifiedModel = monaco.editor.createModel(modifiedContent, 'javascript', monaco.Uri.parse('file:///modified.js'));

        let currentEditor = null;
        let currentMode = null;

        function destroyCurrent() {
          if (currentEditor) { currentEditor.dispose(); currentEditor = null; }
        }

        function ensureTouchSelection(ed, reason) {
          try {
            const ts = window['monaco-touch-selection'];
            if (!(ts && ts.editorTouchSelectionHelp)) return;
            ts.editorTouchSelectionHelp(ed);
            console.log('[TouchTest] touch-selection bound:', reason);
          } catch(e) { console.warn('[TouchTest] touch-selection failed:', e); }
        }

        function createPlain() {
          destroyCurrent();
          currentMode = 'plain';
          currentEditor = monaco.editor.create(container, {
            model: modifiedModel,
            theme: 'vs-dark',
            fontSize: 14,
            minimap: { enabled: false },
            automaticLayout: true,
          });
          wireEvents(currentEditor);
          ensureTouchSelection(currentEditor, 'plain');
        }

        function createDiff(renderSideBySide) {
          destroyCurrent();
          currentMode = renderSideBySide ? 'diff' : 'inline';
          // Match the real TE2 diff editor options exactly
          currentEditor = monaco.editor.createDiffEditor(container, {
            renderSideBySide: false,
            readOnly: false,
            originalEditable: false,
            enableSplitViewResizing: false,
            automaticLayout: true,
            experimental: { useTrueInlineView: false },
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            renderGutterMenu: false,
            theme: 'vs-dark',
            fontSize: 14,
            minimap: { enabled: false },
          });
          if (renderSideBySide) {
            currentEditor.updateOptions({ renderSideBySide: true });
          }

          // Activate pinned diff projection (te2AutosaveMode = false)
          const diffModel = {
            original: originalModel,
            modified: modifiedModel,
          };
          // Set the TE2 fork flags on the model pair
          try { diffModel.te2AutosaveMode = false; } catch(_){}
          try { diffModel.te2FreezeProjection = false; } catch(_){}
          // Create a baseline snapshot (what TE2 does when autosave is OFF)
          try {
            const baselineContent = originalContent;
            diffModel.modifiedBaseline = monaco.editor.createModel(
              baselineContent, 'javascript', monaco.Uri.parse('file:///baseline.js')
            );
          } catch(_){}

          currentEditor.setModel(diffModel);

          // Wire events on modified editor inside diff
          const modEditor = currentEditor.getModifiedEditor();
          if (modEditor) { wireEvents(modEditor); ensureTouchSelection(modEditor, 'diff-mod'); }
          const origEditor = currentEditor.getOriginalEditor();
          if (origEditor) { wireEvents(origEditor); ensureTouchSelection(origEditor, 'diff-orig'); }
        }

        function wireEvents(editor) {
          const dom = editor.getDomNode();
          if (!dom) return;
          for (const evt of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) {
            dom.addEventListener(evt, (e) => {
              console.log(`[TouchTest] ${e.type}`, {
                pointerType: e.pointerType || 'n/a',
                target: e.target?.className?.substring(0, 60),
                x: Math.round(e.clientX || e.touches?.[0]?.clientX || 0),
                y: Math.round(e.clientY || e.touches?.[0]?.clientY || 0),
              });
            }, { passive: true });
          }
          editor.onDidChangeCursorPosition((e) => {
            statusEl.textContent = `L${e.position.lineNumber} C${e.position.column} [${e.source}] — ${currentMode}`;
          });
        }

        // Toolbar buttons
        const btnPlain = document.getElementById('btn-plain');
        const btnDiff = document.getElementById('btn-diff');
        const btnInline = document.getElementById('btn-inline');

        function setActive(btn) {
          [btnPlain, btnDiff, btnInline].forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }

        btnPlain.onclick = () => { setActive(btnPlain); createPlain(); };
        btnDiff.onclick = () => { setActive(btnDiff); createDiff(true); };
        btnInline.onclick = () => { setActive(btnInline); createDiff(false); };

        // Start with plain editor
        createPlain();
        statusEl.textContent = 'Ready — tap to test cursor placement';
        console.log('[TouchTest] Ready. Switch modes with toolbar buttons.');
      </script>
    </body>
    </html>
""")

app = FastAPI()


@app.get("/", response_class=HTMLResponse)
async def index():
    def escape_for_template(s):
        return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    html = HTML_PAGE.replace("ORIGINAL_CONTENT", f"`{escape_for_template(SAMPLE_JS_ORIGINAL)}`")
    html = html.replace("MODIFIED_CONTENT", f"`{escape_for_template(SAMPLE_JS_MODIFIED)}`")
    return HTMLResponse(html)


# Serve Monaco ESM modules with CSS shim (same trick as m_editor_app.py)
@app.get("/esm/{file_path:path}")
async def serve_esm(file_path: str, raw: str | None = None):
    return _serve_with_css_shim(ESM_DIR, file_path, raw)


@app.get("/lang/{file_path:path}")
async def serve_lang(file_path: str, raw: str | None = None):
    return _serve_with_css_shim(LANG_DIR, file_path, raw)


@app.get("/codicons/{file_path:path}")
async def serve_codicons(file_path: str):
    target = (CODICONS_DIR / file_path).resolve()
    if not target.exists():
        return Response("not found", status_code=404)
    return FileResponse(str(target))


@app.get("/touch/{file_path:path}")
async def serve_touch(file_path: str):
    target = (TOUCH_DIR / file_path).resolve()
    if not target.exists():
        return Response("not found", status_code=404)
    return FileResponse(str(target))


@app.get("/fonts/{file_path:path}")
async def serve_fonts(file_path: str):
    target = (FONTS_DIR / file_path).resolve()
    if not target.exists():
        return Response("not found", status_code=404)
    return FileResponse(str(target))


def _serve_with_css_shim(base_dir: Path, file_path: str, raw: str | None):
    target = (base_dir / file_path).resolve()
    if not str(target).startswith(str(base_dir.resolve())):
        return Response("not found", status_code=404)
    if not target.exists() or not target.is_file():
        return Response("not found", status_code=404)
    if target.suffix == ".css" and raw == "1":
        return FileResponse(str(target), media_type="text/css")
    if target.suffix == ".css":
        shim = textwrap.dedent("""\
            const url = new URL(import.meta.url);
            url.searchParams.set('raw', '1');
            const href = url.toString();
            const id = 'te2-css:' + href;
            if (!document.querySelector(`link[data-te2-css="${id}"]`)) {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = href;
              link.dataset.te2Css = id;
              document.head.appendChild(link);
            }
            export default href;
        """)
        return Response(shim, media_type="application/javascript")
    return FileResponse(str(target))


if __name__ == "__main__":
    print(f"\n  🔬 Monaco Touch Test Harness")
    print(f"  http://0.0.0.0:{PORT}/")
    print(f"  Open on your phone to test touch-tap cursor placement.\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
