import {build} from '../electron/node_modules/esbuild/lib/main.js';
import {fileURLToPath} from 'node:url';
await build({entryPoints: [fileURLToPath(new URL('./local-framework-backend.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/local-framework-backend.mjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'esm', target: 'node22'});
