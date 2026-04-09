import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const shared = {
  bundle: true,
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: 'info',
  format: 'esm',
  target: 'es2022',
  alias: {
    'te2-console-bridge': path.join(appRoot, '..', 'file_editor_cm6', 'static', 'js', 'console_bridge.js'),
  },
  external: [
    '/static/vendor/*',
  ],
};

const mainConfig = {
  ...shared,
  entryPoints: ['src/main.ts'],
  outfile: 'static/dist/main.js',
};

if (isWatch) {
  const ctx = await context(mainConfig);
  await ctx.watch();
  console.log('Watching terminal frontend for changes...');
} else {
  await build(mainConfig);
}
