import { build, context } from "esbuild";
import { wbaRuntimeImports } from "../../scripts/wba-runtime-imports.mjs";
import { bunEngineBuildConfig } from "../../scripts/wba-bun-engine-build.mjs";

const isWatch = process.argv.includes("--watch");
const bunEngineConfig = await bunEngineBuildConfig('.', isWatch);

const moduleConfig = {
  entryPoints: [
    "src/protocol/wire-encoding.ts",
    "src/protocol/completion-timeouts.ts",
    "src/protocol/rpc-ids.ts",
    "src/protocol/pinned-rpc-ids.ts",
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
    "src/extensions/intelligence/completion-warmup.ts",
    "src/extensions/intelligence/code-navigation.ts",
    "src/extensions/intelligence/diagnostics-snapshot.ts",
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
    "src/server/runtime-io.ts",
    "src/server/runtime-debug.ts",
    "src/workspace/lifecycle.ts",
    "src/workspace/document-registry.ts",
    "src/workspace/workspace-contains.ts",
  ],
  outdir: "dist",
  outbase: "src",
  bundle: false,
  plugins: [wbaRuntimeImports],
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

// Keep the process-only decoder out of the codec served to webview browsers.
const pipeCodecConfig = {
  ...codecConfig,
  entryPoints: ["src/protocol/pipe-codec.ts"],
  outfile: "dist/protocol/pipe-codec.mjs",
  bundle: false,
  platform: "node",
  plugins: [wbaRuntimeImports],
};

const serverCodecConfig = {
  ...codecConfig,
  entryPoints: ["src/protocol/server-messagepack-codec.ts"],
  outfile: "dist/protocol/server-messagepack-codec.mjs",
  platform: "node",
  mainFields: ["main", "module"],
  external: ["msgpackr-extract"],
  banner: { js: 'import { createRequire as createCodecRequire } from "node:module"; const require = createCodecRequire(import.meta.url);' },
};

if (isWatch) {
  const [moduleCtx, codecCtx, pipeCodecCtx, serverCodecCtx] = await Promise.all([
    context(moduleConfig),
    context(codecConfig),
    context(pipeCodecConfig),
    context(serverCodecConfig),
  ]);
  const bunEngineCtx = bunEngineConfig ? await context(bunEngineConfig) : null;
  await Promise.all([moduleCtx.watch(), codecCtx.watch(), pipeCodecCtx.watch(), serverCodecCtx.watch(), ...(bunEngineCtx ? [bunEngineCtx.watch()] : [])]);
  console.log("Watching Workbench Adapter TypeScript...");
} else {
  await Promise.all([build(moduleConfig), build(codecConfig), build(pipeCodecConfig), build(serverCodecConfig), ...(bunEngineConfig ? [build(bunEngineConfig)] : [])]);
}
