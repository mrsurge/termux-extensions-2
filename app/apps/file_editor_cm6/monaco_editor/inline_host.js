const INLINE_EDITOR_API_BASE = '/api/app/file_editor_cm6';
const INLINE_EDITOR_HOST_STYLE_ID = 'fe-inline-monaco-host-style';
const INLINE_EDITOR_STYLE_ASSETS = [
  {
    id: 'fe-inline-monaco-touch-selection-css',
    href: '/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.css',
  },
  {
    id: 'fe-inline-monaco-bootstrap-css',
    href: '/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css?raw=1',
  },
  {
    id: 'fe-inline-monaco-breadcrumbs-css',
    href: '/apps/file_editor_cm6/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css',
  },
];
const INLINE_EDITOR_SCRIPT_ASSETS = [
  {
    id: 'fe-inline-monaco-touch-selection-js',
    src: '/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js',
  },
  {
    id: 'fe-inline-monaco-onig-js',
    src: '/apps/file_editor_cm6/monaco_editor/textmate/vscode-oniguruma.umd.js',
  },
  {
    id: 'fe-inline-monaco-textmate-js',
    src: '/apps/file_editor_cm6/monaco_editor/textmate/vscode-textmate.umd.js',
  },
];
const INLINE_EDITOR_MARKUP = `
  <div class="fh-root">
    <div id="te2-breadcrumbs"></div>
    <div id="fh-monaco"></div>
  </div>
`;
const INLINE_EDITOR_HOST_STYLE = `
#editor-frame .monaco-editor .te2-draft-add-line { background: rgba(56, 139, 253, 0.22) !important; }
#editor-frame .monaco-editor .te2-draft-del-line { background: rgba(210, 153, 34, 0.18) !important; }
#editor-frame .monaco-editor .margin-view-overlays .te2-draft-del-marker {
  background: rgba(210, 153, 34, 0.90);
  width: 3px !important;
}
#editor-frame .monaco-editor .te2-draft-del-zone {
  background: rgba(210, 153, 34, 0.12);
  color: #e6b450;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
}
#editor-frame .monaco-editor .margin-view-overlays .codicon-folding-expanded,
#editor-frame .monaco-editor .margin-view-overlays .codicon-folding-collapsed,
#editor-frame .monaco-editor .margin-view-overlays .codicon-folding-manual-expanded,
#editor-frame .monaco-editor .margin-view-overlays .codicon-folding-manual-collapsed,
#editor-frame .monaco-editor .arrow-revert-change {
  opacity: 1 !important;
  visibility: visible !important;
}
`;

function ensureInlineStylesheetAsset(id, href) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function ensureInlineStyleAsset(id, cssText) {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== cssText) existing.textContent = cssText;
    return;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
}

function ensureInlineScriptAsset(id, src) {
  const existing = document.getElementById(id);
  if (existing && existing.dataset.loaded === 'true') return Promise.resolve(existing);
  if (existing && existing.dataset.loading === 'true') {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(existing), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = existing || document.createElement('script');
    script.id = id;
    script.async = true;
    script.dataset.loading = 'true';
    script.src = src;
    script.onload = () => {
      script.dataset.loading = 'false';
      script.dataset.loaded = 'true';
      resolve(script);
    };
    script.onerror = () => {
      script.dataset.loading = 'false';
      reject(new Error(`Failed to load ${src}`));
    };
    if (!existing) document.head.appendChild(script);
  });
}

async function ensureInlineEditorAssetsLoaded(ensureSocketIoLoaded) {
  ensureInlineStyleAsset(INLINE_EDITOR_HOST_STYLE_ID, INLINE_EDITOR_HOST_STYLE);
  INLINE_EDITOR_STYLE_ASSETS.forEach((asset) => ensureInlineStylesheetAsset(asset.id, asset.href));
  if (typeof ensureSocketIoLoaded === 'function') {
    await ensureSocketIoLoaded();
  }
  for (const asset of INLINE_EDITOR_SCRIPT_ASSETS) {
    await ensureInlineScriptAsset(asset.id, asset.src);
  }
}

function renderInlineEditorError(editorFrame, err) {
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.padding = '16px';
  pre.style.color = '#fca5a5';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = `Inline Monaco boot failed: ${String(err?.message || err)}`;
  editorFrame.replaceChildren(pre);
}

export async function mountInlineEditorHost(editorFrame, options = {}) {
  if (!(editorFrame instanceof HTMLElement)) {
    throw new Error('Inline Monaco host requires an HTMLElement mount point.');
  }
  window.__te2InlineMonacoHost = true;
  window.__te2InlineMonacoApiBase = INLINE_EDITOR_API_BASE;
  editorFrame.innerHTML = INLINE_EDITOR_MARKUP;
  await ensureInlineEditorAssetsLoaded(options.ensureSocketIoLoaded);
  await import('./m_editor_app.ts');
}

export function bootInlineEditorHost(editorFrame, options = {}) {
  const bootPromise = mountInlineEditorHost(editorFrame, options).catch((err) => {
    console.error('[inline_monaco] boot failed', err);
    renderInlineEditorError(editorFrame, err);
    throw err;
  });
  window.__te2InlineMonacoBoot = bootPromise;
  return bootPromise;
}
