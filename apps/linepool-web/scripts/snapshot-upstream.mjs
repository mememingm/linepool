import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(root, 'upstream-lock.json')) && !process.argv.includes('--approved-upstream-update')) {
  throw new Error('Snapshot already locked. Updating requires explicit operator approval; never regenerate to conceal source changes.');
}
const sources = [
  ['beautiful', '../beautiful-ui-free-preview', ['src/components/atoms', 'src/components/primitives', 'src/lib', 'src/globals.css', 'public', 'LICENSE']],
  ['magic', '../magic-ui-preview', ['src/components/ui', 'src/lib', 'src/official.css', 'LICENSE', 'upstream-registry']],
];
const files = [];
function record(path, sourceRoot, destinationRoot) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = resolve(path, entry.name);
    if (entry.isDirectory()) record(full, sourceRoot, destinationRoot);
    else {
      const rel = relative(destinationRoot, full).replaceAll('\\', '/');
      const source = resolve(sourceRoot, rel);
      const bytes = readFileSync(full);
      if (!bytes.equals(readFileSync(source))) throw new Error(`Copy differs: ${rel}`);
      files.push({ path: relative(root, full).replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
for (const [name, source, paths] of sources) {
  const sourceRoot = resolve(root, source), destinationRoot = resolve(root, 'src/vendor', name);
  mkdirSync(destinationRoot, { recursive: true });
  for (const path of paths) { const destination = resolve(destinationRoot, path); mkdirSync(dirname(destination), { recursive: true }); cpSync(resolve(sourceRoot, path), destination, { recursive: true, filter: (sourcePath) => !sourcePath.endsWith('SidebarNav.tsx') }); }
  // Do not distribute a component depending on unlicensed commercial icons.
  // SidebarNav is excluded at copy time; no upstream source is edited.
  record(destinationRoot, sourceRoot, destinationRoot);
}
const publicSource = resolve(root, 'src/vendor/beautiful/public');
const publicDestination = resolve(root, 'public');
cpSync(publicSource, publicDestination, { recursive: true });
record(publicDestination, publicSource, publicDestination);
writeFileSync(resolve(root, 'upstream-lock.json'), JSON.stringify({ note: 'Byte-identical snapshots of local imported sources; not a claim of remote commit verification.', sources: sources.map(([name, path]) => ({ name, path })), files }, null, 2) + '\n');
console.log(`Captured ${files.length} byte-identical files`);
