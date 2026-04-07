import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: 'info',
  format: 'esm',
  target: 'es2022',
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
  console.log('Watching terminal_testing frontend for changes...');
} else {
  await build(mainConfig);
}
