import * as smd from 'streaming-markdown';
import { createUiRpcClientPlaceholder } from './rpc/ui/client.ts';

const _uiRpcClientPlaceholder = createUiRpcClientPlaceholder;
void _uiRpcClientPlaceholder;

interface HighlightJsResult {
  value: string;
  language?: string;
}

interface HighlightJsRuntime {
  highlightElement: (element: Element) => void;
  getLanguage: (language: string) => boolean;
  highlight: (source: string, options: { language: string; ignoreIllegals: boolean }) => HighlightJsResult;
  highlightAuto: (source: string) => HighlightJsResult;
}

declare const hljs: HighlightJsRuntime | undefined;

interface StreamingMarkdownRuntime {
  default_renderer: (container: HTMLElement) => unknown;
  parser: (renderer: unknown) => unknown;
  parser_write: (parser: unknown, text: string) => void;
  parser_end: (parser: unknown) => void;
}

interface MarkdownItOptions {
  html: boolean;
  linkify: boolean;
  typographer: boolean;
  breaks: boolean;
  highlight: (source: string, lang: string) => string;
}

interface MarkdownDelimiter {
  marker: number;
  length: number;
  token: number;
  end: number;
  open: boolean;
  close: boolean;
}

interface MarkdownToken {
  type: string;
  tag: string;
  nesting: number;
  markup: string;
  content: string;
}

interface MarkdownTokenMeta {
  delimiters?: MarkdownDelimiter[];
}

interface MarkdownScannedDelims {
  length: number;
  can_open: boolean;
  can_close: boolean;
}

interface MarkdownInlineState {
  pos: number;
  src: string;
  tokens: MarkdownToken[];
  delimiters: MarkdownDelimiter[];
  tokens_meta?: Array<MarkdownTokenMeta | null | undefined>;
  scanDelims: (start: number, canSplitWord: boolean) => MarkdownScannedDelims;
  push: (type: string, tag: string, nesting: number) => MarkdownToken;
}

interface MarkdownRenderer {
  render: (text: string) => string;
  inline: {
    ruler: { at: (name: string, fn: (state: MarkdownInlineState, silent: boolean) => boolean) => void };
    ruler2: { at: (name: string, fn: (state: MarkdownInlineState) => void) => void };
  };
}

type MarkdownItFactory = (options: MarkdownItOptions) => MarkdownRenderer;

type MarkdownFileTarget = {
  path: string;
  line: number | null;
  column: number | null;
};

type MarkdownLinkHandlers = {
  openFilePath: ((target: MarkdownFileTarget, anchor: HTMLAnchorElement) => unknown) | null;
  openExternalUrl: ((url: string, anchor: HTMLAnchorElement) => unknown) | null;
};

type MarkdownLinkHandlerInput = Partial<{
  openFilePath: MarkdownLinkHandlers['openFilePath'];
  openExternalUrl: MarkdownLinkHandlers['openExternalUrl'];
}>;

type CopyButtonState = 'idle' | 'copied' | 'failed';

type CopyButton = HTMLButtonElement & {
  _copyResetTimer?: ReturnType<typeof setTimeout> | null;
};

const streamingMarkdown = smd as unknown as StreamingMarkdownRuntime;

const FENCE_LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
};

let markdownLinkHandlers: MarkdownLinkHandlers = {
  openFilePath: null,
  openExternalUrl: null,
};

