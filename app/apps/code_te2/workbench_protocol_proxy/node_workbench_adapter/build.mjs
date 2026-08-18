import { build, context } from "esbuild";

const isWatch = process.argv.includes("--watch");

const moduleConfig = {
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
    "src/extensions/activation-events.ts",
    "src/extensions/activation-runtime.ts",
    "src/extensions/catalog.ts",
    "src/extensions/activity-runtime.ts",
    "src/extensions/command-runtime.ts",
    "src/extensions/editor-navigation-runtime.ts",
    "src/extensions/extension-storage.ts",
    "src/extensions/language-resolver.ts",
    "src/extensions/provider-registry.ts",
    "src/extensions/webview-runtime.ts",
    "src/extensions/intelligence/completions.ts",
    "src/extensions/intelligence/code-navigation.ts",
    "src/extensions/intelligence/document-colors.ts",
    "src/extensions/intelligence/hover.ts",
    "src/extensions/intelligence/inlay-hints.ts",
    "src/extensions/intelligence/inline-completions.ts",
    "src/extensions/intelligence/semantic-token-projections.ts",
    "src/extensions/intelligence/semantic-tokens.ts",
    "src/extensions/intelligence/structure.ts",
    "src/server/event-bridge.ts",
    "src/server/editor-socket.ts",
    "src/server/error-format.ts",
    "src/server/request-dispatch.ts",
    "src/server/server.ts",
    "src/server/stdio-protocol.ts",
    "src/server/textmate-grammars.ts",
    "src/workspace/lifecycle.ts",
    "src/workspace/document-registry.ts",
    "src/workspace/workspace-contains.ts",
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

// Keep the installed codec self-contained without collapsing the WBA module graph.
const codecConfig = {
  entryPoints: ["src/protocol/messagepack-codec.ts"],
  outfile: "dist/protocol/messagepack-codec.mjs",
  bundle: true,
  platform: "neutral",
  mainFields: ["module", "main"],
  format: "esm",
  target: "es2022",
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: "info",
};

if (isWatch) {
  const [moduleCtx, codecCtx] = await Promise.all([
    context(moduleConfig),
    context(codecConfig),
  ]);
  await Promise.all([moduleCtx.watch(), codecCtx.watch()]);
  console.log("Watching Workbench Adapter TypeScript...");
} else {
  await Promise.all([build(moduleConfig), build(codecConfig)]);
}
