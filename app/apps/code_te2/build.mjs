// build.mjs — esbuild config for TE2 file editor
// Code TE2 ships one browser entrypoint. The inline Monaco editor is part of
// the host graph so its runtime cannot race a second editor bundle.
import { context, build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const isWatch = process.argv.includes('--watch');

async function copyHostCss() {
  await mkdir('static/dist', { recursive: true });
  await Promise.all([
    copyFile('main_page/frontend/explorer.css', 'static/dist/explorer.css'),
    copyFile(
      'vendor/highlightjs/styles/github-dark.css',
      'static/dist/explorer-highlight-github.css',
    ),
    copyFile(
      'src/explorer/search/vscode_widget_vendor/media/searchview.css',
      'static/dist/explorer-search-widget.css',
    ),
  ]);
}

/** Shared browser bundle config */
const shared = {
  bundle: true,
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: 'info',
  jsx: 'transform',
  jsxFactory: 'jsx',
  jsxFragment: 'Fragment',
  external: [
    // Vendor scripts loaded separately via <script> tags
    '/static/vendor/*',
  ],
};

/** Host page bundle (ES module) */
const hostConfig = {
  ...shared,
  entryPoints: ['main.ts'],
  outfile: 'static/dist/host.js',
  format: 'esm',
};

/** Workbench Adapter typed helper modules (Node ESM) */
const workbenchAdapterConfig = {
  entryPoints: [
    'workbench_protocol_proxy/node_workbench_adapter/src/protocol/wire-encoding.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/protocol/rpc-ids.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/protocol/pending-requests.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/protocol/ext-host-dispatch.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/client/configuration.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/client/document-content.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/client/management.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/client/extension-host.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/client/runtime-adapters.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/client/transport-session.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/client/workbench-client.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/activation-events.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/activation-runtime.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/catalog.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/activity-runtime.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/command-runtime.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/extension-storage.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/language-resolver.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/provider-registry.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/webview-runtime.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/completions.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/code-navigation.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/document-colors.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/hover.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/inlay-hints.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/inline-completions.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/semantic-tokens.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/structure.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/event-bridge.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/editor-socket.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/request-dispatch.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/server.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/stdio-protocol.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/textmate-grammars.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/workspace/document-registry.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/workspace/file-search.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/workspace/lifecycle.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/workspace/workspace-contains.ts',
  ],
  outdir: 'workbench_protocol_proxy/node_workbench_adapter/dist',
  outbase: 'workbench_protocol_proxy/node_workbench_adapter/src',
  bundle: false,
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: 'info',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
};

/** Self-contained WBA codec; installed apps do not ship the build node_modules tree. */
const workbenchAdapterCodecConfig = {
  entryPoints: [
    'workbench_protocol_proxy/node_workbench_adapter/src/protocol/messagepack-codec.ts',
  ],
  outfile: 'workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs',
  bundle: true,
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: 'info',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  format: 'esm',
};

if (isWatch) {
  const [hostCtx, workbenchAdapterCtx, workbenchAdapterCodecCtx] = await Promise.all([
    context(hostConfig),
    context(workbenchAdapterConfig),
    context(workbenchAdapterCodecConfig),
  ]);
  await copyHostCss();
  await Promise.all([
    hostCtx.watch(),
    workbenchAdapterCtx.watch(),
    workbenchAdapterCodecCtx.watch(),
  ]);
  console.log('Watching for changes...');
} else {
  await Promise.all([
    build(hostConfig),
    build(workbenchAdapterConfig),
    build(workbenchAdapterCodecConfig),
  ]);
  await copyHostCss();
}