function parseLineColumnHash(hash: unknown): { line: number; column: number | null } | null {
  const text = typeof hash === 'string' ? hash.trim() : '';
  const match = text.match(/^#L(\d+)(?:C(\d+))?$/i);
  if (!match) return null;
  const line = Number.parseInt(match[1], 10);
  const column = match[2] ? Number.parseInt(match[2], 10) : null;
  if (!Number.isFinite(line) || line < 1) return null;
  return {
    line,
    column: column !== null && Number.isFinite(column) && column >= 1 ? column : null,
  };
}

function parseLineColumnSuffix(pathText: unknown): MarkdownFileTarget | null {
  const text = typeof pathText === 'string' ? pathText.trim() : '';
  const match = text.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (!match) return null;
  const line = Number.parseInt(match[2], 10);
  const column = match[3] ? Number.parseInt(match[3], 10) : null;
  if (!Number.isFinite(line) || line < 1) return null;
  return {
    path: match[1] || '',
    line,
    column: column !== null && Number.isFinite(column) && column >= 1 ? column : null,
  };
}

function normalizeMarkdownHref(rawHref: unknown): string {
  return typeof rawHref === 'string' ? rawHref.trim() : '';
}

function isExternalHttpUrl(rawHref: string): boolean {
  return /^https?:\/\//i.test(rawHref);
}

function isFileUrl(rawHref: string): boolean {
  return /^file:\/\//i.test(rawHref);
}

function decodeFileUrlPath(rawHref: string): string {
  try {
    const url = new URL(rawHref);
    return decodeURIComponent(url.pathname || '');
  } catch {
    return '';
  }
}

function decodePathLikeHref(rawHref: string): string {
  try {
    return decodeURIComponent(rawHref);
  } catch {
    return rawHref;
  }
}

function normalizeParsedFileTarget(
  path: unknown,
  line: number | null = null,
  column: number | null = null,
): MarkdownFileTarget | null {
  const normalizedPath = typeof path === 'string' ? path.trim() : '';
  if (!normalizedPath) return null;
  return {
    path: normalizedPath,
    line: line !== null && Number.isFinite(line) && line >= 1 ? line : null,
    column: column !== null && Number.isFinite(column) && column >= 1 ? column : null,
  };
}

function parseFileTargetFromAnchor(anchor: HTMLAnchorElement, rawHref: string): MarkdownFileTarget | null {
  const decodedHref = decodePathLikeHref(rawHref);
  if (isFileUrl(decodedHref)) {
    const hashParts = parseLineColumnHash(anchor.hash);
    return normalizeParsedFileTarget(
      decodeFileUrlPath(decodedHref),
      hashParts?.line ?? null,
      hashParts?.column ?? null,
    );
  }

  const hashParts = parseLineColumnHash(anchor.hash);
  const basePath = decodePathLikeHref(anchor.pathname || decodedHref.split('#', 1)[0] || '');
  if (hashParts) {
    return normalizeParsedFileTarget(basePath, hashParts.line, hashParts.column);
  }

  const suffixParts = parseLineColumnSuffix(decodedHref);
  if (suffixParts) {
    return normalizeParsedFileTarget(suffixParts.path, suffixParts.line, suffixParts.column);
  }

  return normalizeParsedFileTarget(basePath || decodedHref);
}

function isLikelyFilePath(rawHref: string): boolean {
  if (!rawHref) return false;
  if (rawHref.startsWith('#')) return false;
  if (isExternalHttpUrl(rawHref)) return false;
  if (isFileUrl(rawHref)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) return false;
  return true;
}

function bindMarkdownLinkRouting(container: HTMLElement | null | undefined): void {
  if (!container || container.dataset.markdownLinkRoutingBound === 'true') return;
  container.dataset.markdownLinkRoutingBound = 'true';
  container.addEventListener('click', (evt: MouseEvent) => {
    const target = evt.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || !container.contains(anchor)) return;
    const rawHref = normalizeMarkdownHref(anchor.getAttribute('href'));
    if (!rawHref) return;

    if (isExternalHttpUrl(rawHref) && typeof markdownLinkHandlers.openExternalUrl === 'function') {
      evt.preventDefault();
      evt.stopPropagation();
      markdownLinkHandlers.openExternalUrl(rawHref, anchor);
      return;
    }

    if (isLikelyFilePath(rawHref) && typeof markdownLinkHandlers.openFilePath === 'function') {
      const fileTarget = parseFileTargetFromAnchor(anchor, rawHref);
      if (!fileTarget?.path) return;
      evt.preventDefault();
      evt.stopPropagation();
      markdownLinkHandlers.openFilePath(fileTarget, anchor);
    }
  });
}

