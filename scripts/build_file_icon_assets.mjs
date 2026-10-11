// Explicit publication of individual trusted icons; runtime never loads icons.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'app/static/vendor/seti-icons');
const { LANGUAGE_ICONS } = await import(path.join(vendor, 'language-icons.js'));
const icons = { ...JSON.parse(await fs.readFile(path.join(vendor, 'icons.json'), 'utf8')), ...LANGUAGE_ICONS };
const check = process.argv.includes('--check');
for (const [name, source] of Object.entries(icons)) {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || typeof source !== 'string') throw new Error('Invalid icon asset');
  const svg = (source.includes('xmlns=') ? source : source.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')) + '\n';
  const target = path.join(vendor, 'individual', name + '.svg');
  if (check) {
    if (await fs.readFile(target, 'utf8') !== svg) throw new Error('Stale icon: ' + name);
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, svg);
  }
}
console.log(`${check ? 'Verified' : 'Published'} ${Object.keys(icons).length} individual icons`);
