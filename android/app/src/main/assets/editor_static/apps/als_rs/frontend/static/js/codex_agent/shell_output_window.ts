import { ansiToHtml, createAnsiState, hasAnsiSgr } from './terminal_ansi.ts';

type Params = Record<string, string | number>;
type OutputReference = { id: string; conversation_id: string; bytes: number; running: boolean };
type OutputWindow = {
  text: string; ansi_prefix?: string; stderr_start?: number | null; offsets: number[]; start: number; end: number;
  start_byte: number; end_byte: number; bytes: number; at_start: boolean; at_tail: boolean;
};
type Action = 'tail' | 'older' | 'newer' | 'current';
let requestWindow: ((params: Params) => Promise<unknown>) | null = null;
let highlightOutput: ((text: string, command: string) => string | null) | undefined;
const controllers = new WeakMap<HTMLElement, OutputController>();
let visibility: IntersectionObserver | null = null;

export function configureShellOutputWindows(request: (params: Params) => Promise<unknown>, highlight?: (text: string, command: string) => string | null): void {
  requestWindow = request;
  highlightOutput = highlight;
  visibility = new IntersectionObserver(entries => {
    for (const entry of entries) controllers.get(entry.target as HTMLElement)?.visible(entry.isIntersecting);
  });
  // Detach observers when card roots are pruned; reobserve parked cards on remount.
  const observeTree = (node: Node, attached: boolean): void => {
    if (!(node instanceof HTMLElement)) return;
    const elements = [node, ...Array.from(node.querySelectorAll<HTMLElement>('pre.shell-output-window'))];
    for (const el of elements) {
      if (!controllers.has(el)) continue;
      if (attached) visibility?.observe(el);
      else if (!el.isConnected) { visibility?.unobserve(el); controllers.get(el)?.visible(false); }
    }
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.target instanceof HTMLElement && record.target.closest('pre.shell-output-window')) continue;
      for (const node of Array.from(record.removedNodes)) observeTree(node, false);
      for (const node of Array.from(record.addedNodes)) observeTree(node, true);
    }
  }).observe(document.getElementById('agent-timeline') ?? document.body, { childList: true, subtree: true });
}

function reference(value: unknown): OutputReference | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.conversation_id === 'string'
    ? { id: item.id, conversation_id: item.conversation_id, bytes: Number(item.bytes) || 0, running: item.running === true } : null;
}

export function mountShellOutputWindow(pre: HTMLPreElement, value: unknown, command = ''): boolean {
  const ref = reference(value);
  if (!ref) return false;
  const existing = controllers.get(pre);
  if (existing) { existing.update(ref, command); return true; }
  const controller = new OutputController(pre, ref, command);
  controllers.set(pre, controller);
  visibility?.observe(pre);
  return true;
}

class OutputController {
  private ref: OutputReference;
  private window: OutputWindow | null = null;
  private pinned = true;
  private shown = false;
  private busy = false;
  private programmatic = false;
  private dirty = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private follow: HTMLButtonElement;
  private generation = 0;

