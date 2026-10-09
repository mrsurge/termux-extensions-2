// Offline loading probe: real TextMate dependency discovery + production body loader.
// Requires Node 24 (TypeScript type stripping); does not tokenize or contact a server.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createTextmateGrammarBodyLoader } from '../app/apps/code_te2/monaco_editor/editor_textmate_grammar_loader.ts';

const require = createRequire(import.meta.url);
const textmate = require('../app/apps/code_te2/vendor/vscode-textmate/release/main.js');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function readDefinitions(roots) {
  const extensions = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, entry.name);
      const manifestPath = path.join(directory, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      extensions.push({ id: `${manifest.publisher || ''}.${manifest.name}`, directory, manifest });
    }
  }
  const definitions = [];
  for (const extension of extensions.sort((a, b) => a.id.localeCompare(b.id))) {
    for (const grammar of extension.manifest.contributes?.grammars || []) {
      if (!grammar.scopeName || !grammar.path) continue;
      const file = path.resolve(extension.directory, grammar.path);
      if (!file.startsWith(`${path.resolve(extension.directory)}${path.sep}`)) {
        throw new Error(`Grammar escapes extension directory: ${file}`);
      }
      definitions.push({ ...grammar, id: `${extension.id}/${grammar.path}`, file,
        raw: fs.readFileSync(file, 'utf8') });
    }
  }
  return definitions;
}

export async function probeLoading(definitions, scope, { latencyMs = 0, bytesPerSecond = 0 } = {}) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || !Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) {
    throw new Error('Network costs must be finite and nonnegative');
  }
  const byScope = new Map(definitions.map((entry) => [entry.scopeName, entry]));
  const byId = new Map(definitions.map((entry) => [entry.id, entry]));
  if (!byScope.has(scope)) throw new Error(`Unknown root scope: ${scope}`);
  const injections = new Map();
  for (const entry of definitions) {
    for (const target of entry.injectTo || []) {
      injections.set(target, [...(injections.get(target) || []), entry.scopeName]);
    }
  }
  let records = [];
  let start = 0;
  let transfer = Promise.resolve();
  const loader = createTextmateGrammarBodyLoader(async (method, params) => {
    if (method !== 'editor.textmate.grammars.get') throw new Error(`Unexpected method: ${method}`);
    const bodies = Object.fromEntries(params.ids.map((id) => {
      const entry = byId.get(id);
      if (!entry) throw new Error(`Unknown grammar ID: ${id}`);
      return [id, { ok: true, revision: params.revision, raw: entry.raw }];
    }));
    const bytes = params.ids.reduce((sum, id) => sum + Buffer.byteLength(byId.get(id).raw), 0);
    const record = { ids: params.ids, rawBytes: bytes, startedMs: performance.now() - start };
    records.push(record);
    await delay(latencyMs);
    // Model one shared downstream link; raw bytes exclude codec/transport overhead.
    if (bytesPerSecond) {
      transfer = transfer.then(() => delay(bytes * 1000 / bytesPerSecond));
      await transfer;
    }
    record.completedMs = performance.now() - start;
    return { revision: params.revision, bodies };
  });

  async function run(label, revision) {
    records = [];
    start = performance.now();
    let bodyCallbacks = 0;
    const registry = new textmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner() { throw new Error('Probe does not tokenize'); },
        createOnigString() { throw new Error('Probe does not tokenize'); },
      }),
      getInjections(target) {
        const parts = target.split('.');
        return parts.flatMap((_, i) => injections.get(parts.slice(0, i + 1).join('.')) || []);
      },
      async loadGrammar(target) {
        const entry = byScope.get(target);
        if (!entry) return null;
        bodyCallbacks += 1;
        const raw = await loader.load(entry.id, revision);
        return textmate.parseRawGrammar(raw, entry.file);
      },
    });
    try {
      await registry.loadGrammar(scope);
      return { label, elapsedMs: performance.now() - start, bodyCallbacks,
        requests: records.length, rawBytes: records.reduce((sum, item) => sum + item.rawBytes, 0),
        batches: records };
    } finally { registry.dispose(); }
  }
  try {
    return { scope, latencyMs, bytesPerSecond,
      runs: [await run('cold', 'probe-v1'), await run('warm-body-cache', 'probe-v1'),
        await run('revision-reset', 'probe-v2')] };
  } finally { loader.reset(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const roots = [];
  let scope = 'text.html.markdown', latencyMs = 0, bytesPerSecond = 0;
  for (let i = 0; i < args.length; i += 1) {
    const option = args[i], value = args[++i];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === '--extensions') roots.push(path.resolve(value));
    else if (option === '--scope') scope = value;
    else if (option === '--latency-ms') latencyMs = Number(value);
    else if (option === '--bytes-per-second') bytesPerSecond = Number(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!roots.length) throw new Error('Provide --extensions <installed extension root>');
  console.log(JSON.stringify(await probeLoading(readDefinitions(roots), scope, { latencyMs, bytesPerSecond }), null, 2));
}
