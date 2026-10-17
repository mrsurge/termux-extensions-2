import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preserveRelativeGotoGutter, gateGotoPositionPreview } from './monaco_preserve_relative_gutter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const monacoSrcRoot = path.resolve(repoRoot, "worktrees/monaco-editor-mobile-playground");
const vscodeMonacoEsmRoot = path.resolve(
  repoRoot,
  "app/static/vendor/monaco-editor-core/esm",
);
const outLangRoot = path.resolve(
  repoRoot,
  "app/static/vendor/monaco-editor-core/te2-lang",
);
const outBootstrapDir = path.resolve(outLangRoot, "bootstrap");

// Use worktree esbuild if available, otherwise fall back to a project-local install.
const esbuildCandidates = [
  path.resolve(monacoSrcRoot, "node_modules/esbuild/lib/main.js"),
  path.resolve(repoRoot, "node_modules/esbuild/lib/main.js"),
  path.resolve(
    repoRoot,
    "app/apps/code_te2/node_modules/esbuild/lib/main.js",
  ),
];
const esbuildEntry = esbuildCandidates.find((candidate) => fs.existsSync(candidate));
if (!esbuildEntry) {
  throw new Error(
    `Unable to locate esbuild; checked: ${esbuildCandidates.join(", ")}`,
  );
}
const { build } = await import(pathToFileURL(esbuildEntry).href);

// Check if worktree TS sources are available; if not, use pre-built JS contributions
const worktreeAvailable = fs.existsSync(path.resolve(monacoSrcRoot, "src/basic-languages/monaco.contribution.ts"));

function pluginResolveMonacoEntryAndContrib() {
  const monacoMain = path.resolve(vscodeMonacoEsmRoot, "vs/editor/editor.main.js");

  return {
    name: "te2-monaco-bootstrap-alias",
    setup(ctx) {
      ctx.onLoad({ filter: /[/\\]contrib[/\\]quickAccess[/\\]browser[/\\]gotoLineQuickAccess\.js$/ }, ({ path: modulePath }) => ({
        contents: gateGotoPositionPreview(preserveRelativeGotoGutter(fs.readFileSync(modulePath, 'utf8'))),
        loader: 'js',
      }));
      ctx.onResolve({ filter: /^@te2-monaco-main$/ }, () => ({ path: monacoMain }));
      const quickAccessModules = {
        '@te2-editor-extensions': 'vs/editor/browser/editorExtensions.js',
        '@te2-editor-context-keys': 'vs/editor/common/editorContextKeys.js',
        '@te2-quick-input-service': 'vs/platform/quickinput/common/quickInput.js',
      };
      ctx.onResolve({ filter: /^@te2-(editor-extensions|editor-context-keys|quick-input-service)$/ }, ({ path: name }) => ({
        path: path.resolve(vscodeMonacoEsmRoot, quickAccessModules[name]),
      }));

      if (worktreeAvailable) {
        const entry = (p) => path.resolve(monacoSrcRoot, p);
        ctx.onResolve({ filter: /^@te2-contrib-basic$/ }, () => ({
          path: entry("src/basic-languages/monaco.contribution.ts"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-typescript$/ }, () => ({
          path: entry("src/language/typescript/monaco.contribution.ts"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-json$/ }, () => ({
          path: entry("src/language/json/monaco.contribution.ts"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-css$/ }, () => ({
          path: entry("src/language/css/monaco.contribution.ts"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-html$/ }, () => ({
          path: entry("src/language/html/monaco.contribution.ts"),
        }));
      } else {
        // Use pre-built JS contributions from te2-lang/
        console.log("[bootstrap] Worktree not available, using pre-built contributions from te2-lang/");
        ctx.onResolve({ filter: /^@te2-contrib-basic$/ }, () => ({
          path: path.resolve(outLangRoot, "basic-languages/monaco.contribution.js"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-typescript$/ }, () => ({
          path: path.resolve(outLangRoot, "language/typescript/monaco.contribution.js"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-json$/ }, () => ({
          path: path.resolve(outLangRoot, "language/json/monaco.contribution.js"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-css$/ }, () => ({
          path: path.resolve(outLangRoot, "language/css/monaco.contribution.js"),
        }));
        ctx.onResolve({ filter: /^@te2-contrib-html$/ }, () => ({
          path: path.resolve(outLangRoot, "language/html/monaco.contribution.js"),
        }));
      }

      // Force monaco-editor-core imports from contributions to the same pinned editor API source.
      ctx.onResolve({ filter: /^monaco-editor-core$/ }, () => ({
        path: path.resolve(vscodeMonacoEsmRoot, "vs/editor/editor.api.js"),
      }));
    },
  };
}

await build({
  stdin: {
    contents: `
import * as monacoNs from "@te2-monaco-main";
import { EditorAction, registerEditorAction } from "@te2-editor-extensions";
import { EditorContextKeys } from "@te2-editor-context-keys";
import { IQuickInputService } from "@te2-quick-input-service";
import { installTe2QuickAccess } from "./scripts/monaco_quick_access.mjs";

installTe2QuickAccess();

// Use the existing standalone help provider (empty prefix), not a second picker.
// The stock quickCommand action remains the explicit '>' commands entrypoint.
class Te2QuickAccessAction extends EditorAction {
  constructor() {
    super({
      id: 'editor.action.te2QuickAccess',
      label: 'Quick Access',
      alias: 'Quick Access',
      precondition: undefined,
      kbOpts: {
        kbExpr: EditorContextKeys.focus,
        primary: monacoNs.KeyCode.F1,
        secondary: [
          monacoNs.KeyMod.CtrlCmd | monacoNs.KeyMod.Shift | monacoNs.KeyCode.KeyP,
          monacoNs.KeyMod.CtrlCmd | monacoNs.KeyMod.Shift | monacoNs.KeyCode.Semicolon,
        ],
        weight: 101, // pinned Monaco KeybindingWeight.EditorContrib (100) + 1
      },
      contextMenuOpts: { group: 'z_commands', order: 0.9 },
    });
  }
  run(accessor) {
    accessor.get(IQuickInputService).quickAccess.show('');
  }
}
registerEditorAction(Te2QuickAccessAction);

let languageContributionsPromise = null;
let basicLanguageContributionsPromise = null;

function ensureBasicLanguageContributions() {
  if (!basicLanguageContributionsPromise) {
    basicLanguageContributionsPromise = import("@te2-contrib-basic");
  }
  return basicLanguageContributionsPromise;
}

function ensureLanguageContributions() {
  if (!languageContributionsPromise) {
    languageContributionsPromise = Promise.all([
      ensureBasicLanguageContributions(),
      import("@te2-contrib-typescript"),
      import("@te2-contrib-json"),
      import("@te2-contrib-css"),
      import("@te2-contrib-html"),
    ]);
  }
  return languageContributionsPromise;
}

export async function loadMonaco(options = {}) {
  if (options.languageWorkersEnabled === true) {
    await ensureLanguageContributions();
  } else if (options.basicLanguagesOnly === true) {
    // Historical viewers need lexical tokens, never worker language services.
    await ensureBasicLanguageContributions();
  }
  return monacoNs;
}
`,
    sourcefile: "te2_monaco_bootstrap_entry.js",
    resolveDir: repoRoot,
    loader: "js",
  },
  outfile: path.resolve(outBootstrapDir, "monaco.bootstrap.bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  loader: {
    ".ttf": "file",
    ".woff": "file",
    ".woff2": "file",
    ".svg": "file",
  },
  logLevel: "info",
  plugins: [pluginResolveMonacoEntryAndContrib()],
});