function bindInlineCodeCopy(container: HTMLElement | null | undefined): void {
  if (!container || container.dataset.inlineCodeCopyBound === 'true') return;
  container.dataset.inlineCodeCopyBound = 'true';
  container.addEventListener('click', (evt: MouseEvent) => {
    const target = evt.target;
    if (!(target instanceof HTMLElement)) return;
    const code = target.closest('code');
    if (!(code instanceof HTMLElement) || !container.contains(code)) return;
    if (code.closest('pre')) return;
    if (code.closest('a[href]')) return;
    const selection = window.getSelection?.();
    if (selection && String(selection).trim()) return;
    const text = code.textContent || '';
    if (!text.trim()) return;
    evt.preventDefault();
    void copyTextToClipboard(text);
  });
}

export function setMarkdownLinkHandlers(handlers: MarkdownLinkHandlerInput = {}): void {
  markdownLinkHandlers = {
    openFilePath: typeof handlers.openFilePath === 'function' ? handlers.openFilePath : null,
    openExternalUrl: typeof handlers.openExternalUrl === 'function' ? handlers.openExternalUrl : null,
  };
}

export function highlightCode(container: HTMLElement | null | undefined): void {
  if (!container) return;
  container.querySelectorAll('pre code').forEach((block) => {
    if (typeof hljs !== 'undefined') {
      const explicitLanguage = Array.from(block.classList)
        .map((className) => className.replace(/^lang(?:uage)?-/i, ''))
        .map((language) => normalizeFenceLanguage(language))
        .find((language) => language && hljs.getLanguage(language));
      if (explicitLanguage) {
        block.classList.add(`language-${explicitLanguage}`);
      }
      hljs.highlightElement(block);
    }
  });
  attachCodeCopyButtons(container);
}

export function renderMarkdownInto(container: HTMLElement | null | undefined, text: unknown): void {
  if (!container) return;
  const renderer = streamingMarkdown.default_renderer(container);
  const parser = streamingMarkdown.parser(renderer);
  bindMarkdownLinkRouting(container);
  bindInlineCodeCopy(container);
  streamingMarkdown.parser_write(parser, text == null ? '' : String(text));
  streamingMarkdown.parser_end(parser);
}

export function renderMarkdownSourceInto(container: HTMLElement | null | undefined, text: unknown): void {
  if (!container) return;
  container.textContent = '';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'language-markdown';
  code.textContent = text == null ? '' : String(text);
  pre.appendChild(code);
  container.appendChild(pre);
  highlightCode(container);
}

function escapeHtmlText(text: unknown): string {
  const value = document.createElement('div');
  value.textContent = text == null ? '' : String(text);
  return value.innerHTML;
}

function normalizeFenceLanguage(lang: unknown): string {
  const rawLang = typeof lang === 'string' ? lang.trim() : '';
  const requested = rawLang ? rawLang.split(/\s+/, 1)[0].toLowerCase() : '';
  return FENCE_LANGUAGE_ALIASES[requested] || requested;
}

function renderHighlightedFenceHtml(source: unknown, lang: unknown): string {
  const normalizedSource = source == null ? '' : String(source);
  const requestedLang = normalizeFenceLanguage(lang);
  if (typeof hljs === 'undefined') {
    const languageClass = requestedLang ? ` language-${requestedLang}` : '';
    return `<pre><code class="hljs${languageClass}">${escapeHtmlText(normalizedSource)}</code></pre>`;
  }

  try {
    if (requestedLang && hljs.getLanguage(requestedLang)) {
      const highlighted = hljs.highlight(normalizedSource, { language: requestedLang, ignoreIllegals: true });
      const languageClass = highlighted.language ? ` language-${highlighted.language}` : ` language-${requestedLang}`;
      return `<pre><code class="hljs${languageClass}">${highlighted.value}</code></pre>`;
    }

    const auto = hljs.highlightAuto(normalizedSource);
    const languageClass = auto.language ? ` language-${auto.language}` : (requestedLang ? ` language-${requestedLang}` : '');
    return `<pre><code class="hljs${languageClass}">${auto.value}</code></pre>`;
  } catch {
    const languageClass = requestedLang ? ` language-${requestedLang}` : '';
    return `<pre><code class="hljs${languageClass}">${escapeHtmlText(normalizedSource)}</code></pre>`;
  }
}

