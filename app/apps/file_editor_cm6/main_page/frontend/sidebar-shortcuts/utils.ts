import {
  SHORTCUT_KIND_FRAMEWORK_APP,
  SHORTCUT_KIND_URL,
  SHORTCUT_LOAD_EAGER,
  SHORTCUT_LOAD_LAZY,
} from './constants.ts';
import type { JsonFetchResult, ShortcutKind, ShortcutLoad, UnknownRecord } from './types.ts';

export function normStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

export function firstGrapheme(text: unknown): string {
  const value = normStr(text);
  if (!value) return '';
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const it = seg.segment(value)[Symbol.iterator]();
      const first = it.next();
      if (first && first.value && first.value.segment) return first.value.segment;
    }
  } catch (_) {}
  return Array.from(value)[0] || '';
}

export function normalizeLoad(raw: unknown): ShortcutLoad {
  const value = normStr(raw).toLowerCase();
  return value === SHORTCUT_LOAD_EAGER ? SHORTCUT_LOAD_EAGER : SHORTCUT_LOAD_LAZY;
}

export function normalizeKind(raw: unknown): ShortcutKind | '' {
  const value = normStr(raw).toLowerCase();
  if (value === SHORTCUT_KIND_URL) return SHORTCUT_KIND_URL;
  if (value === SHORTCUT_KIND_FRAMEWORK_APP) return SHORTCUT_KIND_FRAMEWORK_APP;
  return '';
}

export function normalizeEditorKind(raw: unknown): ShortcutKind {
  const kind = normalizeKind(raw);
  return kind || SHORTCUT_KIND_URL;
}

export function buildFrameworkAppUrl(appId: unknown): string {
  const safe = normStr(appId);
  if (!safe) return '';
  return `/app/${encodeURIComponent(safe)}?embed=1`;
}

export async function fetchJson<TBody = unknown>(
  url: string,
  opts?: RequestInit,
): Promise<JsonFetchResult<TBody>> {
  const resp = await fetch(url, opts);
  let body: TBody | null = null;
  try {
    body = await resp.json() as TBody;
  } catch (_) {}
  return { resp, body };
}
