interface HighlightJsRuntime {
  getLanguage?: (language: string) => boolean;
  highlight: (text: string, options: { language: string; ignoreIllegals: boolean }) => { value: string };
  highlightElement: (element: Element) => void;
}

declare const hljs: HighlightJsRuntime | undefined;

interface TreeSitterNode {
  startIndex: number;
  endIndex: number;
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

interface TreeSitterLanguage {}

interface TreeSitterParserInstance {
  setLanguage: (language: TreeSitterLanguage) => void;
  parse: (text: string) => TreeSitterTree;
}

interface TreeSitterParserStatic {
  new (): TreeSitterParserInstance;
  init: (options: { locateFile: (file: string) => string }) => Promise<void>;
}

interface TreeSitterLanguageStatic {
  load: (path: string) => Promise<TreeSitterLanguage>;
}

interface TreeSitterQueryInstance {
  captures: (node: TreeSitterNode) => TreeSitterCapture[];
}

interface TreeSitterQueryStatic {
  new (language: TreeSitterLanguage, source: string): TreeSitterQueryInstance;
}

interface TreeSitterCapture {
  name?: string;
  capture?: string;
  node?: TreeSitterNode;
  0?: string;
  1?: TreeSitterNode;
}

  interface TreeSitterModule {
  Parser?: TreeSitterParserStatic;
  Language?: TreeSitterLanguageStatic;
  Query?: TreeSitterQueryStatic;
}

type QuotedSegment =
  | { type: 'text'; text: string }
  | { type: 'quote'; quote: string; text: string };

type ParsedStructuredScript = {
  wrapperPrefix: string;
  prefix: string;
  body: string;
  terminator: string;
  tail: string;
  language: string;
};

type HighlightSpan = {
  start: number;
  end: number;
  cls: string;
  len: number;
};

  type ShellSemanticContext = {
  getEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  getQuoteParsingEnabled: () => boolean;
  setQuoteParsingEnabled: (enabled: boolean) => void;
  getCheckboxEl?: () => HTMLInputElement | null;
    escapeHtml: (text: string) => string;
  };

