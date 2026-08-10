import { languageIdFromPath } from "../../../monaco_editor/editor_language_utils.ts";
import { diffWordsWithSpace } from "../../../vendor/diff/libesm/index.js";
import hljsCoreModule from "../../../vendor/highlightjs/lib/core.js";
import {
  HIGHLIGHT_LANGUAGE_FACTORIES,
  type HljsLanguageFactory,
} from "./hljs-language-registry.generated.ts";
import type { ExplorerSearchTextRange } from "./types.ts";

type DiffChangeLike = {
  value?: string;
  added?: boolean;
  removed?: boolean;
};

interface SearchSnippetOptions {
  ranges?: ExplorerSearchTextRange[];
  matchText?: string | null;
  column?: number | null;
  visibleChars?: number | null;
}

interface NormalizedTextRange {
  start: number;
  end: number;
}

interface SnippetWindow {
  text: string;
  ranges: NormalizedTextRange[];
  headTruncated: boolean;
  tailTruncated: boolean;
}

interface HljsCoreLike {
  registerLanguage(name: string, language: HljsLanguageFactory): void;
  getLanguage?(name: string): unknown;
  highlight(
    value: string,
    options: { language: string; ignoreIllegals?: boolean },
  ): { value: string };
}

const hljs = hljsCoreModule as HljsCoreLike;

const PLAINTEXT_LANGUAGE_IDS = new Set(["", "text", "txt", "plaintext"]);

const HIGHLIGHT_LANGUAGE_OVERRIDES = new Map<string, string>([
  ["cjs", "javascript"],
  ["cts", "typescript"],
  ["htm", "html"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["mjs", "javascript"],
  ["mts", "typescript"],
  ["shell", "bash"],
  ["sh", "bash"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["zsh", "bash"],
]);

let highlightRuntimeReady = false;

function ensureHighlightRuntime(): void {
  if (highlightRuntimeReady) {
    return;
  }
  for (const [languageId, factory] of HIGHLIGHT_LANGUAGE_FACTORIES) {
    if (hljs.getLanguage?.(languageId)) {
      continue;
    }
    try {
      hljs.registerLanguage(languageId, factory);
    } catch (error) {
      console.warn(
        "[ExplorerSearch] failed to register highlight language",
        languageId,
        error,
      );
    }
  }
  highlightRuntimeReady = true;
}

function normalizeHighlightCandidate(
  value: string | null | undefined,
): string | null {
  const candidate = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  if (PLAINTEXT_LANGUAGE_IDS.has(candidate)) {
    return null;
  }
  return HIGHLIGHT_LANGUAGE_OVERRIDES.get(candidate) || candidate;
}

function pushHighlightCandidate(
  candidates: string[],
  seen: Set<string>,
  value: string | null | undefined,
): void {
  const candidate = normalizeHighlightCandidate(value);
  if (!candidate || seen.has(candidate)) {
    return;
  }
  seen.add(candidate);
  candidates.push(candidate);
}

function highlightCandidatesForPath(
  filePath: string | null | undefined,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  pushHighlightCandidate(
    candidates,
    seen,
    languageIdFromPath(filePath, null, null),
  );

  const baseName = String(filePath || "")
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase();
  if (!baseName) {
    return candidates;
  }

  pushHighlightCandidate(candidates, seen, baseName);
  const parts = baseName.split(".").filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) {
    pushHighlightCandidate(candidates, seen, parts.slice(index).join("."));
  }
  if (parts.length > 1) {
    pushHighlightCandidate(candidates, seen, parts.at(-1));
  }
  return candidates;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function resolveHighlightLanguage(
  filePath: string | null | undefined,
): string | null {
  ensureHighlightRuntime();
  for (const candidate of highlightCandidatesForPath(filePath)) {
    if (hljs.getLanguage?.(candidate)) {
      return candidate;
    }
  }
  return null;
}

function highlightToHtml(
  text: string,
  filePath: string | null | undefined,
): string {
  const language = resolveHighlightLanguage(filePath);
  if (!text) {
    return "";
  }
  if (!language) {
    return escapeHtml(text);
  }
  try {
    return hljs.highlight(text, {
      language,
      ignoreIllegals: true,
    }).value;
  } catch {
    return escapeHtml(text);
  }
}

function createHighlightedSegment(
  text: string,
  filePath: string | null | undefined,
  classNames: readonly string[],
): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = classNames.join(" ");
  span.innerHTML = highlightToHtml(text, filePath);
  return span;
}

function clampRange(
  range: ExplorerSearchTextRange,
  text: string,
  matchText: string | null | undefined,
): NormalizedTextRange | null {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    return null;
  }
  const start = Math.trunc(range.start);
  const end = Math.trunc(range.end);
  if (start < 0 || end <= start) {
    return null;
  }

  const directRange = {
    start: Math.min(start, text.length),
    end: Math.min(end, text.length),
  };
  if (
    directRange.end > directRange.start &&
    (!matchText || text.slice(directRange.start, directRange.end) === matchText)
  ) {
    return directRange;
  }

  const converted = byteRangeToStringRange(text, start, end);
  if (
    converted &&
    converted.end > converted.start &&
    (!matchText || text.slice(converted.start, converted.end) === matchText)
  ) {
    return converted;
  }

  return directRange.end > directRange.start ? directRange : null;
}

