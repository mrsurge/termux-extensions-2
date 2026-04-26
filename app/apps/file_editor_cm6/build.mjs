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
  entryPoints: ['workbench_protocol_proxy/node_workbench_adapter/src/protocol/wire-encoding.ts'],
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
