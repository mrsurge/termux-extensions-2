interface MonacoRangeCtorLike {
  new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): unknown;
}

interface MonacoBridgeLike {
  Range?: MonacoRangeCtorLike;
  languages?: {
    CompletionItemKind?: unknown;
  };
}

interface MonacoPositionLike {
  lineNumber: number;
  column: number;
}

interface ProtoRangeLike {
  startLineNumber?: unknown;
  startColumn?: unknown;
  endLineNumber?: unknown;
  endColumn?: unknown;
}

interface CompletionEditRangeLike {
  insert?: ProtoRangeLike;
  replace?: ProtoRangeLike;
}

interface HoverContentObjectLike {
  value?: unknown;
  language?: unknown;
  isTrusted?: unknown;
  supportThemeIcons?: unknown;
  supportHtml?: unknown;
  supportAlertSyntax?: unknown;
  baseUri?: unknown;
  uris?: unknown;
}

interface MonacoUriComponentsLike {
  scheme: string;
  authority?: string;
  path?: string;
  query?: string;
  fragment?: string;
}

interface MonacoMarkdownTrustedOptionsLike {
  enabledCommands: string[];
}

export interface MonacoHoverContentLike {
  value: string;
  isTrusted?: boolean | MonacoMarkdownTrustedOptionsLike;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;
  supportAlertSyntax?: boolean;
  baseUri?: MonacoUriComponentsLike;
  uris?: Record<string, MonacoUriComponentsLike>;
}

export interface MonacoHoverProjectionLike {
  contents: MonacoHoverContentLike[];
  codeLanguages: string[];
}

interface LanguageContextLike {
  uri?: unknown;
  version?: unknown;
}

export function monacoRangeFromProtoRange(
  monacoObj: MonacoBridgeLike | null | undefined,
  range: unknown,
): unknown {
  try {
    if (!range || !monacoObj?.Range || typeof range !== 'object') return null;
    const protoRange = range as ProtoRangeLike;
    const startLine = Math.max(1, Number(protoRange.startLineNumber || 1));
    const startColumn = Math.max(1, Number(protoRange.startColumn || 1));
    const endLine = Math.max(1, Number(protoRange.endLineNumber || startLine));
    const endColumn = Math.max(1, Number(protoRange.endColumn || startColumn));
    return new monacoObj.Range(startLine, startColumn, endLine, endColumn);
  } catch (_) {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeUriComponents(value: unknown): MonacoUriComponentsLike | undefined {
  if (!isRecord(value) || typeof value.scheme !== 'string') return undefined;
  const out: MonacoUriComponentsLike = { scheme: value.scheme };
  for (const key of ['authority', 'path', 'query', 'fragment'] as const) {
    const part = value[key];
    if (typeof part === 'string') out[key] = part;
  }
  return out;
}

function normalizeTrusted(value: unknown): boolean | MonacoMarkdownTrustedOptionsLike | undefined {
  if (typeof value === 'boolean') return value;
  if (!isRecord(value) || !Array.isArray(value.enabledCommands)) return undefined;
  if (!value.enabledCommands.every((command) => typeof command === 'string')) return undefined;
  return { enabledCommands: value.enabledCommands.slice() };
}

function normalizeMarkdownHoverContent(content: HoverContentObjectLike): MonacoHoverContentLike | null {
  if (typeof content.value !== 'string') return null;
  const out: MonacoHoverContentLike = { value: content.value };

  const isTrusted = normalizeTrusted(content.isTrusted);
  if (isTrusted !== undefined) out.isTrusted = isTrusted;

  for (const key of ['supportThemeIcons', 'supportHtml', 'supportAlertSyntax'] as const) {
    const flag = content[key];
    if (typeof flag === 'boolean') out[key] = flag;
  }

  const baseUri = normalizeUriComponents(content.baseUri);
  if (baseUri) out.baseUri = baseUri;

  if (isRecord(content.uris)) {
    const uris: Record<string, MonacoUriComponentsLike> = {};
    for (const [href, value] of Object.entries(content.uris)) {
      const uri = normalizeUriComponents(value);
      if (uri) uris[href] = uri;
    }
    out.uris = uris;
  }

  return out;
}

function fencedCodeLanguages(value: string): string[] {
  const out: string[] = [];
  const opener = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([^\s`~]+)[^\r\n]*$/gm;
  for (const match of value.matchAll(opener)) {
    const language = String(match[1] || '').trim();
    if (language) out.push(language);
  }
  return out;
}

export function projectMonacoHoverContents(raw: unknown): MonacoHoverProjectionLike {
  const out: MonacoHoverContentLike[] = [];
  const codeLanguages: string[] = [];
  const seenCodeLanguages = new Set<string>();
  if (!Array.isArray(raw)) return { contents: out, codeLanguages };
  for (const content of raw) {
    let normalized: MonacoHoverContentLike | null = null;
    if (typeof content === 'string') {
      normalized = { value: content };
    } else if (isRecord(content)) {
      const hoverContent = content as HoverContentObjectLike;
      if (Object.prototype.hasOwnProperty.call(hoverContent, 'language')) {
        if (typeof hoverContent.language === 'string' && typeof hoverContent.value === 'string') {
          normalized = { value: `\`\`\`${hoverContent.language}\n${hoverContent.value}\n\`\`\`\n` };
        }
      } else {
        normalized = normalizeMarkdownHoverContent(hoverContent);
      }
    }
    if (!normalized) continue;
    out.push(normalized);
    for (const language of fencedCodeLanguages(normalized.value)) {
      const key = language.toLowerCase();
      if (seenCodeLanguages.has(key)) continue;
      seenCodeLanguages.add(key);
      codeLanguages.push(language);
    }
  }
  return { contents: out, codeLanguages };
}

export function toMonacoHoverContents(raw: unknown): MonacoHoverContentLike[] {
  return projectMonacoHoverContents(raw).contents;
}

export function isLanguageContextCurrent(
  ctx: LanguageContextLike | null | undefined,
  nowCtx: LanguageContextLike | null | undefined,
): boolean {
  try {
    if (!ctx || !nowCtx) return false;
    return String(nowCtx.uri) === String(ctx.uri) && Number(nowCtx.version || 0) === Number(ctx.version || -1);
  } catch (_) {
    return false;
  }
}

export function monacoRangeFromCompletionRange(
  monacoObj: MonacoBridgeLike | null | undefined,
  range: (ProtoRangeLike & CompletionEditRangeLike) | null | undefined,
  pos: MonacoPositionLike,
): unknown {
  if (!range || !monacoObj?.Range) return undefined;
  if (range.insert || range.replace) {
    return {
      insert:
        monacoRangeFromProtoRange(monacoObj, range.insert) ||
        new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      replace:
        monacoRangeFromProtoRange(monacoObj, range.replace) ||
        new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
    };
  }
  return monacoRangeFromProtoRange(monacoObj, range) || new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
}

export function mapCompletionItemKind(
  monacoObj: MonacoBridgeLike | null | undefined,
  kind: number | null | undefined,
): number {
  if (!monacoObj?.languages?.CompletionItemKind) return kind || 0;
  return kind || 0;
}
