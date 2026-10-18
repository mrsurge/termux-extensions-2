export type AnsiState = {
  fg: number | null;
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
};

const ANSI_FG_MAP: Record<number, string> = {
  30: '#000000',
  31: '#e06c75',
  32: '#98c379',
  33: '#e5c07b',
  34: '#61afef',
  35: '#c678dd',
  36: '#56b6c2',
  37: '#abb2bf',
  90: '#5c6370',
  91: '#ff7a85',
  92: '#b7f39b',
  93: '#ffd68a',
  94: '#7ab7ff',
  95: '#e79aff',
  96: '#7ae8f5',
  97: '#ffffff',
};

const ANSI_BG_MAP: Record<number, string> = {
  40: '#000000',
  41: '#e06c75',
  42: '#98c379',
  43: '#e5c07b',
  44: '#61afef',
  45: '#c678dd',
  46: '#56b6c2',
  47: '#abb2bf',
  100: '#5c6370',
  101: '#ff7a85',
  102: '#b7f39b',
  103: '#ffd68a',
  104: '#7ab7ff',
  105: '#e79aff',
  106: '#7ae8f5',
  107: '#ffffff',
};

const ANSI_SGR_RE = /\x1b\[([0-9;]*)m/g;

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch
  ));
}

export function hasAnsiSgr(value: unknown): boolean {
  return /\x1b\[[0-9;]*m/.test(String(value ?? ''));
}

export function createAnsiState(): AnsiState {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
}

export function ansiToHtml(value: unknown, initialState?: AnsiState): string {
  const input = String(value ?? '');
  let lastIndex = 0;
  let html = '';
  const state: AnsiState = initialState ?? {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
  };

  function cssFor(st: AnsiState): string {
    const styles: string[] = [];
    if (st.bold) styles.push('font-weight:600');
    if (st.dim) styles.push('opacity:0.8');
    if (st.italic) styles.push('font-style:italic');
    if (st.underline) styles.push('text-decoration:underline');
    let fg = st.fg;
    let bg = st.bg;
    if (st.inverse) {
      const tmp = fg;
      fg = bg;
      bg = tmp;
    }
    if (fg !== null && ANSI_FG_MAP[fg]) styles.push(`color:${ANSI_FG_MAP[fg]}`);
    if (bg !== null && ANSI_BG_MAP[bg]) styles.push(`background-color:${ANSI_BG_MAP[bg]}`);
    return styles.join(';');
  }

  function applyCodes(codes: string): void {
    const parts = codes.length ? codes.split(';') : ['0'];
    for (const part of parts) {
      const n = Number(part || '0');
      if (!Number.isFinite(n)) continue;
      if (n === 0) {
        Object.assign(state, createAnsiState());
      } else if (n === 1) state.bold = true;
      else if (n === 2) state.dim = true;
      else if (n === 3) state.italic = true;
      else if (n === 4) state.underline = true;
      else if (n === 7) state.inverse = true;
      else if (n === 22) {
        state.bold = false;
        state.dim = false;
      } else if (n === 23) state.italic = false;
      else if (n === 24) state.underline = false;
      else if (n === 27) state.inverse = false;
      else if (n === 39) state.fg = null;
      else if (n === 49) state.bg = null;
      else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) state.fg = n;
      else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) state.bg = n;
    }
  }

  function emitChunk(chunk: string): void {
    if (!chunk) return;
    const css = cssFor(state);
    const escaped = escapeHtml(chunk);
    html += css ? `<span style="${css}">${escaped}</span>` : escaped;
  }

  let match: RegExpExecArray | null;
  ANSI_SGR_RE.lastIndex = 0;
  while ((match = ANSI_SGR_RE.exec(input)) !== null) {
    emitChunk(input.slice(lastIndex, match.index));
    applyCodes(match[1] || '');
    lastIndex = ANSI_SGR_RE.lastIndex;
  }
  emitChunk(input.slice(lastIndex));
  return html;
}
