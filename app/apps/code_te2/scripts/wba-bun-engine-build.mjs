import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import path from 'node:path';

export async function bunEngineBuildConfig(prefix, watch) {
  const entry = path.join(prefix, 'src/server/bun-engine.ts');
  const outfile = path.join(prefix, 'dist/server/bun-engine.mjs');
  try {
    createRequire(import.meta.url).resolve('@socket.io/bun-engine');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    await rm(outfile, { force: true });
    console.warn('Optional Bun engine not installed; building standard WBA fallback only.');
    return null;
  }
  return {
    entryPoints: [entry], outfile, bundle: true, platform: 'node',
    external: ['bun'], format: 'esm', target: 'es2022',
    sourcemap: watch, minify: !watch, logLevel: 'info',
  };
}
