import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const renderer = resolve(dist, "renderer");

await rm(dist, { recursive: true, force: true });
await mkdir(renderer, { recursive: true });

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
    entryPoints: [resolve(root, "src/renderer/index.ts")],
    outfile: resolve(renderer, "index.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap: true,
    target: "chrome140",
  }),
]);

await Promise.all([
  cp(resolve(root, "src/renderer/index.html"), resolve(renderer, "index.html")),
  cp(resolve(root, "src/renderer/index.css"), resolve(renderer, "index.css")),
  cp(resolve(root, "../android_shell"), resolve(renderer, "android_shell"), {
    recursive: true,
  }),
]);
