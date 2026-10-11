// Stage the ready-made project templates the editor offers when creating a
// project: every `templates/<name>/` holding a `template.json`, copied to
// `dist/templates/<name>/`. A template's `source/` (assets' originals, build
// inputs) and stray OS/editor files stay out of the staged copy; only what a
// project needs ships.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../', import.meta.url));
const templates = fileURLToPath(new URL('../../../templates/', import.meta.url));
const destination = join(cli, 'dist', 'templates');

// OS and editor leftovers: Finder and Explorer metadata, AppleDouble files,
// editor backups and vim swap files. Keep in step with `is_junk_file` in
// crates/react-bridge/src/project_templates.rs.
function isJunkFile(name) {
  return (
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === 'desktop.ini' ||
    name.startsWith('._') ||
    name.endsWith('~') ||
    /^\..*\.sw.$/s.test(name)
  );
}

rmSync(destination, { recursive: true, force: true });

for (const entry of readdirSync(templates, { withFileTypes: true })) {
  const directory = join(templates, entry.name);
  if (!entry.isDirectory() || !existsSync(join(directory, 'template.json'))) continue;
  cpSync(directory, join(destination, entry.name), {
    recursive: true,
    filter: (path) => relative(directory, path).split(sep)[0] !== 'source' && !isJunkFile(basename(path)),
  });
}
