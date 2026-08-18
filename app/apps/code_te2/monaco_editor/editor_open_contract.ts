export interface EditorOpenPayload {
  path?: string | null;
  line?: number | string | null;
  lineNo?: number | string | null;
  column?: number | string | null;
  col?: number | string | null;
  focus?: boolean;
  scroll_y?: string;
  scroll_to_top?: boolean;
  request_id?: string;
  reason?: string;
  content?: string;
  content_sha256?: string | null;
  document_revision?: number;
  base_sha256?: string | null;
  state?: string;
  unsaved?: boolean;
  auto_save?: boolean | null;
  has_draft?: boolean;
  scroll_line?: number | string | null;
}

export interface EditorOpenTransaction {
  path: string;
  generation: number | null;
  line: number | null;
  column: number;
  focus?: boolean;
  scroll_y?: string;
  scroll_to_top?: boolean;
  request_id: string;
  hasExplicitNavigation: boolean;
  navigationApplied: boolean;
  createdAt: number;
  guardUntil: number;
}

export interface EditorOpenJumpPayload {
  line: number;
  column?: number;
  focus?: boolean;
  scroll_y?: string;
  scroll_to_top?: boolean;
}

export interface EditorOpenTransactionStore {
  activeOpenTransaction: EditorOpenTransaction | null;
  openTransactionChain: Promise<unknown>;
}

export interface EditorPositionLike {
  lineNumber: number;
  column: number;
}

export interface EditorUriLike {
  toString(): string;
}

export interface EditorModelLike {
  uri?: EditorUriLike | null;
}

export interface EditorLike {
  getModel?(): EditorModelLike | null;
  getPosition?(): EditorPositionLike | null;
}

export type CoercePositiveIntFn = (value: unknown) => number | null;

export function coercePositiveInt(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = parseInt(value, 10);
  if (!Number.isFinite(Number(value))) return null;
  const numericValue = Number(value);
  if (numericValue < 1) return null;
  return numericValue;
}
