import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

const root = import.meta.dirname;

// Keep the dependency boundary auditable: original pinned files only, with no
// resolution into a developer's code-server checkout or workbench services.
export async function buildTree() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const source = path.join(root, 'upstream');
  const expected = new Set();
  for (const entry of [...manifest.files, ...manifest.supportFiles]) {
    const filename = path.resolve(source, entry.file);
    if (!filename.startsWith(`${source}${path.sep}`)) throw Error(`Invalid dependency path: ${entry.file}`);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    if (digest !== entry.sha256) throw Error(`Tree source drift: ${entry.file}`);
  }
  for (const entry of manifest.files) expected.add(path.resolve(source, entry.file));
  const upstreamConfig = JSON.parse(fs.readFileSync(path.join(source, 'src/tsconfig.base.json'), 'utf8'));
  // Apply the explicit adaptation off-tree; the pinned original stays untouched.
  const scratchRoot = process.env.TMPDIR || path.join(root, '.patch-scratch');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'scm-tree-'));
  const relativeTree = 'src/vs/base/browser/ui/tree/abstractTree.ts';
  let patchedTree;
  try {
    const target = path.join(scratch, 'abstractTree.ts');
    execFileSync('patch', ['--batch', '--fuzz=0', '--output', target,
      path.join(source, relativeTree), path.join(root, 'patches/0001-disposable-active-node-debounce.patch')]);
    patchedTree = fs.readFileSync(target, 'utf8');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    if (!process.env.TMPDIR) fs.rmdirSync(scratchRoot);
  }
  const result = await build({
    entryPoints: [path.join(source, manifest.entry)],
    bundle: true, write: false, metafile: true, minify: true,
    format: 'esm', platform: 'browser', target: 'es2022',
    // Decorator and field semantics are source contracts, not TE2 tsconfig defaults.
    tsconfigRaw: { compilerOptions: {
      experimentalDecorators: upstreamConfig.compilerOptions.experimentalDecorators,
      useDefineForClassFields: upstreamConfig.compilerOptions.useDefineForClassFields,
    } },
    outdir: path.join(root, 'dist'), logLevel: 'silent',
    plugins: [{ name: 'pinned-tree-adaptation', setup(builder) {
      builder.onLoad({ filter: /\/abstractTree\.ts$/ }, args => {
        if (args.path !== path.join(source, relativeTree)) throw Error('Unexpected tree source');
        return { contents: patchedTree, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!expected.delete(path.resolve(input))) throw Error(`Unpinned tree dependency: ${input}`);
  }
  if (expected.size) throw Error(`Unused pinned tree dependencies: ${[...expected].join(', ')}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildTree();
  for (const output of result.outputFiles) console.log(`${path.basename(output.path)}: ${output.contents.length} bytes`);
  console.log(`Verified ${Object.keys(result.metafile.inputs).length} pinned tree inputs; no files generated.`);
}
