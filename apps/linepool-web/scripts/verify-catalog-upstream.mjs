import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'catalog-upstream-lock.json'), 'utf8'));
const expected = new Set(lock.files.map(file => file.path));
const failures = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = resolve(path, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (!expected.has(relative(root, full).replaceAll('\\', '/'))) failures.push(`Untracked catalog upstream file: ${full}`);
  }
}
for (const source of lock.sources) walk(resolve(root, `catalog/vendor/${source.name}/upstream`));
for (const file of lock.files) {
  try {
    if (createHash('sha256').update(readFileSync(resolve(root, file.path))).digest('hex') !== file.sha256) failures.push(`Changed: ${file.path}`);
  } catch { failures.push(`Missing: ${file.path}`); }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Catalog upstream integrity: ${lock.files.length} files unchanged`);
