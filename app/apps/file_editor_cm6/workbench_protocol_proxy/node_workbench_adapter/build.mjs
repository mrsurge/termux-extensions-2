import { build, context } from "esbuild";

const isWatch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/protocol/wire-encoding.ts"],
  outdir: "dist",
  outbase: "src",
  bundle: false,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: "info",
  outExtension: { ".js": ".mjs" },
};

if (isWatch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log("Watching Workbench Adapter TypeScript...");
} else {
  await build(config);
}
