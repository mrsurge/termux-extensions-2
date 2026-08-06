import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const renderer = resolve(dist, "renderer");
const dialog = resolve(renderer, "dialog");
const surface = resolve(renderer, "surface");

await rm(dist, { recursive: true, force: true });
await Promise.all([
  mkdir(dialog, { recursive: true }),
  mkdir(surface, { recursive: true }),
]);

await Promise.all([
  build({
    entryPoints: [resolve(root, "src/main/index.ts")],
    outfile: resolve(dist, "main.cjs"),
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node22",
  }),
  build({
    entryPoints: [resolve(root, "src/preload/shell-preload.ts")],
    outfile: resolve(dist, "shell-preload.cjs"),
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node22",
  }),
  build({
    entryPoints: [resolve(root, "src/preload/app-view-preload.ts")],
    outfile: resolve(dist, "app-view-preload.cjs"),
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node22",
  }),
  build({
    entryPoints: [resolve(root, "src/preload/dialog-preload.ts")],
    outfile: resolve(dist, "dialog-preload.cjs"),
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node22",
  }),
  build({
    entryPoints: [resolve(root, "src/preload/surface-preload.ts")],
    outfile: resolve(dist, "surface-preload.cjs"),
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node22",
  }),
  build({
    entryPoints: [resolve(root, "src/renderer/index.ts")],
    outfile: resolve(renderer, "index.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap: true,
    target: "chrome140",
  }),
  build({
    entryPoints: [resolve(root, "src/dialog/index.ts")],
    outfile: resolve(dialog, "dialog.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap: true,
    target: "chrome140",
  }),
  build({
    entryPoints: [resolve(root, "src/surface/index.tsx")],
    outfile: resolve(surface, "surface.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap: true,
    target: "chrome140",
    jsxFactory: "jsx",
    jsxFragment: "Fragment",
  }),
]);

await Promise.all([
  cp(resolve(root, "src/renderer/index.html"), resolve(renderer, "index.html")),
  cp(resolve(root, "src/renderer/index.css"), resolve(renderer, "index.css")),
  cp(resolve(root, "src/dialog/index.html"), resolve(dialog, "index.html")),
  cp(resolve(root, "src/dialog/dialog.css"), resolve(dialog, "dialog.css")),
  cp(resolve(root, "src/surface/index.html"), resolve(surface, "index.html")),
  cp(resolve(root, "src/surface/surface.css"), resolve(surface, "surface.css")),
  cp(resolve(root, "../android_shell"), resolve(renderer, "android_shell"), {
    recursive: true,
  }),
]);