function byteRangeToStringRange(
  text: string,
  byteStart: number,
  byteEnd: number,
): NormalizedTextRange | null {
  let utf8Offset = 0;
  let startIndex: number | null = null;
  let endIndex: number | null = null;
  for (let index = 0; index < text.length; ) {
    if (startIndex === null && utf8Offset >= byteStart) {
      startIndex = index;
    }
    if (endIndex === null && utf8Offset >= byteEnd) {
      endIndex = index;
      break;
    }
    const codePoint = text.codePointAt(index);
    if (typeof codePoint !== "number") {
      break;
    }
    utf8Offset += utf8ByteLength(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  if (startIndex === null && utf8Offset >= byteStart) {
    startIndex = text.length;
  }
  if (endIndex === null && utf8Offset >= byteEnd) {
    endIndex = text.length;
  }
  if (startIndex === null || endIndex === null || endIndex <= startIndex) {
    return null;
  }
  return { start: startIndex, end: endIndex };
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function normalizeSnippetRanges(
  text: string,
  options: SearchSnippetOptions | undefined,
): NormalizedTextRange[] {
  const ranges = Array.isArray(options?.ranges) ? options.ranges : [];
  const normalized = ranges
    .map((range) => clampRange(range, text, options?.matchText))
    .filter((range): range is NormalizedTextRange => Boolean(range))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (normalized.length > 0) {
    return mergeRanges(normalized);
  }

  const matchText = options?.matchText || "";
  if (!matchText) {
    return [];
  }
  const column = typeof options?.column === "number" ? options.column : null;
  if (column !== null && column >= 0 && column < text.length) {
    const end = Math.min(text.length, column + matchText.length);
    if (end > column) {
      return [{ start: column, end }];
    }
  }

  const foundAt = text.indexOf(matchText);
  return foundAt >= 0
    ? [{ start: foundAt, end: foundAt + matchText.length }]
    : [];
}

function mergeRanges(ranges: NormalizedTextRange[]): NormalizedTextRange[] {
  const merged: NormalizedTextRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function visibleCharBudget(
  target: HTMLElement,
  explicitBudget: number | null | undefined,
): number {
  if (typeof explicitBudget === "number" && Number.isFinite(explicitBudget)) {
    return Math.max(18, Math.trunc(explicitBudget));
  }
  const width = target.clientWidth;
  if (width > 0) {
    const style = window.getComputedStyle(target);
    const fontSize = Number.parseFloat(style.fontSize) || 12;
    return Math.max(18, Math.floor(width / (fontSize * 0.62)));
  }
  return 72;
}

function buildSnippetWindow(
  text: string,
  ranges: NormalizedTextRange[],
  visibleChars: number,
): SnippetWindow {
  if (!text || text.length <= visibleChars || ranges.length === 0) {
    return {
      text,
      ranges,
      headTruncated: false,
      tailTruncated: false,
    };
  }

  const firstRange = ranges[0];
  const matchCenter =
    firstRange.start + (firstRange.end - firstRange.start) / 2;
  let windowStart = Math.floor(matchCenter - visibleChars / 2);
  windowStart = Math.max(0, Math.min(windowStart, text.length - visibleChars));
  if (firstRange.start < windowStart) {
    windowStart = firstRange.start;
  }
  let windowEnd = Math.min(text.length, windowStart + visibleChars);
  if (firstRange.end > windowEnd) {
    windowEnd = Math.min(text.length, firstRange.end);
    windowStart = Math.max(0, windowEnd - visibleChars);
  }

  const windowRanges = ranges
    .map((range) => ({
      start: Math.max(range.start, windowStart),
      end: Math.min(range.end, windowEnd),
    }))
    .filter((range) => range.end > range.start)
    .map((range) => ({
      start: range.start - windowStart,
      end: range.end - windowStart,
    }));

  return {
    text: text.slice(windowStart, windowEnd),
    ranges: windowRanges,
    headTruncated: windowStart > 0,
    tailTruncated: windowEnd < text.length,
  };
}

function renderSearchSnippetWindow(
  target: HTMLElement,
  windowed: SnippetWindow,
  filePath: string | null | undefined,
): void {
  target.replaceChildren();
  if (windowed.headTruncated) {
    const marker = document.createElement("span");
    marker.className = "fe-search-snippet-ellipsis";
    marker.textContent = "...";
    target.appendChild(marker);
  }

  let cursor = 0;
  for (const range of windowed.ranges) {
    if (range.start > cursor) {
      target.appendChild(
        createHighlightedSegment(
          windowed.text.slice(cursor, range.start),
          filePath,
          ["fe-search-snippet-token"],
        ),
      );
    }
    target.appendChild(
      createHighlightedSegment(
        windowed.text.slice(range.start, range.end),
        filePath,
        ["fe-search-snippet-token", "fe-search-hit"],
      ),
    );
    cursor = range.end;
  }

  if (cursor < windowed.text.length) {
    target.appendChild(
      createHighlightedSegment(windowed.text.slice(cursor), filePath, [
        "fe-search-snippet-token",
      ]),
    );
  }

  if (windowed.tailTruncated) {
    const marker = document.createElement("span");
    marker.className = "fe-search-snippet-ellipsis";
    marker.textContent = "...";
    target.appendChild(marker);
  }
}

export function renderHighlightedSearchSnippet(
  target: HTMLElement,
  text: string,
  filePath: string | null | undefined,
  options?: SearchSnippetOptions,
): void {
  target.classList.add("hljs", "fe-search-code-surface");
  const ranges = normalizeSnippetRanges(text, options);
  if (ranges.length === 0) {
    target.innerHTML = highlightToHtml(text, filePath);
    return;
  }

  const visibleChars = visibleCharBudget(target, options?.visibleChars);
  renderSearchSnippetWindow(
    target,
    buildSnippetWindow(text, ranges, visibleChars),
    filePath,
  );

  window.requestAnimationFrame(() => {
    if (!target.isConnected) {
      return;
    }
    const nextVisibleChars = visibleCharBudget(target, null);
    if (Math.abs(nextVisibleChars - visibleChars) < 2) {
      return;
    }
    renderSearchSnippetWindow(
      target,
      buildSnippetWindow(text, ranges, nextVisibleChars),
      filePath,
    );
  });
}

export function renderHighlightedDiffText(
  target: HTMLElement,
  text: string,
  filePath: string | null | undefined,
  options?: {
    compareAgainst?: string | null;
    mode?: "added" | "removed" | null;
  },
): void {
  target.classList.add("hljs", "fe-search-code-surface");
  target.replaceChildren();

  const compareAgainst = options?.compareAgainst ?? null;
  const mode = options?.mode ?? null;
  if (!compareAgainst || !mode || typeof diffWordsWithSpace !== "function") {
    target.innerHTML = highlightToHtml(text, filePath);
    return;
  }

  const parts =
    mode === "removed"
      ? diffWordsWithSpace(text, compareAgainst)
      : diffWordsWithSpace(compareAgainst, text);
  if (!Array.isArray(parts) || parts.length === 0) {
    target.innerHTML = highlightToHtml(text, filePath);
    return;
  }

  const fragment = document.createDocumentFragment();
  let appended = false;
  for (const part of parts) {
    const value = typeof part.value === "string" ? part.value : "";
    if (!value) {
      continue;
    }
    if (mode === "added" && part.removed) {
      continue;
    }
    if (mode === "removed" && part.added) {
      continue;
    }

    const isChanged =
      mode === "added" ? Boolean(part.added) : Boolean(part.removed);
    fragment.appendChild(
      createHighlightedSegment(value, filePath, [
        "fe-search-diff-token",
        isChanged
          ? mode === "added"
            ? "is-added"
            : "is-removed"
          : "is-unchanged",
      ]),
    );
    appended = true;
  }

  if (!appended) {
    target.innerHTML = highlightToHtml(text, filePath);
    return;
  }

  target.appendChild(fragment);
}
