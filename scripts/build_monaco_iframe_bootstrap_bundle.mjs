import path from "node:path";
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

const esbuildEntry = path.resolve(monacoSrcRoot, "node_modules/esbuild/lib/main.js");
const { build } = await import(pathToFileURL(esbuildEntry).href);

function pluginResolveMonacoEntryAndContrib() {
  const entry = (p) => path.resolve(monacoSrcRoot, p);
  const monacoMain = path.resolve(vscodeMonacoEsmRoot, "vs/editor/editor.main.js");

  return {
    name: "te2-monaco-bootstrap-alias",
    setup(ctx) {
      ctx.onResolve({ filter: /^@te2-monaco-main$/ }, () => ({ path: monacoMain }));
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
import "@te2-contrib-basic";
import "@te2-contrib-typescript";
import "@te2-contrib-json";
import "@te2-contrib-css";
import "@te2-contrib-html";

export async function loadMonaco() {
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
