import { languageIdFromPath } from '../../../monaco_editor/editor_language_utils.ts';
import { diffWordsWithSpace } from '../../../vendor/diff/libesm/index.js';
import hljsCoreModule from '../../../vendor/highlightjs/lib/core.js';
import bashLanguageModule from '../../../vendor/highlightjs/lib/languages/bash.js';
import cLanguageModule from '../../../vendor/highlightjs/lib/languages/c.js';
import cppLanguageModule from '../../../vendor/highlightjs/lib/languages/cpp.js';
import cssLanguageModule from '../../../vendor/highlightjs/lib/languages/css.js';
import diffLanguageModule from '../../../vendor/highlightjs/lib/languages/diff.js';
import goLanguageModule from '../../../vendor/highlightjs/lib/languages/go.js';
import javaLanguageModule from '../../../vendor/highlightjs/lib/languages/java.js';
import javascriptLanguageModule from '../../../vendor/highlightjs/lib/languages/javascript.js';
import jsonLanguageModule from '../../../vendor/highlightjs/lib/languages/json.js';
import kotlinLanguageModule from '../../../vendor/highlightjs/lib/languages/kotlin.js';
import markdownLanguageModule from '../../../vendor/highlightjs/lib/languages/markdown.js';
import pythonLanguageModule from '../../../vendor/highlightjs/lib/languages/python.js';
import rustLanguageModule from '../../../vendor/highlightjs/lib/languages/rust.js';
import typescriptLanguageModule from '../../../vendor/highlightjs/lib/languages/typescript.js';
import xmlLanguageModule from '../../../vendor/highlightjs/lib/languages/xml.js';
import yamlLanguageModule from '../../../vendor/highlightjs/lib/languages/yaml.js';

type DiffChangeLike = {
  value?: string;
  added?: boolean;
  removed?: boolean;
};

type HljsLanguageFactory = (hljs: unknown) => unknown;

interface HljsCoreLike {
  registerLanguage(name: string, language: HljsLanguageFactory): void;
  getLanguage?(name: string): unknown;
  highlight(
    value: string,
    options: { language: string; ignoreIllegals?: boolean },
  ): { value: string };
}

const hljs = hljsCoreModule as HljsCoreLike;

const HIGHLIGHT_LANGUAGE_FACTORIES: ReadonlyArray<
  readonly [string, HljsLanguageFactory]
> = [
  ['bash', bashLanguageModule as HljsLanguageFactory],
  ['shell', bashLanguageModule as HljsLanguageFactory],
  ['c', cLanguageModule as HljsLanguageFactory],
  ['cpp', cppLanguageModule as HljsLanguageFactory],
  ['css', cssLanguageModule as HljsLanguageFactory],
  ['diff', diffLanguageModule as HljsLanguageFactory],
  ['go', goLanguageModule as HljsLanguageFactory],
  ['java', javaLanguageModule as HljsLanguageFactory],
  ['javascript', javascriptLanguageModule as HljsLanguageFactory],
  ['json', jsonLanguageModule as HljsLanguageFactory],
  ['kotlin', kotlinLanguageModule as HljsLanguageFactory],
  ['markdown', markdownLanguageModule as HljsLanguageFactory],
  ['python', pythonLanguageModule as HljsLanguageFactory],
  ['rust', rustLanguageModule as HljsLanguageFactory],
  ['typescript', typescriptLanguageModule as HljsLanguageFactory],
  ['xml', xmlLanguageModule as HljsLanguageFactory],
  ['html', xmlLanguageModule as HljsLanguageFactory],
  ['yaml', yamlLanguageModule as HljsLanguageFactory],
];

let highlightRuntimeReady = false;

function ensureHighlightRuntime(): void {
  if (highlightRuntimeReady) {
    return;
  }
  for (const [languageId, factory] of HIGHLIGHT_LANGUAGE_FACTORIES) {
    hljs.registerLanguage(languageId, factory);
  }
  highlightRuntimeReady = true;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function resolveHighlightLanguage(
  filePath: string | null | undefined,
): string | null {
  const languageId = languageIdFromPath(filePath, null, null);
  if (!languageId || languageId === 'plaintext') {
    return null;
  }
  ensureHighlightRuntime();
  return hljs.getLanguage?.(languageId) ? languageId : null;
}

function highlightToHtml(
  text: string,
  filePath: string | null | undefined,
): string {
  const language = resolveHighlightLanguage(filePath);
  if (!text) {
    return '';
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
  const span = document.createElement('span');
  span.className = classNames.join(' ');
  span.innerHTML = highlightToHtml(text, filePath);
  return span;
}

export function renderHighlightedSearchSnippet(
  target: HTMLElement,
  text: string,
  filePath: string | null | undefined,
): void {
  target.classList.add('hljs', 'fe-search-code-surface');
  target.innerHTML = highlightToHtml(text, filePath);
}

export function renderHighlightedDiffText(
  target: HTMLElement,
  text: string,
  filePath: string | null | undefined,
  options?: {
    compareAgainst?: string | null;
    mode?: 'added' | 'removed' | null;
  },
): void {
  target.classList.add('hljs', 'fe-search-code-surface');
  target.replaceChildren();

  const compareAgainst = options?.compareAgainst ?? null;
  const mode = options?.mode ?? null;
  if (!compareAgainst || !mode || typeof diffWordsWithSpace !== 'function') {
    target.innerHTML = highlightToHtml(text, filePath);
    return;
  }

  const parts =
    mode === 'removed'
      ? diffWordsWithSpace(text, compareAgainst)
      : diffWordsWithSpace(compareAgainst, text);
  if (!Array.isArray(parts) || parts.length === 0) {
    target.innerHTML = highlightToHtml(text, filePath);
    return;
  }

  const fragment = document.createDocumentFragment();
  let appended = false;
  for (const part of parts) {
    const value = typeof part.value === 'string' ? part.value : '';
    if (!value) {
      continue;
    }
    if (mode === 'added' && part.removed) {
      continue;
    }
    if (mode === 'removed' && part.added) {
      continue;
    }

    const isChanged = mode === 'added' ? Boolean(part.added) : Boolean(part.removed);
    fragment.appendChild(
      createHighlightedSegment(value, filePath, [
        'fe-search-diff-token',
        isChanged
          ? mode === 'added'
            ? 'is-added'
            : 'is-removed'
          : 'is-unchanged',
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
