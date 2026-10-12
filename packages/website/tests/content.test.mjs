import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const locales = ['en', 'ja'];
const slugs = [
  'installation', 'create-project', 'preview', 'react-compositions',
  'animation', 'motion-toolkit', 'text-camera-lines', 'layout', 'text-fonts', 'media', 'dialogue', 'data', 'export',
  'reference',
  'math', 'math-noise', 'math-shaping', 'code', 'code-typing', 'voicevox',
  'examples', 'timelines', 'build-from-source', 'troubleshooting',
];
const groups = ['getting-started', 'guides', 'reference', 'packages', 'more'];

/** `04-(packages)` → `packages`, `02-math-noise.md` → `math-noise`. */
const bare = name => name.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/^\((.*)\)$/, '$1');

/** The chapters under `dir` in navigation order, with the directory each one sits in. */
function chapters(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return chapters(path);
    return name.endsWith('.md') && name !== 'index.md' ? [{ slug: bare(name), dir, path }] : [];
  });
}

const docsDir = locale => join(root, 'content', locale, 'docs');
const markdownFiles = locale => [join(docsDir(locale), 'index.md'), ...chapters(docsDir(locale)).map(chapter => chapter.path)];

test('both locales have the same 24 chapters in the same groups', () => {
  for (const locale of locales) {
    const found = chapters(docsDir(locale));
    assert.deepEqual(found.map(chapter => chapter.slug), slugs, `${locale} chapter order`);
    const groupDirs = readdirSync(docsDir(locale)).sort().filter(name => statSync(join(docsDir(locale), name)).isDirectory());
    assert.deepEqual(groupDirs.map(bare), groups, `${locale} groups`);
    for (const name of groupDirs) assert.ok(existsSync(join(docsDir(locale), name, 'category.makit.ts')), `${locale}:${name} has a category`);
    for (const chapter of found) {
      const meta = chapter.path.replace(/\.md$/, '.meta.ts');
      assert.ok(existsSync(meta), `${locale}:${chapter.slug} has metadata`);
      assert.match(readFileSync(meta, 'utf8'), new RegExp(`id: '${chapter.slug}'`), `${locale}:${chapter.slug} page id`);
    }
  }
});

test('sub-pages follow their package page', () => {
  for (const locale of locales) {
    const found = chapters(docsDir(locale));
    const at = slug => found.findIndex(chapter => chapter.slug === slug);
    const dirOf = slug => found[at(slug)].dir;
    for (const [child, parent] of [['math-noise', 'math'], ['math-shaping', 'math'], ['code-typing', 'code']]) {
      assert.equal(dirOf(child), dirOf(parent), `${locale}:${child} shares a directory with ${parent}`);
      assert.ok(at(child) > at(parent), `${locale}:${child} sorts after ${parent}`);
    }
    assert.notEqual(dirOf('math'), dirOf('code'), `${locale}: each package has its own directory`);
  }
});

test('internal links point at existing chapters', () => {
  let links = 0;
  for (const locale of locales) {
    for (const file of markdownFiles(locale)) {
      const markdown = readFileSync(file, 'utf8');
      for (const [, target] of markdown.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        if (!/^\/[a-z]+\/docs\//.test(target)) continue;
        links++;
        const match = /^\/([a-z]+)\/docs\/(?:([a-z0-9-]+)\/)?(?:#\S+)?$/.exec(target);
        assert.ok(match, `${file}: ${target} is a chapter address`);
        assert.equal(match[1], locale, `${file}: ${target} stays in ${locale}`);
        if (match[2]) assert.ok(slugs.includes(match[2]), `${file}: ${target} names a chapter`);
      }
    }
  }
  assert.ok(links > 0, 'the chapters link to each other');
});

test('every include exists', () => {
  let includes = 0;
  for (const locale of locales) {
    for (const file of markdownFiles(locale)) {
      for (const [, quoted, bareName] of readFileSync(file, 'utf8').matchAll(/(?:^|\s)file=(?:"([^"]*)"|(\S+))/gm)) {
        const path = quoted ?? bareName;
        includes++;
        assert.ok(existsSync(resolve(root, path)), `${file}: ${path} exists`);
      }
    }
  }
  assert.ok(includes > 0, 'the documentation includes example files');
});
