// Fixes up Makit's output in dist/ after `makit build` (run by `pnpm build`). Two Makit 0.9 gaps:
//
// 1. Every page has <html lang="en">: the shared root layout only knows `site.lang`. Pagefind
//    splits its index by that attribute, so each locale's pages get their own `lang`, then
//    the search index is rebuilt with the options Makit uses.
// 2. The Markdown endpoints (`<page>.md`) and llms-full.txt are copied from the sources without
//    the remark plugins in makit.config.ts, so example fences are empty and download links
//    keep their `celesta:download/…` placeholders. The same plugins fill them here.
//
// Markdown is edited in place at the positions remark reports instead of being re-serialized
// whole: a round trip through remark-stringify rewrites untouched prose (list markers, escapes
// such as `\[!NOTE]`, tables without GFM), and llms-full.txt concatenates many pages.

import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pagefind from 'pagefind';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { remarkDownloadLinks } from '../plugins/remark-download-links.ts';
import { remarkInclude } from '../plugins/remark-include.ts';
import { locales } from '../site/locales.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

async function* files(dir, extension) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path, extension);
    else if (entry.name.endsWith(extension)) yield path;
  }
}

/** Sets `lang` on the document's <html> tag, adding the attribute when it is missing. */
export function setDocumentLanguage(html, lang) {
  return html.replace(/<html\b[^>]*>/i, tag => /\slang="[^"]*"/i.test(tag)
    ? tag.replace(/\slang="[^"]*"/i, ` lang="${lang}"`)
    : tag.replace(/^<html/i, `<html lang="${lang}"`));
}

/** Gives every page under `dist/<locale>/` that locale's `lang`. Returns the number of files changed. */
export async function setLanguages(dist, localeCodes = Object.keys(locales)) {
  let changed = 0;
  for (const locale of localeCodes) {
    const dir = join(dist, locale);
    for await (const path of files(dir, '.html')) {
      const html = await readFile(path, 'utf8');
      const next = setDocumentLanguage(html, locale);
      if (next !== html) {
        await writeFile(path, next);
        changed++;
      }
    }
  }
  return changed;
}

const parser = unified().use(remarkParse);
const stringifier = unified().use(remarkStringify);

/**
 * Applies remarkInclude and remarkDownloadLinks to Markdown text, changing only the code fences
 * and link destinations the plugins changed.
 */
export async function fillMarkdown(markdown, root = packageRoot) {
  const tree = parser.parse(markdown);
  const before = new Map();
  visit(tree, ['code', 'link', 'definition'], node => { before.set(node, snapshot(node)); });
  await unified().use(remarkInclude, { root }).use(remarkDownloadLinks).run(tree);

  const edits = [];
  for (const [node, was] of before) {
    if (snapshot(node) === was) continue;
    const { start, end } = node.position;
    const source = markdown.slice(start.offset, end.offset);
    if (node.type === 'code') {
      edits.push({ start: start.offset, end: end.offset, text: fence(node, markdown, start.offset) });
    } else {
      // The plugin only changed the destination; keep the link text and title as written.
      const at = source.lastIndexOf(was);
      if (at < 0) throw new Error(`postbuild: cannot find "${was}" in ${source}`);
      const url = /[\s()<>]/.test(node.url) ? `<${node.url}>` : node.url;
      edits.push({ start: start.offset + at, end: start.offset + at + was.length, text: url });
    }
  }
  let output = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

const snapshot = node => node.type === 'code' ? `${node.lang} ${node.meta}\n${node.value}` : node.url;

/** Serializes a filled fence, continuing its container's prefix (list indent, `>`) on every line. */
function fence(node, markdown, offset) {
  const lineStart = markdown.lastIndexOf('\n', offset - 1) + 1;
  const prefix = markdown.slice(lineStart, offset).replace(/[^>\s]/g, ' ');
  const text = stringifier.stringify({ type: 'root', children: [{ type: 'code', lang: node.lang, meta: node.meta, value: node.value }] }).replace(/\n$/, '');
  // A blank line keeps a blockquote's `>` so the fence does not end the quote.
  return text.split('\n').map((line, index) => index === 0 ? line : line ? prefix + line : prefix.trimEnd()).join('\n');
}

/** Fills every `*.md` endpoint and llms-full.txt under `dist`. Returns the number of files changed. */
export async function fillMarkdownOutputs(dist, root = packageRoot) {
  const paths = [];
  for await (const path of files(dist, '.md')) paths.push(path);
  paths.push(join(dist, 'llms-full.txt'));
  let changed = 0;
  for (const path of paths) {
    let markdown;
    try {
      markdown = await readFile(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT' && path.endsWith('llms-full.txt')) continue;
      throw error;
    }
    const next = await fillMarkdown(markdown, root);
    if (next !== markdown) {
      await writeFile(path, next);
      changed++;
    }
  }
  return changed;
}

/** Rebuilds `dist/pagefind/` the way Makit does, so the index picks up the corrected `lang`s. */
export async function writeSearchIndex(dist) {
  let index;
  try {
    const created = await pagefind.createIndex({ includeCharacters: '._-/@' });
    if (!created.index) throw new Error(`Pagefind could not create its index:\n${created.errors.join('\n')}`);
    index = created.index;
    const added = await index.addDirectory({ path: dist });
    if (added.errors.length > 0) throw new Error(`Pagefind could not index ${dist}:\n${added.errors.join('\n')}`);
    const output = join(dist, 'pagefind');
    await rm(output, { recursive: true, force: true });
    const written = await index.writeFiles({ outputPath: output });
    if (written.errors.length > 0) throw new Error(`Pagefind could not write ${output}:\n${written.errors.join('\n')}`);
    return added.page_count;
  } finally {
    if (index) await index.deleteIndex();
    await pagefind.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dist = join(packageRoot, 'dist');
  console.log(`postbuild: set lang on ${await setLanguages(dist)} page(s)`);
  console.log(`postbuild: filled ${await fillMarkdownOutputs(dist)} Markdown file(s)`);
  console.log(`postbuild: indexed ${await writeSearchIndex(dist)} page(s) with Pagefind`);
}
