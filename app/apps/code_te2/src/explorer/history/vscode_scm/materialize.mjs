import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = import.meta.dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scratchRoot = process.env.TMPDIR || path.join(root, '.materialize-scratch');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'te2-scm-'));
const adapted = ['browser/scmHistory.ts', 'common/history.ts', 'test/browser/scmHistory.test.ts'];
try {
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, 'upstream', entry.file));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Upstream checksum mismatch: ${entry.file}`);
    const target = path.join(scratch, entry.file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  }
  const series = fs.readFileSync(path.join(root, 'patches/series'), 'utf8').trim().split('\n');
  for (const patch of series) execFileSync('patch', ['--batch', '--fuzz=0', '-p1', '-i', path.join(root, 'patches', patch)], { cwd: scratch });
  for (const file of adapted) {
    const expected = fs.readFileSync(path.join(scratch, file));
    const target = path.join(root, 'adapted', file);
    if (process.argv.includes('--write')) {
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, expected);
    } else if (!expected.equals(fs.readFileSync(target))) throw Error(`Adapted source drift: ${file}`);
  }
  console.log('SCM upstream hashes and adapted patch reproduction verified.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
  if (!process.env.TMPDIR) fs.rmdirSync(scratchRoot);
}