  constructor(private pre: HTMLPreElement, ref: OutputReference, private command: string) {
    this.ref = ref;
    pre.classList.add('shell-output-window');
    pre.textContent = 'Loading output...';
    const frame = document.createElement('div');
    frame.className = 'shell-output-frame';
    pre.replaceWith(frame);
    frame.append(pre);
    this.follow = document.createElement('button');
    this.follow.type = 'button';
    this.follow.className = 'shell-output-follow codicon codicon-arrow-down';
    this.follow.title = 'Follow output';
    this.follow.setAttribute('aria-label', 'Follow output');
    this.follow.hidden = true;
    this.follow.addEventListener('click', event => {
      event.stopPropagation(); this.pinned = true; this.follow.hidden = true;
      this.dirty = true; this.schedule();
    });
    frame.append(this.follow);
    pre.addEventListener('wheel', event => { if (event.deltaY < 0) this.detach(); }, { passive: true });
    let touchY: number | null = null;
    pre.addEventListener('touchstart', event => { touchY = event.touches[0]?.clientY ?? null; }, { passive: true });
    pre.addEventListener('touchmove', event => {
      if (touchY !== null && (event.touches[0]?.clientY ?? touchY) > touchY + 4) this.detach();
    }, { passive: true });
    pre.addEventListener('touchend', () => { touchY = null; }, { passive: true });
    pre.addEventListener('keydown', event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) this.detach(); });
    pre.tabIndex = 0;
    pre.addEventListener('scroll', () => {
      if (this.programmatic || this.busy || !this.window) return;
      const gap = pre.scrollHeight - pre.scrollTop - pre.clientHeight;
      if (gap > 24) this.detach();
      if (gap <= 4 && this.window.at_tail) {
        this.pinned = true; this.follow.hidden = true;
      }
      if (this.pinned) { this.schedule(); return; }
      if (pre.scrollTop < 160 && !this.window.at_start) void this.load('older');
      else if (gap < 160 && !this.window.at_tail) void this.load('newer');
    }, { passive: true });
  }

  private detach(): void { this.pinned = false; this.follow.hidden = false; }
  visible(value: boolean): void {
    this.shown = value;
    if (value) this.schedule();
    else if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
  update(ref: OutputReference, command = ''): void {
    if (ref.id !== this.ref.id) { this.generation++; this.window = null; }
    this.ref = ref; this.dirty = true;
    if (command) this.command = command;
    this.schedule();
  }
  private schedule(): void {
    if (!this.shown || this.busy || this.timer || !this.dirty || (!this.pinned && this.window)) return;
    this.timer = setTimeout(() => { this.timer = null; void this.load(this.pinned ? 'tail' : 'current'); }, 100);
  }
  private async load(action: Action): Promise<void> {
    if (this.busy || !requestWindow || !this.pre.isConnected) return;
    this.busy = true; this.dirty = false;
    const generation = this.generation;
    const pinnedAtRequest = this.pinned;
    const ref = this.ref;
    try {
      const result = await requestWindow({
        conversation_id: ref.conversation_id, output_id: ref.id, action,
        start: this.window?.start ?? 0,
        shift: Math.max(1, Math.min(50, Math.floor(((this.window?.end ?? 100) - (this.window?.start ?? 0)) / 2))),
      }) as OutputWindow;
      if (generation !== this.generation || !this.pre.isConnected) return;
      // A touch during a tail fetch wins over the request's earlier pin state.
      if (pinnedAtRequest && !this.pinned && this.window) { this.dirty = true; return; }
      const top = this.pre.getBoundingClientRect().top;
      const anchor = Array.from(this.pre.children).find(el => el.getBoundingClientRect().bottom > top);
      const anchorId = (anchor as HTMLElement | undefined)?.dataset.offset;
      const anchorY = anchor?.getBoundingClientRect().top ?? top;
      const fragment = document.createDocumentFragment();
      const bytes = new TextEncoder().encode(result.text);
      const decoder = new TextDecoder();
      const ansiState = createAnsiState();
      ansiToHtml(result.ansi_prefix || '', ansiState);
      const texts = result.offsets.map((offset, i) => decoder.decode(bytes.subarray(
        offset - result.start_byte, (result.offsets[i + 1] ?? result.end_byte) - result.start_byte,
      )));
      let highlighted: DocumentFragment[] | null = null;
      if (!hasAnsiSgr(result.text) && (!result.ansi_prefix || result.ansi_prefix === '\x1b[0m')) {
        try {
          const html = highlightOutput?.(result.text, this.command);
          if (html) highlighted = partitionHighlight(html, texts);
        } catch { /* Plain output remains readable if a grammar rejects it. */ }
      }
      for (let i = 0; i < result.offsets.length; i++) {
        const row = document.createElement('span');
        row.className = 'shell-output-line';
        const stderr = typeof result.stderr_start === 'number' && result.offsets[i] >= result.stderr_start;
        if (stderr) row.classList.add('shell-stderr');
        if (result.offsets[i] === result.stderr_start) Object.assign(ansiState, createAnsiState());
        row.dataset.offset = String(result.offsets[i]);
        if (highlighted && !stderr) row.append(highlighted[i]);
        else row.innerHTML = ansiToHtml(texts[i], ansiState);
        fragment.append(row);
      }
      this.programmatic = true;
      this.pre.replaceChildren(fragment);
      this.window = result;
      if (this.pinned) this.pre.scrollTop = this.pre.scrollHeight;
      else if (anchorId) {
        const restored = Array.from(this.pre.children).find(el => (el as HTMLElement).dataset.offset === anchorId);
        if (restored) this.pre.scrollTop += restored.getBoundingClientRect().top - anchorY;
      }
      requestAnimationFrame(() => { this.programmatic = false; });
    } catch (error) {
      if (!this.window) this.pre.textContent = `Output unavailable: ${error instanceof Error ? error.message : String(error)}`;
      this.follow.hidden = false;
    } finally { this.busy = false; this.schedule(); }
  }
}

// Split already-highlighted DOM without re-running the grammar per line.
function partitionHighlight(html: string, texts: string[]): DocumentFragment[] | null {
  const host = document.createElement('div');
  host.innerHTML = html;
  if (host.textContent !== texts.join('')) return null;
  const walker = document.createTreeWalker(host, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let nodeIndex = 0;
  let offset = 0;
  return texts.map(text => {
    if (!text.length || !nodes[nodeIndex]) return document.createDocumentFragment();
    const range = document.createRange();
    range.setStart(nodes[nodeIndex], offset);
    let remaining = text.length;
    while (remaining > nodes[nodeIndex].length - offset) {
      remaining -= nodes[nodeIndex].length - offset;
      nodeIndex++; offset = 0;
    }
    offset += remaining;
    range.setEnd(nodes[nodeIndex], offset);
    let fragment = range.cloneContents();
    let ancestor = range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
    while (ancestor && ancestor !== host) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(fragment);
      fragment = document.createDocumentFragment();
      fragment.append(wrapper);
      ancestor = ancestor.parentNode;
    }
    if (offset === nodes[nodeIndex].length) { nodeIndex++; offset = 0; }
    return fragment;
  });
}
