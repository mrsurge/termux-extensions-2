import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo root: scripts/.. -> repo root
const repoRoot = path.resolve(__dirname, '..');

const monacoSrcRoot = path.resolve(
  repoRoot,
  'worktrees/monaco-editor-mobile-playground',
);

const esbuildEntry = path.resolve(monacoSrcRoot, 'node_modules/esbuild/lib/main.js');
const { build } = await import(pathToFileURL(esbuildEntry).href);

const vscodeMonacoEsmRoot = path.resolve(
  repoRoot,
  'worktrees/vscode-te2-diff/out-monaco-editor-core/esm',
);

const outLangRoot = path.resolve(
  repoRoot,
  'worktrees/vscode-te2-diff/out-monaco-editor-core/te2-lang',
);

const outWorkersRoot = path.resolve(outLangRoot, 'workers');

const shimMonacoCore = path.resolve(
  repoRoot,
  'app/apps/file_editor_cm6/monaco_editor/build_shims/monaco_editor_core_worker_shim.ts',
);

const workerStart = path.resolve(
  vscodeMonacoEsmRoot,
  'vs/editor/editor.worker.start.js',
);

const monacoEditorApi = path.resolve(
  vscodeMonacoEsmRoot,
  'vs/editor/editor.api.js',
);

const vscodeUriEntry = path.resolve(
  monacoSrcRoot,
  'node_modules/vscode-uri/lib/esm/index.mjs',
);

function pluginMonacoEditorCoreRedirect() {
  return {
    name: 'te2-monaco-core-redirect',
    setup(build) {
      build.onResolve({ filter: /^vscode-uri$/ }, () => ({
        path: vscodeUriEntry,
      }));
      build.onResolve({ filter: /^monaco-editor-core$/ }, () => ({
        path: shimMonacoCore,
      }));
      build.onResolve(
        { filter: /^monaco-editor-core\/esm\/vs\/editor\/editor\.worker\.start$/ },
        () => ({ path: workerStart }),
      );
    },
  };
}

function pluginMonacoEditorCoreForContrib() {
  return {
    name: 'te2-monaco-core-contrib',
    setup(build) {
      build.onResolve({ filter: /^vscode-uri$/ }, () => ({
        path: vscodeUriEntry,
      }));
    },
  };
}

async function main() {
  const entry = (p) => path.resolve(monacoSrcRoot, p);

  const contribEntries = [
    entry('src/basic-languages/monaco.contribution.ts'),
    entry('src/language/json/monaco.contribution.ts'),
    entry('src/language/css/monaco.contribution.ts'),
    entry('src/language/html/monaco.contribution.ts'),
    entry('src/language/typescript/monaco.contribution.ts'),
  ];

  await build({
    entryPoints: contribEntries,
    outdir: outLangRoot,
    outbase: path.resolve(monacoSrcRoot, 'src'),
    bundle: true,
    external: ['monaco-editor-core'],
    absWorkingDir: monacoSrcRoot,
    format: 'esm',
    splitting: true,
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
    entryNames: '[dir]/[name]',
    chunkNames: 'chunk-[hash]',
    plugins: [pluginMonacoEditorCoreForContrib()],
  });

  await build({
    entryPoints: [
      entry('src/language/typescript/ts.worker.ts'),
      entry('src/language/json/json.worker.ts'),
      entry('src/language/css/css.worker.ts'),
      entry('src/language/html/html.worker.ts'),
    ],
    outdir: outWorkersRoot,
    bundle: true,
    absWorkingDir: monacoSrcRoot,
    format: 'esm',
    splitting: true,
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
    entryNames: '[name]',
    chunkNames: 'chunk-[hash]',
    plugins: [pluginMonacoEditorCoreRedirect()],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
