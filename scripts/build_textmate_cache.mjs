// Explicit publication step; never reads a user's extension registry.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readDefinitions, probeLoading } from './probe_textmate_loading.mjs';

export function validateCache(cache) {
  if (cache.schema !== 1 || !cache.bodies || Object.keys(cache.bodies).length > 256) throw Error('Invalid TextMate cache');
  let bytes = 0;
  for (const body of Object.values(cache.bodies)) {
    if (typeof body.raw !== 'string' || !body.raw || createHash('sha256').update(body.raw).digest('hex') !== body.sha256) throw Error('TextMate cache hash mismatch');
    bytes += Buffer.byteLength(body.raw);
  }
  if (bytes > 8 * 1024 * 1024) throw Error('TextMate cache too large');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, version] = process.argv.slice(2);
  if (!root || !version) throw Error('Usage: node scripts/build_textmate_cache.mjs <built-in extensions root> <code-server version>');
  const definitions = readDefinitions([path.resolve(root)]);
  const result = await probeLoading(definitions, 'text.html.markdown');
  const ids = new Set(result.runs[0].batches.flatMap(batch => batch.ids));
  const bodies = Object.fromEntries(definitions.filter(entry => ids.has(entry.id)).sort((a,b) => a.id.localeCompare(b.id)).map(entry => [entry.id, { raw: entry.raw, sha256: createHash('sha256').update(entry.raw).digest('hex') }]));
  const cache = { schema: 1, source: { codeServer: version, rootScope: 'text.html.markdown', license: 'MIT', repository: 'https://github.com/microsoft/vscode' }, bodies };
  validateCache(cache);
  const output = new URL('../app/apps/code_te2/monaco_editor/textmate/markdown-cache.json', import.meta.url);
  fs.writeFileSync(output, JSON.stringify(cache));
  console.log(`Published ${ids.size} built-in grammar bodies (${fs.statSync(output).size} bytes)`);
}
