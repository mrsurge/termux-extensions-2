import { build } from 'esbuild';
const common = { bundle: true, minify: true, format: 'esm', target: 'es2022', logLevel: 'info' };
await build({ ...common, entryPoints: ['terminal_drawer.ts'], outfile: '../../static/js/file_explorer_terminal.js',
  plugins: [{ name: 'codec', setup(build) { build.onResolve({ filter: /^\.\/wire_codec$/ }, () => ({ path: './file_explorer_codec.js', external: true })); } }] });
await build({ ...common, entryPoints: ['wire_codec.ts'], outfile: '../../static/js/file_explorer_codec.js' });
