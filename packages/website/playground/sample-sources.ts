import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Samples are editor text, independent of their desktop .celesta/tsconfig. `root` is the repository root. */
export function sampleSources(root: string): Plugin {
  const prefix = '\0celesta-sample:';
  return {
    name: 'celesta-sample-sources', enforce: 'pre',
    resolveId(source, importer) {
      if (!source.includes('/examples/') || !source.endsWith('?raw')) return;
      return `${prefix}${encodeURIComponent(relative(root, resolve(importer ? dirname(importer) : '.', source.slice(0, -4))))}.js`;
    },
    load(id) {
      if (!id.startsWith(prefix)) return;
      const path = join(root, decodeURIComponent(id.slice(prefix.length, -3)));
      this.addWatchFile(path);
      return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`;
    },
  };
}
