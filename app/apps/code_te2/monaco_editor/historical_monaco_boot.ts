import type * as Monaco from '../../../static/vendor/monaco-editor-core/esm/vs/editor/editor.api';
import { loadMonaco } from '../../../static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.js';
import { createGeckoModuleWorker } from './editor_monaco_boot_runtime.ts';
import { mountHistoricalDiffView, type HistoricalDiffView } from './historical_diff_view.ts';

const CSS_URL = '/api/app/code_te2/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css?raw=1';
const WORKER_URL = '/api/app/code_te2/ui/monaco_vscode/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js';
type HistoricalWindow = Window & { MonacoEnvironment?: Record<string, unknown> };

let loading: Promise<typeof Monaco> | null = null;

async function loadSyntaxMonaco(): Promise<typeof Monaco> {
  const win = window as HistoricalWindow;
  // Only a fresh secondary realm may take this path. No WBA connection or
  // language-service contributions are installed, including in web-worker mode.
  win.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      if (label !== 'editorWorkerService') {
        throw new Error(`Historical editor refused language worker: ${label}`);
      }
      return /\bGecko\//.test(win.navigator.userAgent)
        ? createGeckoModuleWorker(win, Worker, URL, Blob, WORKER_URL)
        : new Worker(WORKER_URL, { type: 'module' });
    },
  };
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = CSS_URL;
  const styled = new Promise<void>((resolve, reject) => {
    style.onload = () => resolve();
    style.onerror = () => { style.remove(); reject(new Error('Historical Monaco stylesheet failed')); };
  });
  document.head.append(style);
  const [monaco] = await Promise.all([
    loadMonaco({ languageWorkersEnabled: false, basicLanguagesOnly: true }), styled,
  ]);
  // Generated bootstrap declarations intentionally expose an opaque namespace;
  // its implementation imports this exact pinned editor.api module.
  return monaco as typeof Monaco;
}

export async function bootHistoricalDiff(
  container: HTMLElement, content: unknown, signal: AbortSignal,
): Promise<HistoricalDiffView> {
  if (!loading) {
    loading = loadSyntaxMonaco().catch((error: unknown) => { loading = null; throw error; });
  }
  const monaco = await loading;
  signal.throwIfAborted();
  monaco.editor.setTheme('vs-dark');
  const languages = monaco.languages.getLanguages();
  return mountHistoricalDiffView({
    container, content, monaco, signal,
    languageForPath(path) {
      const basename = path.split('/').pop() || '';
      const filenameMatch = languages.find((language) => language.filenames?.includes(basename));
      if (filenameMatch) return filenameMatch.id;
      // Longest suffix wins for compound extensions such as .d.ts.
      let matched = 'plaintext';
      let length = 0;
      for (const language of languages) {
        for (const extension of language.extensions || []) {
          if (extension.length > length && basename.toLowerCase().endsWith(extension.toLowerCase())) {
            matched = language.id;
            length = extension.length;
          }
        }
      }
      return matched;
    },
    // Basic-language onLanguage hooks load the existing Monarch tokenizer when
    // createModel selects its language; no workbench grammar calls are needed.
    prepareSyntax: async () => {},
  });
}