  type ShellRibbonRenderOptions = {
    promptPrefix?: string;
  };

const SCRIPT_LANGUAGE_BY_INTERPRETER: Record<string, string> = {
  python: 'python',
  python3: 'python',
  node: 'javascript',
};

export function bindShellSemantic(ctx: ShellSemanticContext) {
  const {
    getEnabled,
    setEnabled,
    getQuoteParsingEnabled,
    setQuoteParsingEnabled,
    getCheckboxEl,
    escapeHtml,
  } = ctx;

  let tsRibbonReady = false;
  let tsRibbonInitPromise: Promise<boolean> | null = null;
  let tsRibbonParser: TreeSitterParserInstance | null = null;
  let tsRibbonLang: TreeSitterLanguage | null = null;
  let tsRibbonQuery: TreeSitterQueryInstance | null = null;
  const tsRibbonCache = new Map<string, string>();
  const TS_RIBBON_CACHE_MAX = 500;

  function isSemanticShellRibbonEnabled(): boolean {
    return getEnabled() === true;
  }

  function setSemanticShellRibbonEnabled(enabled: unknown): void {
    const next = enabled === true;
    setEnabled(next);
    const el = getCheckboxEl?.();
    if (el) el.checked = next;
  }

  function isSemanticShellQuoteParsingEnabled(): boolean {
    return getQuoteParsingEnabled() === true;
  }

  function setSemanticShellQuoteParsingEnabled(enabled: unknown): void {
    setQuoteParsingEnabled(enabled === true);
  }

  function normalizeCaptureName(name: unknown): string {
    const raw = String(name || '').replace(/^@/, '');
    return raw.replace(/[^\w.-]+/g, '-').replace(/\./g, '-');
  }

  function maybeCachePut(key: string, value: string): void {
    if (!key) return;
    if (tsRibbonCache.has(key)) tsRibbonCache.delete(key);
    tsRibbonCache.set(key, value);
    while (tsRibbonCache.size > TS_RIBBON_CACHE_MAX) {
      const first = tsRibbonCache.keys().next().value;
      if (typeof first !== 'string') break;
      tsRibbonCache.delete(first);
    }
  }

  function utf8Len(cp: number): number {
    if (cp <= 0x7F) return 1;
    if (cp <= 0x7FF) return 2;
    if (cp <= 0xFFFF) return 3;
    return 4;
  }

  function buildJsIndexToUtf8ByteOffsets(text: unknown): number[] {
    const s = String(text || '');
    const offsets: number[] = new Array(s.length + 1);
    let byte = 0;
    for (let i = 0; i < s.length; ) {
      offsets[i] = byte;
      const cp = s.codePointAt(i) ?? 0;
      byte += utf8Len(cp);
      i += cp > 0xFFFF ? 2 : 1;
    }
    offsets[s.length] = byte;
    for (let i = 1; i < offsets.length; i += 1) {
      if (offsets[i] == null) offsets[i] = offsets[i - 1];
    }
    return offsets;
  }

  function utf8ByteToJsIndex(offsets: number[], byteIndex: unknown): number {
    const arr = offsets;
    let lo = 0;
    let hi = arr.length - 1;
    const target = Math.max(0, Math.min(Number(byteIndex) || 0, arr[hi] || 0));
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (arr[mid] <= target) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  async function ensureTreeSitterRibbonReady(): Promise<boolean> {
    if (!isSemanticShellRibbonEnabled()) return false;
    if (tsRibbonReady) return true;
    if (tsRibbonInitPromise) return tsRibbonInitPromise;
    tsRibbonInitPromise = (async () => {
      const loadTreeSitterModule = new Function("return import('/static/vendor/web-tree-sitter/web-tree-sitter.js')") as () => Promise<TreeSitterModule>;
      const mod = await loadTreeSitterModule();
      const Parser = mod?.Parser;
      const Language = mod?.Language;
      const Query = mod?.Query;
      if (!Parser || !Language || !Query) {
        throw new Error('web-tree-sitter module did not export Parser/Language/Query');
      }
      await Parser.init({
        locateFile: (file: string) => `/static/vendor/web-tree-sitter/${file}`,
      });
      tsRibbonLang = await Language.load('/static/vendor/tree-sitter-bash/tree-sitter-bash.wasm');
      tsRibbonParser = new Parser();
      tsRibbonParser.setLanguage(tsRibbonLang);
      const response = await fetch('/static/vendor/tree-sitter-bash/highlights.scm', { cache: 'no-store' });
      if (!response.ok) throw new Error('failed to load highlights.scm');
      const scm = await response.text();
      tsRibbonQuery = new Query(tsRibbonLang, scm);
      tsRibbonReady = true;
      return true;
    })().catch((err) => {
      console.warn('Tree-sitter ribbon init failed:', err);
      tsRibbonReady = false;
      tsRibbonInitPromise = null;
      return false;
    });
    return tsRibbonInitPromise;
  }

  function splitQuotedSegments(text: unknown): QuotedSegment[] {
    const s = String(text || '');
    const segs: QuotedSegment[] = [];
    let buf = '';
    let i = 0;

    function pushText(): void {
      if (buf) {
        segs.push({ type: 'text', text: buf });
        buf = '';
      }
    }

    while (i < s.length) {
      const ch = s[i];
      if (ch !== '\'' && ch !== '"' && ch !== '`') {
        buf += ch;
        i += 1;
        continue;
      }

      const quote = ch;
      pushText();
      i += 1;
      let inner = '';

      while (i < s.length) {
        const c = s[i];
        if (quote === '\'') {
          if (c === '\'') break;
          inner += c;
          i += 1;
          continue;
        }
        if (c === '\\' && i + 1 < s.length) {
          inner += c + s[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) break;
        inner += c;
        i += 1;
      }

      if (i >= s.length || s[i] !== quote) {
        buf += quote + inner;
        break;
      }

      i += 1;
      segs.push({ type: 'quote', quote, text: inner });
    }

    pushText();
    return segs;
  }

  function treeSitterHighlightHtml(text: unknown): string {
    const input = String(text || '');
    if (!tsRibbonReady || !tsRibbonParser || !tsRibbonQuery) {
      return escapeHtml(input);
    }
    if (!input.trim()) return escapeHtml(input);
    const cached = tsRibbonCache.get(input);
    if (cached) return cached;

    let tree: TreeSitterTree;
    try {
      tree = tsRibbonParser.parse(input);
    } catch {
      const escaped = escapeHtml(input);
      maybeCachePut(input, escaped);
      return escaped;
    }

    let captures: TreeSitterCapture[] = [];
    try {
      captures = tsRibbonQuery.captures(tree.rootNode) || [];
    } catch {
      captures = [];
    }

    const offsets = buildJsIndexToUtf8ByteOffsets(input);
    const spans: HighlightSpan[] = [];
    for (const cap of captures) {
      const name = typeof cap.name === 'string'
        ? cap.name
        : (typeof cap.capture === 'string' ? cap.capture : (typeof cap[0] === 'string' ? cap[0] : ''));
      const node = cap.node || cap[1] || null;
      const startB = node?.startIndex;
      const endB = node?.endIndex;
      if (startB == null || endB == null) continue;
      const start = utf8ByteToJsIndex(offsets, startB);
      const end = utf8ByteToJsIndex(offsets, endB);
      if (end <= start) continue;
      spans.push({
        start,
        end,
        cls: `ts-${normalizeCaptureName(name)}`,
        len: end - start,
      });
    }

    spans.sort((a, b) => (a.start - b.start) || (b.len - a.len));
    const picked: HighlightSpan[] = [];
    let lastEnd = 0;
    for (const span of spans) {
      if (span.start < lastEnd) continue;
      picked.push(span);
      lastEnd = span.end;
    }

    let out = '';
    let idx = 0;
    for (const span of picked) {
      if (span.start > idx) out += escapeHtml(input.slice(idx, span.start));
      out += `<span class="${span.cls}">${escapeHtml(input.slice(span.start, span.end))}</span>`;
      idx = span.end;
    }
    if (idx < input.length) out += escapeHtml(input.slice(idx));
    maybeCachePut(input, out);
    return out;
  }

  function stripOuterMatchingQuotes(text: unknown): string {
    const value = String(text || '').trim();
    if (value.length < 2) return value;
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === '\'' || first === '`') && last === first) {
      return value.slice(1, -1);
    }
    return value;
  }

  function unwrapShellWrappedCommand(command: unknown): { wrapperPrefix: string; innerCommand: string } {
    const normalized = String(command || '').replace(/\r\n?/g, '\n').trim();
    const match = normalized.match(/^\s*((?:\/bin\/)?(?:sh|bash)\s+-(?:c|lc))\s+([\s\S]+)$/);
    if (!match) {
      return { wrapperPrefix: '', innerCommand: normalized };
    }
    return {
      wrapperPrefix: String(match[1] || '').trim(),
      innerCommand: stripOuterMatchingQuotes(match[2]),
    };
  }

  function tokenizeShellWords(text: unknown): string[] | null {
    const input = String(text || '');
    const tokens: string[] = [];
    let buf = '';
    let quote = '';
    let idx = 0;

    function pushToken(): void {
      if (!buf) return;
      tokens.push(buf);
      buf = '';
    }

    while (idx < input.length) {
      const ch = input[idx];
      if (!quote) {
        if (/\s/.test(ch)) {
          pushToken();
          idx += 1;
          continue;
        }
        if (ch === '\'' || ch === '"' || ch === '`') {
          quote = ch;
          idx += 1;
          continue;
        }
        if (ch === '\\' && idx + 1 < input.length) {
          buf += input[idx + 1];
          idx += 2;
          continue;
        }
        buf += ch;
        idx += 1;
        continue;
      }
      if (quote === '\'') {
        if (ch === '\'') {
          quote = '';
          idx += 1;
          continue;
        }
        buf += ch;
        idx += 1;
        continue;
      }
      if (ch === '\\' && idx + 1 < input.length) {
        buf += input[idx + 1];
        idx += 2;
        continue;
      }
      if (ch === quote) {
        quote = '';
        idx += 1;
        continue;
      }
      buf += ch;
      idx += 1;
    }

    if (quote) return null;
    pushToken();
    return tokens;
  }

  function parseInterpreterHeredocCommand(command: unknown): ParsedStructuredScript | null {
    const { wrapperPrefix, innerCommand } = unwrapShellWrappedCommand(command);
    if (!innerCommand.includes('\n')) return null;
    const lines = innerCommand.split('\n');
    if (lines.length < 3) return null;
    const firstLine = lines[0];
    const tokens = tokenizeShellWords(firstLine);
    if (!Array.isArray(tokens) || tokens.length < 3) return null;
    const interpreter = String(tokens[0] || '').trim();
    const language = SCRIPT_LANGUAGE_BY_INTERPRETER[interpreter] || '';
    if (!language) return null;
    if (tokens[tokens.length - 2] !== '-') return null;
    const heredocToken = String(tokens[tokens.length - 1] || '');
    if (!heredocToken.startsWith('<<')) return null;
    const terminator = heredocToken.slice(2);
    if (!terminator) return null;
    let endIndex = -1;
    for (let idx = 1; idx < lines.length; idx += 1) {
      if (lines[idx] === terminator) {
        endIndex = idx;
        break;
      }
    }
    if (endIndex <= 0) return null;
    const trailingLines = lines.slice(endIndex + 1);
    return {
      wrapperPrefix,
      prefix: firstLine,
      body: lines.slice(1, endIndex).join('\n'),
      terminator,
      tail: trailingLines.join('\n'),
      language,
    };
  }

  function parseInterpreterInlineCommand(command: unknown): ParsedStructuredScript | null {
    const { wrapperPrefix, innerCommand } = unwrapShellWrappedCommand(command);
    const tokens = tokenizeShellWords(innerCommand);
    if (!Array.isArray(tokens) || tokens.length < 3) return null;
    const interpreter = String(tokens[0] || '').trim();
    const language = SCRIPT_LANGUAGE_BY_INTERPRETER[interpreter] || '';
    if (!language) return null;
    let flagIndex = -1;
    for (let idx = 1; idx < tokens.length - 1; idx += 1) {
      const token = String(tokens[idx] || '').trim();
      if ((interpreter === 'python' || interpreter === 'python3') && token === '-c') {
        flagIndex = idx;
        break;
      }
      if (interpreter === 'node' && (token === '-e' || token === '--eval')) {
        flagIndex = idx;
        break;
      }
    }
    if (flagIndex === -1) return null;
    const body = stripOuterMatchingQuotes(tokens.slice(flagIndex + 1).join(' '));
    if (!body) return null;
    return {
      wrapperPrefix,
      prefix: tokens.slice(0, flagIndex + 1).join(' '),
      body,
      terminator: '',
      tail: '',
      language,
    };
  }

  function highlightStructuredScriptBodyHtml(body: unknown, language: string): string {
    const text = String(body || '');
    if (!text) return '';
    if (typeof hljs === 'undefined' || !hljs.getLanguage?.(language)) {
      return escapeHtml(text);
    }
    try {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(text);
    }
  }

  function renderStructuredScriptCommandHtml(command: unknown): string | null {
    const parsed = parseInterpreterHeredocCommand(command) || parseInterpreterInlineCommand(command);
    if (!parsed) return null;
    const parts: string[] = [];
    if (parsed.wrapperPrefix) parts.push(treeSitterHighlightHtml(parsed.wrapperPrefix));
    parts.push(treeSitterHighlightHtml(parsed.prefix));
    parts.push(highlightStructuredScriptBodyHtml(parsed.body, parsed.language));
    if (parsed.terminator) parts.push(treeSitterHighlightHtml(parsed.terminator));
    if (parsed.tail) parts.push(treeSitterHighlightHtml(parsed.tail));
    return parts.join('\n');
  }

  function renderShellCmdRibbon(
    el: HTMLElement | null | undefined,
    cmd: unknown,
    options: ShellRibbonRenderOptions = {},
  ): void {
    if (!el) return;
    const command = String(cmd || '');
    const promptPrefix = typeof options.promptPrefix === 'string' ? options.promptPrefix : '$ ';

    const savedTwisty = el.querySelector('.twisty');
    const savedToggle = el.querySelector('.ribbon-toggle-zone');

    if (isSemanticShellRibbonEnabled()) {
      if (!tsRibbonReady && !tsRibbonInitPromise) {
        void ensureTreeSitterRibbonReady();
      }
      if (tsRibbonReady) {
        try {
          const structuredHtml = renderStructuredScriptCommandHtml(command);
          let html = typeof structuredHtml === 'string' ? structuredHtml : '';
          if (!html && isSemanticShellQuoteParsingEnabled()) {
            const segs = splitQuotedSegments(command);
            for (const seg of segs) {
              if (seg.type === 'text') {
                html += treeSitterHighlightHtml(seg.text);
              } else {
                const q = escapeHtml(seg.quote);
                html += `<span class="ts-quote">${q}</span>`;
                html += `<span class="ts-quoted-inner">${treeSitterHighlightHtml(seg.text)}</span>`;
                html += `<span class="ts-quote">${q}</span>`;
              }
            }
          } else if (!html) {
            html = treeSitterHighlightHtml(command);
          }
          el.innerHTML = promptPrefix
            ? `<span class="shell-prompt">${escapeHtml(promptPrefix)}</span><code class="tsribbon">${html}</code>`
            : `<code class="tsribbon">${html}</code>`;
          if (savedTwisty) el.appendChild(savedTwisty);
          if (savedToggle) el.appendChild(savedToggle);
          return;
        } catch {
          // Fall through to hljs rendering.
        }
      }
    }

    if (typeof hljs === 'undefined' || !command.trim()) {
      el.textContent = `${promptPrefix}${command}`;
      if (savedTwisty) el.appendChild(savedTwisty);
      if (savedToggle) el.appendChild(savedToggle);
      return;
    }

    try {
      el.innerHTML = '';
      const codeEl = document.createElement('code');
      codeEl.className = 'language-bash';
      codeEl.textContent = command;
      if (promptPrefix) {
        const prefix = document.createElement('span');
        prefix.className = 'shell-prompt';
        prefix.textContent = promptPrefix;
        el.append(prefix, codeEl);
      } else {
        el.append(codeEl);
      }
      hljs.highlightElement(codeEl);
    } catch {
      el.textContent = `${promptPrefix}${command}`;
    }

    if (savedTwisty) el.appendChild(savedTwisty);
    if (savedToggle) el.appendChild(savedToggle);
  }

  return {
    isSemanticShellRibbonEnabled,
    setSemanticShellRibbonEnabled,
    isSemanticShellQuoteParsingEnabled,
    setSemanticShellQuoteParsingEnabled,
    ensureTreeSitterRibbonReady,
    renderShellCmdRibbon,
  };
}
