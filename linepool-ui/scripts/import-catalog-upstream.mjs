import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = resolve(root, 'catalog-upstream-lock.json');
if (existsSync(lockPath)) throw new Error('Catalog snapshots already exist. An upstream update requires operator approval.');
const sources = [
  {
    name: 'animata', repository: 'codse/animata', commit: '36674e4e9cfdc0f237693d8b736a2bf41065ca1d',
    paths: ['animata/card/flip-card.tsx', 'animata/button/ripple-button.tsx', 'animata/button/ripple-button.css', 'animata/text/counter.tsx', 'animata/tabs/shift-tabs.tsx', 'animata/tabs/shared.ts', 'animata/skeleton/list.tsx', 'LICENSE.md'],
  },
  {
    name: 'cult', repository: 'nolly-studio/cult-ui', commit: '67a66c6ac1cd240914ba688a907611b3437a7a2b',
    paths: ['apps/www/registry/default/ui/texture-card.tsx', 'apps/www/registry/default/ui/texture-button.tsx', 'apps/www/registry/default/ui/rolling-number.tsx', 'apps/www/registry/default/ui/direction-aware-tabs.tsx', 'LICENSE.md'],
  },
];
const files = [];
for (const source of sources) {
  for (const upstreamPath of source.paths) {
    const path = `catalog/vendor/${source.name}/upstream/${upstreamPath}`;
    const full = resolve(root, path);
    if (existsSync(full)) throw new Error(`Refusing to overwrite ${path}`);
    const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${upstreamPath}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    files.push({ path, url, sha256: createHash('sha256').update(bytes).digest('hex') });
    console.log(`Imported unchanged: ${path}`);
  }
}
writeFileSync(lockPath, JSON.stringify({ version: 1, sources: sources.map(({ paths, ...source }) => source), files }, null, 2) + '\n');
