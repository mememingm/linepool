import { readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.d.ts')) {
      const library = file.replaceAll('\\', '/').includes('/vendor/magic/') ? 'magic' : 'beautiful';
      let contents = readFileSync(file, 'utf8').replace(/(["'])@\/([^"']+)\1/g, (_, quote, suffix) => {
        let target = relative(dirname(file), resolve(root, `dist/types/vendor/${library}/src/${suffix}`)).replaceAll('\\', '/');
        if (!target.startsWith('.')) target = './' + target;
        return quote + target + quote;
      });
      // CSS is an explicit package entry; don't make declarations depend on CSS.
      contents = contents.replace(/^import "\.\/styles\.css";\r?\n/m, '');
      writeFileSync(file, contents);
    }
  }
}
walk(resolve(root, 'dist/types'));
for (const name of ['beautiful', 'magic']) copyFileSync(resolve(root, `src/vendor/${name}/LICENSE`), resolve(root, `dist/LICENSE-${name}`));
console.log('Declarations use portable paths; upstream licenses included');
