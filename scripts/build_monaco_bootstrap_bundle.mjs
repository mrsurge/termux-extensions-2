import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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
      ctx.onResolve({ filter: /^@te2-monaco-main$/ }, () => ({ path: monacoMain }));

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

let languageContributionsPromise = null;

function ensureLanguageContributions() {
  if (!languageContributionsPromise) {
    languageContributionsPromise = Promise.all([
      import("@te2-contrib-basic"),
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
