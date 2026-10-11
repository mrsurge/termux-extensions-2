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
    'te2-console-bridge': path.join(appRoot, '..', 'code_te2', 'main_page', 'frontend', 'console_bridge.js'),
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

const explorerConfig = { ...shared, entryPoints: [path.join(appRoot, '..', 'file_explorer', 'terminal_drawer.ts')],
  plugins: [{ name: 'shared-explorer-codec', setup(build) {
    build.onResolve({ filter: /^\.\/wire_codec$/ }, () => ({ path: './file_explorer_codec.js', external: true }));
  } }],
  outfile: path.join(appRoot, '..', '..', 'static', 'js', 'file_explorer_terminal.js') };
if (isWatch) { const ctx = await context(explorerConfig); await ctx.watch(); }
else await build(explorerConfig);

const codecConfig = { ...shared, entryPoints: [path.join(appRoot, '..', 'file_explorer', 'wire_codec.ts')],
  outfile: path.join(appRoot, '..', '..', 'static', 'js', 'file_explorer_codec.js') };
if (isWatch) { const ctx = await context(codecConfig); await ctx.watch(); }
else await build(codecConfig);
