import { toMonacoColorHex } from './editor_parse_utils.ts';

export interface SemanticTokenStyle {
  foreground?: string;
  fontStyle?: string;
  bold?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  italic?: boolean;
}

export type SemanticTokenColor = string | SemanticTokenStyle;

export function parseSemanticTokenColors(value: unknown): Record<string, SemanticTokenColor> {
  const result: Record<string, SemanticTokenColor> = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [selector, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      const foreground = toMonacoColorHex(raw);
      if (foreground && (foreground.length === 6 || foreground.length === 8)) result[selector] = `#${foreground}`;
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const settings = raw as Record<string, unknown>;
    const style: SemanticTokenStyle = {};
    const foreground = typeof settings.foreground === 'string' ? toMonacoColorHex(settings.foreground) : null;
    if (foreground && (foreground.length === 6 || foreground.length === 8)) style.foreground = `#${foreground}`;
    if (typeof settings.fontStyle === 'string') style.fontStyle = settings.fontStyle;
    for (const key of ['bold', 'underline', 'strikethrough', 'italic'] as const) {
      if (typeof settings[key] === 'boolean') style[key] = settings[key];
    }
    if (Object.keys(style).length) result[selector] = style;
  }
  return result;
}

export function semanticTokenForegrounds(value: unknown): string[] {
  const colors = parseSemanticTokenColors(value);
  const foregrounds = new Set<string>();
  for (const style of Object.values(colors)) {
    const foreground = typeof style === 'string' ? style : style.foreground;
    if (foreground) foregrounds.add(foreground);
  }
  return [...foregrounds];
}
