const INLINE_EDITOR_API_BASE = '/api/app/code_te2';
const INLINE_EDITOR_HOST_STYLE_ID = 'fe-inline-monaco-host-style';
const INLINE_EDITOR_STYLE_ASSETS = [
  {
    id: 'fe-inline-monaco-touch-selection-css',
    href: '/api/app/code_te2/static/vendor/monaco-touch-selection/monaco-touch-selection.css',
  },
  {
    id: 'fe-inline-monaco-bootstrap-css',
    href: '/api/app/code_te2/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css?raw=1',
  },
  {
    id: 'fe-inline-monaco-breadcrumbs-css',
    href: '/apps/code_te2/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css',
  },
  {
    id: 'fe-chat-editor-controller-css',
    href: '/apps/code_te2/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditorController.css',
  },
  {
    id: 'fe-chat-editing-editor-overlay-css',
    href: '/apps/code_te2/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditingEditorOverlay.css',
  },
] as const;
const INLINE_EDITOR_SCRIPT_ASSETS = [
  {
    id: 'fe-inline-monaco-touch-selection-js',
    src: '/api/app/code_te2/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js',
  },
] as const;
const INLINE_EDITOR_MARKUP = `
  <div class="fh-root">
    <div id="te2-breadcrumbs"></div>
    <div id="fh-monaco"></div>
  </div>
`;
const INLINE_EDITOR_HOST_STYLE = `
#editor-frame .monaco-editor .find-widget {
  z-index: 300;
}
#editor-frame[data-te2-native-renderer='cefrium'] .monaco-editor .find-widget textarea.input {
  font-size: 16px !important;
}
#editor-frame .te2-mobile-special-key.te2-mobile-special-key-overlay-trigger,
.fe-editor-container > .te2-mobile-second-window-trigger {
  position: absolute;
  left: 14px;
  bottom: 14px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  background: rgba(24, 28, 34, 0.34);
  color: rgba(255, 255, 255, 0.58);
  font: 600 0.72rem/1 'JetBrains Mono Nerd', 'JetBrains Mono', monospace;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  z-index: 35;
}
#editor-frame .te2-mobile-special-key.te2-mobile-special-key-save-trigger {
  left: 66px;
}
.fe-editor-container > .te2-mobile-second-window-trigger {
  left: 118px;
}
#editor-frame .te2-mobile-special-key.te2-mobile-special-key-save-trigger[hidden],
.fe-editor-container > .te2-mobile-second-window-trigger[hidden],
.fe-root:not(.layout-mobile) #editor-frame .te2-mobile-special-key-overlay-trigger,
.fe-root:not(.layout-mobile) .fe-editor-container > .te2-mobile-second-window-trigger {
  display: none;
}
.fe-root.layout-mobile > .te2-mobile-special-key-panel {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-column: 1;
  grid-row: 6;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: var(--card, #111827);
  z-index: 55;
}
.fe-root > .te2-mobile-special-key-panel[hidden],
.fe-root:not(.layout-mobile) > .te2-mobile-special-key-panel {
  display: none;
}
#editor-frame .te2-mobile-special-key,
.fe-root.layout-mobile > .te2-mobile-special-key-panel .te2-mobile-special-key {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 8px 2px calc(env(safe-area-inset-bottom, 0px) + 8px);
  border: 0;
  border-radius: 0;
  background: var(--secondary, #252a34);
  color: var(--foreground, #e5e7eb);
  font: 500 0.85rem/1 'JetBrains Mono Nerd', 'JetBrains Mono', monospace;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
#editor-frame .te2-mobile-special-key.toggle,
.fe-root.layout-mobile > .te2-mobile-special-key-panel .te2-mobile-special-key.toggle {
  background: var(--accent, #2563eb);
  color: var(--primary-foreground, #fff);
}
#editor-frame .te2-mobile-special-key:focus,
.fe-root.layout-mobile > .te2-mobile-special-key-panel .te2-mobile-special-key:focus {
  outline: none;
}
#editor-frame .monaco-editor .te2-draft-add-line,
#editor-frame .monaco-editor .te2-draft-add-line.line-insert,
#editor-frame .monaco-editor .line-insert.te2-draft-add-line,
#editor-frame .monaco-editor .te2-draft-add-line .view-line {
  background: rgba(56, 139, 253, 0.24) !important;
}
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
  buildSidebarMentionPayload?: (
    payload: Record<string, unknown>,
  ) => Record<string, unknown>;
}

declare global {
  interface Window {
    __te2InlineMonacoHost?: boolean;
    __te2InlineMonacoApiBase?: string;
    __te2InlineMonacoBootSnapshot?: unknown;
    __te2InlineMonacoBuildSidebarMentionPayload?: (
      payload: Record<string, unknown>,
    ) => Record<string, unknown>;
    __te2InlineMonacoBoot?: Promise<void>;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function markNativeRenderer(editorFrame: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const renderer = (params.get('te2_renderer') || '').trim().toLowerCase();
  if (renderer === 'cefrium') {
    editorFrame.dataset.te2NativeRenderer = renderer;
    return;
  }
  delete editorFrame.dataset.te2NativeRenderer;
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
  window.__te2InlineMonacoBuildSidebarMentionPayload =
    options.buildSidebarMentionPayload;
  markNativeRenderer(editorFrame);
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
