/** View-only consumers of the primary editor's authoritative TextMate runtime. */
export interface SnippetSyntaxToken {
  start: number;
  end: number;
  color?: string;
  fontStyle: number;
}
export interface SnippetSyntaxRequest {
  text: string;
  filePath?: string | null;
  language?: string;
}
export type SnippetSyntaxProvider = (request: SnippetSyntaxRequest) => Promise<SnippetSyntaxToken[] | null>;

interface Paint {
  target: WeakRef<HTMLElement>;
  request: SnippetSyntaxRequest;
  version: number;
  bytes: number;
}
let provider: SnippetSyntaxProvider | null = null;
let epoch = 0;
let running = 0;
const paints = new Set<Paint>();
const currentPaint = new WeakMap<HTMLElement, Paint>();
const queue = new Set<Paint>();
const MAX_RECORDS = 2048;
let trackedBytes = 0;
const MAX_TRACKED_BYTES = 8 * 1024 * 1024;

function forget(paint: Paint): void {
  if (paints.delete(paint)) trackedBytes -= paint.bytes;
  queue.delete(paint);
}

function unwrapSyntax(target: HTMLElement): void {
  for (const span of target.querySelectorAll('.te-textmate-token')) {
    span.replaceWith(...span.childNodes);
  }
  target.normalize();
}

/** Preserve existing match/diff DOM ownership while decorating its text nodes. */
export function applySnippetSyntax(target: HTMLElement, tokens: readonly SnippetSyntaxToken[]): void {
  unwrapSyntax(target);
  const doc = target.ownerDocument;
  const walker = doc.createTreeWalker(target, 4 /* SHOW_TEXT */);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = 0;
  let tokenIndex = 0;
  for (const node of nodes) {
    const text = node.data;
    const end = offset + text.length;
    const fragment = doc.createDocumentFragment();
    let cursor = offset;
    while (tokenIndex < tokens.length && tokens[tokenIndex].end <= offset) tokenIndex++;
    for (let index = tokenIndex; index < tokens.length && tokens[index].start < end; index++) {
      const token = tokens[index];
      const start = Math.max(cursor, token.start);
      const stop = Math.min(end, token.end);
      if (stop <= start) continue;
      if (start > cursor) fragment.append(text.slice(cursor - offset, start - offset));
      const span = doc.createElement('span');
      span.className = 'te-textmate-token';
      span.textContent = text.slice(start - offset, stop - offset);
      // Only palette colors are admitted; never insert grammar-produced HTML/CSS.
      if (token.color && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(token.color)) span.style.color = token.color;
      if (token.fontStyle & 1) span.style.fontStyle = 'italic';
      if (token.fontStyle & 2) span.style.fontWeight = 'bold';
      const decorations = [];
      if (token.fontStyle & 4) decorations.push('underline');
      if (token.fontStyle & 8) decorations.push('line-through');
      if (decorations.length) span.style.textDecoration = decorations.join(' ');
      fragment.append(span);
      cursor = stop;
    }
    if (cursor < end) fragment.append(text.slice(cursor - offset));
    node.replaceWith(fragment);
    offset = end;
  }
}

function pump(): void {
  if (!provider) return;
  while (running < 4 && queue.size) {
    const paint = queue.values().next().value as Paint;
    queue.delete(paint);
    const target = paint.target.deref();
    if (!target || !target.isConnected || currentPaint.get(target) !== paint) {
      forget(paint);
      continue;
    }
    const selectedProvider = provider;
    const selectedEpoch = epoch;
    const version = paint.version;
    running++;
    void Promise.resolve().then(() => selectedProvider(paint.request)).then(tokens => {
      const live = paint.target.deref();
      if (!live?.isConnected || currentPaint.get(live) !== paint || version !== paint.version || selectedEpoch !== epoch) return;
      if (live.textContent !== paint.request.text) return;
      if (tokens) applySnippetSyntax(live, tokens);
    }).catch(() => { /* Missing/failed grammar stays readable; never another transport. */ }).finally(() => {
      running--;
      pump();
    });
  }
}

export function refreshSnippetSyntax(): void {
  epoch++;
  for (const paint of paints) {
    const target = paint.target.deref();
    if (!target?.isConnected || currentPaint.get(target) !== paint) {
      forget(paint);
      continue;
    }
    // Clear obsolete palette spans, retaining the user's hit/diff wrappers.
    unwrapSyntax(target);
    paint.version++;
    queue.add(paint);
  }
  queueMicrotask(pump);
}

export function setSnippetSyntaxProvider(value: SnippetSyntaxProvider | null): void {
  provider = value;
  refreshSnippetSyntax();
}

export function highlightTextmateElement(target: HTMLElement, options: Omit<SnippetSyntaxRequest, 'text'>): void {
  const old = currentPaint.get(target);
  if (old) forget(old);
  unwrapSyntax(target);
  const text = target.textContent || '';
  const bytes = new TextEncoder().encode(text).length;
  if (!text || bytes > 64 * 1024) {
    currentPaint.delete(target);
    return;
  }
  const paint: Paint = { target: new WeakRef(target), request: { ...options, text }, version: 0, bytes };
  currentPaint.set(target, paint);
  paints.add(paint);
  trackedBytes += bytes;
  queue.add(paint);
  // Weak records cannot retain detached result trees; cap bookkeeping as well.
  while (paints.size > MAX_RECORDS || trackedBytes > MAX_TRACKED_BYTES) {
    const oldest = paints.values().next().value as Paint;
    forget(oldest);
  }
  queueMicrotask(pump);
}
