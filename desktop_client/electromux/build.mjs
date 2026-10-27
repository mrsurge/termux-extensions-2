import {build} from '../electron/node_modules/esbuild/lib/main.js';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const metadata = readFileSync(fileURLToPath(new URL('../../pyproject.toml', import.meta.url)), 'utf8');
const version = /^version = "([^"]+)"$/m.exec(metadata)?.[1];
if (!version) throw new Error('TE2 package version missing');
await build({entryPoints: [fileURLToPath(new URL('./local-framework-backend.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/local-framework-backend.mjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'esm', target: 'node22'});
await build({entryPoints: [fileURLToPath(new URL('./local-framework-consumer.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/local-framework-consumer.mjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'esm', target: 'node24'});
await build({entryPoints: [fileURLToPath(new URL('./embedded-entry.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/embedded-entry.mjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  define: {TE2_CONSUMER_VERSION: JSON.stringify(version)}});
await build({entryPoints: [fileURLToPath(new URL('./electron-navigation.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/electron-navigation.mjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'esm', target: 'node24'});
