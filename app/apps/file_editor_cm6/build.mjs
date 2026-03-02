// build.mjs — esbuild config for TE2 file editor
// Two entry points: host page + Monaco editor iframe
import { context, build } from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** Shared config for both bundles */
const shared = {
  bundle: true,
  sourcemap: true,
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
  entryPoints: ['monaco_editor/m_editor_app.js'],
  outfile: 'static/dist/editor.js',
  format: 'iife',
};

if (isWatch) {
  const [hostCtx, editorCtx] = await Promise.all([
    context(hostConfig),
    context(editorConfig),
  ]);
  await Promise.all([hostCtx.watch(), editorCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([build(hostConfig), build(editorConfig)]);
}
