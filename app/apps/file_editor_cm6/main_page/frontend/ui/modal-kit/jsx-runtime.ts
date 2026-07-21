export type JsxChild =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | JsxChild[];

export type JsxComponent<Props extends Record<string, unknown> = Record<string, unknown>> = (
  props: Props & { children?: JsxChild[] },
) => Node;

type JsxTag = string | JsxComponent;

let activeDocument: Document | null = null;

function targetDocument(): Document {
  const document = activeDocument || globalThis.document;
  if (!document) throw new Error("JSX DOM rendering requires a document");
  return document;
}

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" &&
    typeof (value as { nodeType?: unknown }).nodeType === "number";
}

function appendChild(parent: Node, child: JsxChild): void {
  if (Array.isArray(child)) {
    child.forEach((item) => appendChild(parent, item));
    return;
  }
  if (child == null || typeof child === "boolean") return;
  parent.appendChild(
    isNode(child) ? child : targetDocument().createTextNode(String(child)),
  );
}

function setElementProperty(
  element: HTMLElement,
  name: string,
  value: unknown,
): void {
  if (name === "children" || name === "ref" || value == null) return;
  if (/^on[A-Z]/.test(name) && typeof value === "function") {
    element.addEventListener(
      name.slice(2).toLowerCase(),
      value as EventListener,
    );
    return;
  }
  if (name === "className") {
    element.className = String(value);
    return;
  }
  if (name === "htmlFor") {
    element.setAttribute("for", String(value));
    return;
  }
  if (name === "style" && typeof value === "object") {
    Object.assign(element.style, value);
    return;
  }
  if (name === "style") {
    element.style.cssText = String(value);
    return;
  }
  if (name === "dataset" && typeof value === "object") {
    Object.assign(element.dataset, value);
    return;
  }

  if (!name.startsWith("aria-") && !name.startsWith("data-") && name in element) {
    try {
      (element as unknown as Record<string, unknown>)[name] = value;
      return;
    } catch (_) {
      // Read-only DOM properties fall back to attributes.
    }
  }
  if (typeof value === "boolean") {
    if (value) element.setAttribute(name, "");
    else element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, String(value));
}

export function renderWithDocument<Value>(
  document: Document,
  render: () => Value,
): Value {
  const previous = activeDocument;
  activeDocument = document;
  try {
    return render();
  } finally {
    activeDocument = previous;
  }
}

export function Fragment(props: { children?: JsxChild[] }): DocumentFragment {
  const fragment = targetDocument().createDocumentFragment();
  appendChild(fragment, props.children || []);
  return fragment;
}

export function jsx(
  tag: JsxTag,
  rawProps: Record<string, unknown> | null,
  ...children: JsxChild[]
): Node {
  const props = rawProps || {};
  const allChildren = [
    ...(Array.isArray(props.children) ? props.children as JsxChild[] : []),
    ...children,
  ];
  if (typeof tag === "function") {
    return tag({ ...props, children: allChildren });
  }

  const element = targetDocument().createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    setElementProperty(element, name, value);
  }
  appendChild(element, allChildren);
  const ref = props.ref;
  if (typeof ref === "function") ref(element);
  return element;
}

declare global {
  namespace JSX {
    type Element = Node;

    interface ElementChildrenAttribute {
      children: unknown;
    }

    interface IntrinsicElements {
      [elementName: string]: Record<string, unknown>;
    }
  }
}
