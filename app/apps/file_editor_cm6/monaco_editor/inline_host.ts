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
] as const;
const INLINE_EDITOR_SCRIPT_ASSETS = [
  {
    id: 'fe-inline-monaco-touch-selection-js',
    src: '/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js',
  },
] as const;
const INLINE_EDITOR_MARKUP = `
  <div class="fh-root">
    <div id="te2-breadcrumbs"></div>
    <div id="fh-monaco"></div>
  </div>
`;
const INLINE_EDITOR_HOST_STYLE = `
#editor-frame .monaco-editor .te2-draft-add-line { background: rgba(56, 139, 253, 0.22) !important; }
#editor-frame .monaco-editor .te2-draft-del-line { background: rgba(210, 153, 34, 0.18) !important; }
#editor-frame .monaco-editor .te2-draft-del-zone {
  background: rgba(210, 153, 34, 0.12);
  color: #e6b450;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
}
#editor-frame .monaco-editor .te2-draft-stock-del-zone,
#editor-frame .monaco-editor .te2-draft-stock-del-zone .view-line {
  background: rgba(210, 153, 34, 0.16) !important;
}
#editor-frame .monaco-editor .te2-draft-stock-del-zone .inline-deleted-text {
  background: rgba(210, 153, 34, 0.30) !important;
}
#editor-frame .monaco-editor .te2-draft-stock-del-margin {
  background: rgba(210, 153, 34, 0.16) !important;
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

interface InlineEditorBootOptions {
  ensureSocketIoLoaded?: (() => Promise<unknown>) | null;
  bootSnapshot?: unknown;
}

declare global {
  interface Window {
    __te2InlineMonacoHost?: boolean;
    __te2InlineMonacoApiBase?: string;
    __te2InlineMonacoBootSnapshot?: unknown;
    __te2InlineMonacoBoot?: Promise<void>;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureInlineStylesheetAsset(id: string, href: string): void {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function ensureInlineStyleAsset(id: string, cssText: string): void {
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

function ensureInlineScriptAsset(id: string, src: string): Promise<HTMLScriptElement> {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLScriptElement && existing.dataset.loaded === 'true') {
    return Promise.resolve(existing);
  }
  if (existing instanceof HTMLScriptElement && existing.dataset.loading === 'true') {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(existing), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = existing instanceof HTMLScriptElement ? existing : document.createElement('script');
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
    if (!(existing instanceof HTMLScriptElement)) document.head.appendChild(script);
  });
}

async function ensureInlineEditorAssetsLoaded(
  ensureSocketIoLoaded?: (() => Promise<unknown>) | null,
): Promise<void> {
  ensureInlineStyleAsset(INLINE_EDITOR_HOST_STYLE_ID, INLINE_EDITOR_HOST_STYLE);
  INLINE_EDITOR_STYLE_ASSETS.forEach((asset) => ensureInlineStylesheetAsset(asset.id, asset.href));
  if (typeof ensureSocketIoLoaded === 'function') {
    await ensureSocketIoLoaded();
  }
  for (const asset of INLINE_EDITOR_SCRIPT_ASSETS) {
    await ensureInlineScriptAsset(asset.id, asset.src);
  }
}

function renderInlineEditorError(editorFrame: HTMLElement, error: unknown): void {
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.padding = '16px';
  pre.style.color = '#fca5a5';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = `Inline Monaco boot failed: ${getErrorMessage(error)}`;
  editorFrame.replaceChildren(pre);
}

export async function mountInlineEditorHost(
  editorFrame: HTMLElement,
  options: InlineEditorBootOptions = {},
): Promise<void> {
  if (!(editorFrame instanceof HTMLElement)) {
    throw new Error('Inline Monaco host requires an HTMLElement mount point.');
  }
  window.__te2InlineMonacoHost = true;
  window.__te2InlineMonacoApiBase = INLINE_EDITOR_API_BASE;
  window.__te2InlineMonacoBootSnapshot = options.bootSnapshot || null;
  editorFrame.innerHTML = INLINE_EDITOR_MARKUP;
  await ensureInlineEditorAssetsLoaded(options.ensureSocketIoLoaded);
  await import('./m_editor_app.ts');
}

export function bootInlineEditorHost(
  editorFrame: HTMLElement,
  options: InlineEditorBootOptions = {},
): Promise<void> {
  const bootPromise = mountInlineEditorHost(editorFrame, options).catch((error) => {
    console.error('[inline_monaco] boot failed', error);
    renderInlineEditorError(editorFrame, error);
    throw error;
  });
  window.__te2InlineMonacoBoot = bootPromise;
  return bootPromise;
}
