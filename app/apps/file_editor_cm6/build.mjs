// build.mjs — esbuild config for TE2 file editor
// Two entry points: host page + Monaco editor iframe
import { context, build } from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** Shared config for both bundles */
const shared = {
  bundle: true,
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: 'info',
  external: [
    // Vendor scripts loaded separately via <script> tags
    '/static/vendor/*',
  ],
};

/** Host page bundle (ES module) */
const hostConfig = {
  ...shared,
  entryPoints: ['main.js'],
  outfile: 'static/dist/host.js',
  format: 'esm',
};

/** Monaco editor iframe bundle (IIFE — no module system in iframe) */
const editorConfig = {
  ...shared,
  entryPoints: ['monaco_editor/m_editor_app.ts'],
  outfile: 'static/dist/editor.js',
  format: 'iife',
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
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/catalog.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/provider-registry.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/completions.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/hover.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/inlay-hints.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/inline-completions.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/semantic-tokens.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/extensions/intelligence/structure.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/event-bridge.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/request-dispatch.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/server.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/stdio-protocol.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/server/textmate-grammars.ts',
    'workbench_protocol_proxy/node_workbench_adapter/src/workspace/lifecycle.ts',
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

if (isWatch) {
  const [hostCtx, editorCtx, workbenchAdapterCtx] = await Promise.all([
    context(hostConfig),
    context(editorConfig),
    context(workbenchAdapterConfig),
  ]);
  await Promise.all([hostCtx.watch(), editorCtx.watch(), workbenchAdapterCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([build(hostConfig), build(editorConfig), build(workbenchAdapterConfig)]);
}