function fallbackCopyText(text: unknown): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text == null ? '' : String(text);
  textarea.setAttribute('readonly', 'readonly');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy') === true;
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

async function copyTextToClipboard(text: unknown): Promise<boolean> {
  const value = text == null ? '' : String(text);
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
  }
  return fallbackCopyText(value);
}

function setCopyButtonState(button: HTMLButtonElement | null | undefined, state: CopyButtonState): void {
  if (!(button instanceof HTMLButtonElement)) return;
  const copyButton = button as CopyButton;
  if (copyButton._copyResetTimer) {
    clearTimeout(copyButton._copyResetTimer);
    copyButton._copyResetTimer = null;
  }
  copyButton.classList.remove('copied', 'failed');
  if (state === 'copied') {
    copyButton.textContent = 'copied';
    copyButton.classList.add('copied');
  } else if (state === 'failed') {
    copyButton.textContent = 'failed';
    copyButton.classList.add('failed');
  } else {
    copyButton.textContent = 'copy';
  }
  if (state !== 'idle') {
    copyButton.disabled = true;
    copyButton._copyResetTimer = setTimeout(() => {
      copyButton.disabled = false;
      copyButton.classList.remove('copied', 'failed');
      copyButton.textContent = 'copy';
      copyButton._copyResetTimer = null;
    }, 1200);
  }
}

