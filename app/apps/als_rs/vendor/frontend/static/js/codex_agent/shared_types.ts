export type UnknownRecord = Record<string, unknown>;

export interface SocketLike {
  connected: boolean;
  emit(event: string, ...args: unknown[]): void;
}

export interface HighlightJsLike {
  getLanguage?(name: string): unknown;
  highlight?(value: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
  highlightAuto?(value: string): { value: string; relevance: number };
  highlightElement?(element: Element): void;
}

export interface ToggleableRow extends HTMLElement {
  _toggleCollapse?: (forceExpanded?: boolean) => boolean;
}

export interface MessageCardRow extends HTMLElement {
  _messageRole?: string;
  _messageText?: string;
}

export interface ClipboardDataLike {
  getData?(format: string): string | null | undefined;
}

export interface ClipboardWindow {
  clipboardData?: ClipboardDataLike | null;
}

export interface TributeItemOriginal {
  path?: string;
  name?: string;
  type?: string;
}

export interface TributeLookupItem {
  original: TributeItemOriginal;
}

export interface TributeInstance {
  attach(target: Element): void;
  detach(target: Element): void;
}

export interface TributeOptions {
  trigger: string;
  allowSpaces: boolean;
  menuShowMinLength: number;
  noMatchTemplate: string;
  selectTemplate(item: TributeLookupItem | null): string;
  menuItemTemplate(item: TributeLookupItem): string;
  values(text: string, cb: (items: TributeItemOriginal[]) => void): Promise<void> | void;
  lookup: string;
  fillAttr: string;
}

export interface TributeConstructor {
  new (options: TributeOptions): TributeInstance;
}
