// Stage the ready-made project templates the editor offers when creating a
// project: every `templates/<name>/` holding a `template.json`, copied to
// `dist/templates/<name>/`. A template's `source/` (assets' originals, build
// inputs) stays out of the staged copy; only what a project needs ships.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../', import.meta.url));
const templates = fileURLToPath(new URL('../../../templates/', import.meta.url));
const destination = join(cli, 'dist', 'templates');
rmSync(destination, { recursive: true, force: true });

for (const entry of readdirSync(templates, { withFileTypes: true })) {
  const directory = join(templates, entry.name);
  if (!entry.isDirectory() || !existsSync(join(directory, 'template.json'))) continue;
  cpSync(directory, join(destination, entry.name), {
    recursive: true,
    filter: (path) => relative(directory, path).split(sep)[0] !== 'source',
  });
}