function attachCodeCopyButtons(container: HTMLElement | null | undefined): void {
  if (!container) return;
  container.querySelectorAll('pre > code').forEach((codeBlock) => {
    const pre = codeBlock.parentElement;
    if (!(pre instanceof HTMLElement)) return;
    if (pre.querySelector('.markdown-copy-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-copy-button';
    button.textContent = 'copy';
    button.setAttribute('aria-label', 'Copy code block');
    button.title = 'Copy code block';
    button.addEventListener('click', async (evt: MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      const ok = await copyTextToClipboard(codeBlock.textContent || '');
      setCopyButtonState(button, ok ? 'copied' : 'failed');
    });
    pre.appendChild(button);
  });
}

function emphasisTokenizeAsteriskOnly(state: MarkdownInlineState, silent: boolean): boolean {
  const start = state.pos;
  const marker = state.src.charCodeAt(start);

  if (silent) return false;
  if (marker !== 0x2A) return false;

  const scanned = state.scanDelims(state.pos, true);
  for (let idx = 0; idx < scanned.length; idx += 1) {
    const token = state.push('text', '', 0);
    token.content = '*';
    state.delimiters.push({
      marker,
      length: scanned.length,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    });
  }

  state.pos += scanned.length;
  return true;
}

function postProcessAsteriskOnly(state: MarkdownInlineState, delimiters: MarkdownDelimiter[]): void {
  const max = delimiters.length;
  for (let idx = max - 1; idx >= 0; idx -= 1) {
    const startDelim = delimiters[idx];
    if (startDelim.marker !== 0x2A || startDelim.end === -1) {
      continue;
    }

    const endDelim = delimiters[startDelim.end];
    const afterEndDelim = delimiters[startDelim.end + 1];
    const isStrong = idx > 0
      && delimiters[idx - 1].end === startDelim.end + 1
      && delimiters[idx - 1].marker === startDelim.marker
      && delimiters[idx - 1].token === startDelim.token - 1
      && afterEndDelim?.token === endDelim.token + 1;

    const tokenOpen = state.tokens[startDelim.token];
    tokenOpen.type = isStrong ? 'strong_open' : 'em_open';
    tokenOpen.tag = isStrong ? 'strong' : 'em';
    tokenOpen.nesting = 1;
    tokenOpen.markup = isStrong ? '**' : '*';
    tokenOpen.content = '';

    const tokenClose = state.tokens[endDelim.token];
    tokenClose.type = isStrong ? 'strong_close' : 'em_close';
    tokenClose.tag = isStrong ? 'strong' : 'em';
    tokenClose.nesting = -1;
    tokenClose.markup = isStrong ? '**' : '*';
    tokenClose.content = '';

    if (isStrong) {
      state.tokens[delimiters[idx - 1].token].content = '';
      if (afterEndDelim) {
        state.tokens[afterEndDelim.token].content = '';
      }
      idx -= 1;
    }
  }
}

function emphasisPostProcessAsteriskOnly(state: MarkdownInlineState): void {
  const tokensMeta = state.tokens_meta || [];
  postProcessAsteriskOnly(state, state.delimiters || []);
  for (let idx = 0; idx < tokensMeta.length; idx += 1) {
    if (tokensMeta[idx]?.delimiters) {
      postProcessAsteriskOnly(state, tokensMeta[idx]?.delimiters || []);
    }
  }
}

let cachedEventMarkdownRenderer: MarkdownRenderer | null | undefined;

function getEventMarkdownRenderer(): MarkdownRenderer | null {
  if (cachedEventMarkdownRenderer !== undefined) {
    return cachedEventMarkdownRenderer;
  }

  const MarkdownIt = (globalThis as typeof globalThis & { markdownit?: MarkdownItFactory }).markdownit;
  if (typeof MarkdownIt !== 'function') {
    cachedEventMarkdownRenderer = null;
    return cachedEventMarkdownRenderer;
  }

  const renderer = MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    breaks: true,
    highlight(source: string, lang: string): string {
      return renderHighlightedFenceHtml(source, lang);
    },
  });
  renderer.inline.ruler.at('emphasis', emphasisTokenizeAsteriskOnly);
  renderer.inline.ruler2.at('emphasis', emphasisPostProcessAsteriskOnly);
  cachedEventMarkdownRenderer = renderer;
  return cachedEventMarkdownRenderer;
}

export function renderEventMarkdownInto(container: HTMLElement | null | undefined, text: unknown): void {
  if (!container) return;
  const renderer = getEventMarkdownRenderer();
  if (!renderer) {
    renderMarkdownSourceInto(container, text);
    return;
  }
  container.innerHTML = renderer.render(text == null ? '' : String(text));
  bindMarkdownLinkRouting(container);
  bindInlineCodeCopy(container);
  attachCodeCopyButtons(container);
}

export function renderMarkdownBlock(text: unknown, extraClass = ''): HTMLDivElement {
  const container = document.createElement('div');
  container.className = extraClass ? `markdown-body ${extraClass}` : 'markdown-body';
  renderMarkdownInto(container, text);
  highlightCode(container);
  return container;
}

export function renderMarkdownItBlock(text: unknown, extraClass = ''): HTMLDivElement {
  const container = document.createElement('div');
  container.className = extraClass ? `markdown-body ${extraClass}` : 'markdown-body';
  renderEventMarkdownInto(container, text);
  return container;
}

export function createStreamingParser(container: HTMLElement): unknown {
  const renderer = streamingMarkdown.default_renderer(container);
  bindMarkdownLinkRouting(container);
  return streamingMarkdown.parser(renderer);
}

export function streamWrite(parser: unknown, text: unknown): void {
  streamingMarkdown.parser_write(parser, text == null ? '' : String(text));
}

export function streamEnd(parser: unknown): void {
  streamingMarkdown.parser_end(parser);
}
