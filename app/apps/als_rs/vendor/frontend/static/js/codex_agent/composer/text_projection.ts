export interface ComposerPoint {
  node: Node;
  offset: number;
}

interface TextSpan {
  start: number;
  end: number;
  before: ComposerPoint;
  after: ComposerPoint;
  textNode?: Node;
}

// Contenteditable line containers are separators, not trailing newline text.
// A final BR is the browser's caret placeholder; render our own newlines as text
// so actual trailing blank lines are never confused with that placeholder.
export function projectComposerText(root: Node, mentionText: (element: HTMLElement) => string) {
  let text = '';
  const spans: TextSpan[] = [];
  const offsets = new Map<Node, number[]>();
  const textStarts = new Map<Node, number>();
  const isBlock = (node: Node): boolean => node.nodeType === 1
    && ['DIV', 'P'].includes((node as Element).tagName);
  const isBreak = (node: Node): boolean => node.nodeType === 1
    && (node as Element).tagName === 'BR';
  const contentCache = new WeakMap<Node, boolean>();
  const contributesLine = (node: Node): boolean => {
    const cached = contentCache.get(node);
    if (cached !== undefined) return cached;
    const result = node.nodeType === 3 ? Boolean(node.textContent)
      : node.nodeType === 1 && (isBlock(node) || isBreak(node)
        || (node as Element).classList.contains('mention-token')
        || Array.from(node.childNodes).some(contributesLine));
    contentCache.set(node, result);
    return result;
  };
  const isPlaceholderBreak = (node: Node): boolean => {
    let current = node;
    while (current.parentNode) {
      for (let sibling = current.nextSibling; sibling; sibling = sibling.nextSibling) {
        if (contributesLine(sibling)) return false;
      }
      const parent = current.parentNode;
      if (parent === root || isBlock(parent)) return true;
      current = parent;
    }
    return false;
  };
  const append = (value: string, before: ComposerPoint, after: ComposerPoint, textNode?: Node) => {
    const start = text.length;
    text += value;
    spans.push({ start, end: text.length, before, after, textNode });
  };
  const visit = (parent: Node): void => {
    const children = Array.from(parent.childNodes);
    const points: number[] = [];
    offsets.set(parent, points);
    let previous: Node | null = null;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      points[index] = text.length;
      if (previous && contributesLine(child) && (isBlock(child) || isBlock(previous))
        && !(!isBlock(previous) && text.endsWith('\n'))) {
        append('\n', { node: parent, offset: index }, { node: child, offset: 0 });
      }
      if (child.nodeType === 3) {
        const value = child.textContent || '';
        textStarts.set(child, text.length);
        append(value, { node: child, offset: 0 }, { node: child, offset: value.length }, child);
      } else if (child.nodeType === 1) {
        const element = child as HTMLElement;
        if (element.classList.contains('mention-token')) {
          append(mentionText(element), { node: parent, offset: index }, { node: parent, offset: index + 1 });
        } else if (isBreak(child)) {
          const placeholder = isPlaceholderBreak(child);
          offsets.set(child, [text.length]);
          if (!placeholder) {
            append('\n', { node: parent, offset: index }, { node: parent, offset: index + 1 });
          }
        } else {
          visit(child);
        }
      }
      if (contributesLine(child)) previous = child;
    }
    points[children.length] = text.length;
  };
  visit(root);

  return {
    text,
    offsetForPoint(node: Node, offset: number): number | null {
      const start = textStarts.get(node);
      if (start !== undefined) return start + Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
      const points = offsets.get(node);
      return points?.[Math.max(0, Math.min(offset, points.length - 1))] ?? null;
    },
    pointAt(offset: number): ComposerPoint {
      const target = Math.max(0, Math.min(offset, text.length));
      for (const span of spans) {
        if (target > span.end) continue;
        if (span.textNode) return { node: span.textNode, offset: Math.max(0, target - span.start) };
        return target <= span.start ? span.before : span.after;
      }
      return { node: root, offset: root.childNodes.length };
    },
  };
}
