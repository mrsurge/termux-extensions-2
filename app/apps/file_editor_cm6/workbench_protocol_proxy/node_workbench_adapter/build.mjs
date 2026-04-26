import { build, context } from "esbuild";

const isWatch = process.argv.includes("--watch");

const config = {
  entryPoints: [
    "src/protocol/wire-encoding.ts",
    "src/protocol/rpc-ids.ts",
    "src/protocol/pending-requests.ts",
    "src/protocol/ext-host-dispatch.ts",
    "src/client/configuration.ts",
    "src/client/document-content.ts",
    "src/client/management.ts",
    "src/client/extension-host.ts",
    "src/client/runtime-adapters.ts",
    "src/client/transport-session.ts",
    "src/client/workbench-client.ts",
    "src/extensions/catalog.ts",
    "src/extensions/provider-registry.ts",
    "src/extensions/intelligence/completions.ts",
    "src/extensions/intelligence/hover.ts",
    "src/extensions/intelligence/semantic-tokens.ts",
    "src/extensions/intelligence/structure.ts",
    "src/server/event-bridge.ts",
    "src/server/request-dispatch.ts",
    "src/server/server.ts",
    "src/server/stdio-protocol.ts",
    "src/server/textmate-grammars.ts",
    "src/workspace/lifecycle.ts",
  ],
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
