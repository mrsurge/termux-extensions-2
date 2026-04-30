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

export function toMonacoHoverContents(raw: unknown): Array<{ value: string }> {
  const out: Array<{ value: string }> = [];
  if (!Array.isArray(raw)) return out;
  for (const content of raw) {
    if (typeof content === 'string') {
      out.push({ value: content });
    } else if (content && typeof content === 'object') {
      const hoverContent = content as HoverContentObjectLike;
      if (typeof hoverContent.value === 'string') {
        out.push({ value: hoverContent.value });
      } else if (typeof hoverContent.language === 'string' && typeof hoverContent.value === 'string') {
        out.push({ value: `\`\`\`${hoverContent.language}\n${hoverContent.value}\n\`\`\`` });
      }
    }
  }
  return out;
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
